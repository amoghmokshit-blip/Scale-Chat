import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ProfileUpdateSchema, type ProfileUpdateBody, type SelfUser } from '@scalechat/shared';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

/**
 * Self-view profile endpoints. Both are JWT-guarded — there is no path to read
 * /me without a verified access token.
 */
@UseGuards(JwtAuthGuard)
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AccessTokenPayload): Promise<SelfUser> {
    return this.users.getSelf(user.sub);
  }

  @Patch()
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(ProfileUpdateSchema)) body: ProfileUpdateBody,
  ): Promise<SelfUser> {
    return this.users.updateProfile(user.sub, body);
  }
}
