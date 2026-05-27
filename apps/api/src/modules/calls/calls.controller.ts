import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CallTokenRequestSchema,
  type CallAcceptResponse,
  type CallListResponse,
  type CallTokenRequestBody,
  type CallTokenResponse,
} from '@scalechat/shared';
import type { FastifyRequest } from 'fastify';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CallsService } from './calls.service';

/**
 * Calls REST surface (Tranche 2.H — 1-on-1 scope).
 *
 * Routes:
 *   POST   /calls/token                       JWT — mint token + ring callee
 *   POST   /calls/:callId/accept              JWT — callee accepts (lock-protected)
 *   POST   /calls/:callId/decline             JWT — callee declines
 *   POST   /calls/:callId/hangup              JWT — either peer hangs up
 *   POST   /calls/webhooks/livekit            (LiveKit-signed Authorization JWT)
 *   GET    /chats/:chatId/calls               JWT — per-chat history
 *
 * Two controllers because the path prefix splits between /calls and
 * /chats/:chatId/calls — same shape Polls uses (PollsCreateController +
 * PollsMessageController).
 */

@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post('token')
  @HttpCode(200)
  async token(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(CallTokenRequestSchema)) body: CallTokenRequestBody,
  ): Promise<CallTokenResponse> {
    return this.calls.mintToken(user.sub, body.chatId, body.kind);
  }

  @Post(':callId/accept')
  @HttpCode(200)
  async accept(
    @CurrentUser() user: AccessTokenPayload,
    @Param('callId', new ParseUUIDPipe({ version: '4' })) callId: string,
  ): Promise<CallAcceptResponse> {
    return this.calls.accept(user.sub, callId);
  }

  @Post(':callId/decline')
  @HttpCode(204)
  async decline(
    @CurrentUser() user: AccessTokenPayload,
    @Param('callId', new ParseUUIDPipe({ version: '4' })) callId: string,
  ): Promise<void> {
    await this.calls.decline(user.sub, callId);
  }

  @Post(':callId/hangup')
  @HttpCode(204)
  async hangup(
    @CurrentUser() user: AccessTokenPayload,
    @Param('callId', new ParseUUIDPipe({ version: '4' })) callId: string,
  ): Promise<void> {
    await this.calls.hangup(user.sub, callId);
  }
}

/**
 * Webhook is unauthenticated (LiveKit signs a JWT over the body's sha256 and
 * sends it in the `Authorization` header). Separated into its own controller
 * so the JwtAuthGuard doesn't trip on it. The `application/webhook+json`
 * content-type parser registered in `main.ts` makes `req.body` the raw Buffer
 * (LiveKit's `WebhookReceiver` needs the exact bytes to verify the signature).
 */
@Controller('calls/webhooks')
export class CallsWebhookController {
  constructor(private readonly calls: CallsService) {}

  @Post('livekit')
  @HttpCode(200)
  async receive(
    @Req() req: FastifyRequest,
    @Headers('authorization') authHeader: string | undefined,
  ): Promise<{ ok: true }> {
    const rawBody = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}), 'utf8');
    await this.calls.handleWebhook(rawBody, authHeader);
    return { ok: true };
  }
}

/**
 * Per-chat call history. Split from the main controller so the `:chatId`
 * scoping is structural (same pattern as `PinController.listPins`).
 */
@UseGuards(JwtAuthGuard)
@Controller('chats/:chatId')
export class CallsHistoryController {
  constructor(private readonly calls: CallsService) {}

  @Get('calls')
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Param('chatId', new ParseUUIDPipe({ version: '4' })) chatId: string,
  ): Promise<CallListResponse> {
    return this.calls.listForChat(user.sub, chatId);
  }
}
