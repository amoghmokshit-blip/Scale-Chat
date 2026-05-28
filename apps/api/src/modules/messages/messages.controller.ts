import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ChatDetailSchema,
  ChatMediaListQuerySchema,
  MessageDeleteScopeSchema,
  MessageListQuerySchema,
  MessageSchema,
  MessageSearchQuerySchema,
  SendMessageSchema,
  type ChatDetailDto,
  type ChatMediaListQuery,
  type ChatStorageSummary,
  type MessageDeleteScope,
  type MessageDto,
  type MessageListQuery,
  type MessageListResponse,
  type MessageSearchPage,
  type MessageSearchQuery,
  type SendMessageBody,
} from '@scalechat/shared';
import { z } from 'zod';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MessagesGateway } from './messages.gateway';
import { MessagesService } from './messages.service';

// Suppress unused-imports flagged by some lints; schemas are exported for client-side type sharing.
void ChatDetailSchema;
void MessageSchema;

@UseGuards(JwtAuthGuard)
@Controller('chats/:chatId')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly gateway: MessagesGateway,
  ) {}

  @Get()
  getDetail(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string
  ): Promise<ChatDetailDto> {
    return this.messages.getChat(user.sub, chatId);
  }

  /**
   * `GET /chats/:chatId/messages/search?q=&cursor=&limit=`
   * Case-insensitive substring search over message text in a chat.
   * Excludes tombstones and messages before the caller's clearedAt.
   * Results ordered sequence DESC; cursor-paginated.
   *
   * IMPORTANT: this handler MUST remain declared before `@Get('messages')` so
   * NestJS/Fastify resolves `messages/search` as this route rather than
   * treating "search" as a `:messageId`-style dynamic segment on the list route.
   */
  @Get('messages/search')
  searchMessages(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Query(new ZodValidationPipe(MessageSearchQuerySchema)) query: MessageSearchQuery,
  ): Promise<MessageSearchPage> {
    return this.messages.searchMessages(user.sub, chatId, query.q, query.cursor, query.limit);
  }

  @Get('messages')
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Query(new ZodValidationPipe(MessageListQuerySchema)) query: MessageListQuery
  ): Promise<MessageListResponse> {
    return this.messages.list(user.sub, chatId, query.cursor, query.limit, query.direction);
  }

  /**
   * `GET /chats/:chatId/media?kind=IMAGE|VOICE&cursor=&limit=`
   * Per-chat media gallery for the Contact Profile screen (BRD §3.3 Media
   * Links & Docs). Reuses the messages cursor scheme.
   */
  @Get('media')
  listMedia(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Query(new ZodValidationPipe(ChatMediaListQuerySchema)) query: ChatMediaListQuery,
  ): Promise<MessageListResponse> {
    return this.messages.listMedia(user.sub, chatId, query);
  }

  /**
   * `GET /chats/:chatId/storage`
   * Per-chat storage summary — total bytes + per-kind breakdown.
   * Member-gated; returns 403 `not_a_member` for non-members.
   */
  @Get('storage')
  getChatStorage(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
  ): Promise<ChatStorageSummary> {
    return this.messages.getChatStorage(user.sub, chatId);
  }

  @Post('messages')
  async send(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: SendMessageBody
  ): Promise<MessageDto> {
    const created = await this.messages.send(user.sub, chatId, body);
    // Mirror the same broadcast the socket path emits, so REST-sent messages
    // reach connected clients in real time too. Idempotent on the receiving
    // side: clients reconcile by `clientMessageId` and discard duplicates.
    this.gateway.emitMessageNew(created);
    return created;
  }

  /**
   * Delete a message — Whatsapp-style.
   *   - `?scope=everyone` (default): soft-delete for all members, within the
   *     60-min edit window, only by the sender. Broadcasts `message:deleted`.
   *   - `?scope=self`: today aliases to everyone-by-self; the per-viewer hide
   *     table ships with the Super Group privacy layer.
   */
  @Delete('messages/:messageId')
  @HttpCode(204)
  async deleteMessage(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @Query(new ZodValidationPipe(z.object({ scope: MessageDeleteScopeSchema.default('everyone') })))
    query: { scope: MessageDeleteScope }
  ): Promise<void> {
    const result = await this.messages.deleteMessage(user.sub, chatId, messageId, query.scope);
    this.gateway.emitMessageDeleted({
      chatId,
      messageId: result.messageId,
      deletedByUserId: user.sub,
      scope: result.scope,
    });
  }
}
