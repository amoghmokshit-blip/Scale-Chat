import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AccessTokenPayload } from './jwt.service';
import type { AuthedRequest } from './jwt-auth.guard';

/**
 * Inject the verified JWT payload of the calling user. Combine with `@UseGuards(JwtAuthGuard)`
 * so the type narrows correctly:
 *
 *   @UseGuards(JwtAuthGuard)
 *   @Get('me')
 *   me(@CurrentUser() user: AccessTokenPayload) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenPayload => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) {
      throw new Error('CurrentUser used without JwtAuthGuard');
    }
    return req.user;
  }
);
