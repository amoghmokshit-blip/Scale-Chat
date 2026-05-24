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
  MessageDeleteScopeSchema,
  MessageListQuerySchema,
  MessageSchema,
  SendMessageSchema,
  type ChatDetailDto,
  type MessageDeleteScope,
  type MessageDto,
  type MessageListQuery,
  type MessageListResponse,
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

  @Get('messages')
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Query(new ZodValidationPipe(MessageListQuerySchema)) query: MessageListQuery
  ): Promise<MessageListResponse> {
    return this.messages.list(user.sub, chatId, query.cursor, query.limit, query.direction);
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
