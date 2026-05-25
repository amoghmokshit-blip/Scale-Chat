import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { MessageDto, PinListResponse } from '@scalechat/shared';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { MessagesGateway } from '../messages/messages.gateway';
import { PinService } from './pin.service';

@UseGuards(JwtAuthGuard)
@Controller('chats/:chatId')
export class PinController {
  constructor(
    private readonly pin: PinService,
    private readonly gateway: MessagesGateway,
  ) {}

  /** PATCH /chats/:chatId/messages/:messageId/pin → updated MessageDto. */
  @Patch('messages/:messageId/pin')
  async pinMessage(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
  ): Promise<MessageDto> {
    const dto = await this.pin.pin(user.sub, chatId, messageId);
    this.gateway.emitMessagePinned({
      chatId,
      messageId,
      pinnedByUserId: user.sub,
      pinnedAt: dto.pinnedAt ?? new Date().toISOString(),
    });
    return dto;
  }

  /** DELETE /chats/:chatId/messages/:messageId/pin → updated MessageDto (idempotent). */
  @Delete('messages/:messageId/pin')
  @HttpCode(200)
  async unpinMessage(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
  ): Promise<MessageDto> {
    const dto = await this.pin.unpin(user.sub, chatId, messageId);
    this.gateway.emitMessageUnpinned({ chatId, messageId });
    return dto;
  }

  /** GET /chats/:chatId/pins → up to 3 pinned messages, newest pinned first. */
  @Get('pins')
  async listPins(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
  ): Promise<PinListResponse> {
    return this.pin.listPins(user.sub, chatId);
  }
}
