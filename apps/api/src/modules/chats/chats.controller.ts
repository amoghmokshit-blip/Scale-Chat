import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ChatListQuerySchema,
  CreateGroupSchema,
  CreateOneOnOneSchema,
  CreateSuperGroupSchema,
  MarkReadSchema,
  type ChatListQuery,
  type ChatListResponse,
  type CreateGroupBody,
  type CreateOneOnOneBody,
  type CreateSuperGroupBody,
  type MarkReadBody,
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
    return this.chats.list(user.sub, query.cursor, query.limit, query.filter);
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
}
