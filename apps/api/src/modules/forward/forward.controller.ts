import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ForwardRequestSchema, type ForwardRequestBody, type ForwardResponse } from '@scalechat/shared';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MessagesGateway } from '../messages/messages.gateway';
import { ForwardService } from './forward.service';

@UseGuards(JwtAuthGuard)
@Controller('messages/:messageId/forward')
export class ForwardController {
  constructor(
    private readonly forward: ForwardService,
    private readonly gateway: MessagesGateway,
  ) {}

  /**
   * POST /messages/:messageId/forward
   * Body: { targetChatIds: string[] }
   *
   * Returns the created copies + any skipped targets. Each delivered copy is
   * broadcast as `message:new` on its target chat room so the recipient sees
   * it without a refetch.
   */
  @Post()
  async forwardMessage(
    @CurrentUser() user: AccessTokenPayload,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @Body(new ZodValidationPipe(ForwardRequestSchema)) body: ForwardRequestBody,
  ): Promise<ForwardResponse> {
    const result = await this.forward.forward(user.sub, messageId, body.targetChatIds);
    for (const item of result.items) {
      this.gateway.emitMessageNew(item);
    }
    return result;
  }
}
