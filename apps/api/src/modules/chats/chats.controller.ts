import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ChatBooleanSetterSchema,
  ChatListQuerySchema,
  CreateChatFilterSchema,
  CreateGroupSchema,
  CreateOneOnOneSchema,
  CreateSuperGroupSchema,
  MarkReadSchema,
  MuteChatSchema,
  SetChatThemeSchema,
  type ChatBooleanSetterBody,
  type ChatFilterRow,
  type ChatFiltersListResponse,
  type ChatListQuery,
  type ChatListResponse,
  type ClearChatResponse,
  type CreateChatFilterBody,
  type CreateGroupBody,
  type CreateOneOnOneBody,
  type CreateSuperGroupBody,
  type MarkReadBody,
  type MuteChatBody,
  type MuteChatResponse,
  type SetChatThemeBody,
  type SetChatThemeResponse,
} from '@scalechat/shared';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MessagesGateway } from '../messages/messages.gateway';
import { ChatsService } from './chats.service';

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(
    private readonly chats: ChatsService,
    private readonly gateway: MessagesGateway,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodValidationPipe(ChatListQuerySchema)) query: ChatListQuery
  ): Promise<ChatListResponse> {
    return this.chats.list(user.sub, query.cursor, query.limit, query.filter, query.customFilterId);
  }

  /**
   * Custom filter CRUD. Mounted BEFORE the `:id/*` routes — NestJS matches in
   * declaration order so `/chats/filters` must shadow the `:id` placeholder
   * for "filters" not to be treated as a chat UUID. (NestJS would 400 on the
   * UUID pipe anyway, but explicit ordering is clearer.)
   */
  @Get('filters')
  listFilters(@CurrentUser() user: AccessTokenPayload): Promise<ChatFiltersListResponse> {
    return this.chats.listFilters(user.sub);
  }

  @Post('filters')
  createFilter(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(CreateChatFilterSchema)) body: CreateChatFilterBody
  ): Promise<ChatFilterRow> {
    return this.chats.createFilter(user.sub, body);
  }

  @Delete('filters/:id')
  @HttpCode(204)
  async deleteFilter(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
  ): Promise<void> {
    await this.chats.deleteFilter(user.sub, id);
  }

  @Post('one-on-one')
  createOneOnOne(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(CreateOneOnOneSchema)) body: CreateOneOnOneBody
  ): Promise<{ chatId: string }> {
    return this.chats.createOneOnOne(user.sub, body);
  }

  @Post('groups')
  createGroup(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(CreateGroupSchema)) body: CreateGroupBody
  ): Promise<{ chatId: string }> {
    return this.chats.createGroup(user.sub, body);
  }

  @Post('super-groups')
  createSuperGroup(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(CreateSuperGroupSchema)) body: CreateSuperGroupBody
  ): Promise<{ chatId: string }> {
    return this.chats.createSuperGroup(user.sub, body);
  }

  @Patch('read-all')
  @HttpCode(204)
  async markAllRead(@CurrentUser() user: AccessTokenPayload): Promise<void> {
    await this.chats.markAllRead(user.sub);
  }

  @Patch(':id/read')
  @HttpCode(204)
  async markRead(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(MarkReadSchema)) body: MarkReadBody
  ): Promise<void> {
    await this.chats.markRead(user.sub, id, body);
    // Notify other room members that this user has advanced their read cursor.
    this.gateway.emitReadReceipt(id, user.sub, body.uptoSequence);
  }

  @Patch(':id/favourite')
  toggleFavourite(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
  ): Promise<{ isFavourite: boolean }> {
    return this.chats.toggleFavourite(user.sub, id);
  }

  @Patch(':id/archive')
  toggleArchive(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
  ): Promise<{ isArchived: boolean }> {
    return this.chats.toggleArchive(user.sub, id);
  }

  @Patch(':id/mute')
  setMute(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(MuteChatSchema)) body: MuteChatBody,
  ): Promise<MuteChatResponse> {
    return this.chats.setMute(user.sub, id, body);
  }

  @Patch(':id/clear')
  clearChat(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ClearChatResponse> {
    return this.chats.clearChat(user.sub, id);
  }

  @Patch(':id/theme')
  setTheme(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(SetChatThemeSchema)) body: SetChatThemeBody,
  ): Promise<SetChatThemeResponse> {
    return this.chats.setTheme(user.sub, id, body);
  }

  /**
   * Idempotent setters paired with the PATCH toggles above. Bulk multi-select
   * fan-outs hit these so spam-taps don't flip state. The per-chat header
   * gesture still uses the toggle endpoints — caller chooses the semantic.
   */
  @Put(':id/favourite')
  setFavourite(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(ChatBooleanSetterSchema)) body: ChatBooleanSetterBody
  ): Promise<{ isFavourite: boolean }> {
    return this.chats.setFavourite(user.sub, id, body.value);
  }

  @Put(':id/archive')
  setArchive(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(ChatBooleanSetterSchema)) body: ChatBooleanSetterBody
  ): Promise<{ isArchived: boolean }> {
    return this.chats.setArchive(user.sub, id, body.value);
  }
}
