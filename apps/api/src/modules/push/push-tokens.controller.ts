import { Body, Controller, Delete, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { RegisterPushTokenSchema, type RegisterPushTokenBody } from '@scalechat/shared';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PushService } from './push.service';

/**
 * Push device registry (Tranche 2.I).
 *   POST   /push/tokens          JWT — upsert this device's Expo push token
 *   DELETE /push/tokens/:token   JWT — drop on logout
 */
@UseGuards(JwtAuthGuard)
@Controller('push/tokens')
export class PushTokensController {
  constructor(private readonly push: PushService) {}

  @Post()
  @HttpCode(204)
  async register(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(RegisterPushTokenSchema)) body: RegisterPushTokenBody,
  ): Promise<void> {
    await this.push.registerToken(user.sub, body.expoPushToken, body.platform);
  }

  @Delete(':token')
  @HttpCode(204)
  async remove(@Param('token') token: string): Promise<void> {
    await this.push.removeToken(token);
  }
}
