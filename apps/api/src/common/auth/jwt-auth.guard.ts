import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AppJwtService, type AccessTokenPayload } from './jwt.service';

/** Token claims attached to authed requests for the `@CurrentUser()` decorator. */
export type AuthedRequest = FastifyRequest & { user?: AccessTokenPayload };

/**
 * Bearer-token guard. Reads `Authorization: Bearer <token>`, verifies RS256
 * signature + issuer + audience, attaches the payload to `req.user`.
 *
 * Anonymous endpoints (otp/request, otp/verify, refresh) opt out by NOT
 * applying this guard — there is no `@Public()` escape hatch by design.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: AppJwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({ code: 'missing_token', message: 'Authorization header missing.' });
    }
    const token = header.slice(7).trim();
    try {
      req.user = this.jwt.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException({ code: 'invalid_token', message: 'Token is invalid or expired.' });
    }
    return true;
  }
}
