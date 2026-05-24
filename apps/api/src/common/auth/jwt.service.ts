import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';

import type { Env } from '../../config/env';

/**
 * Access-token claims. `sub` is the user id; `jti` lets us invalidate a specific
 * token (planned, not yet implemented). `kind: 'access'` discriminates against
 * any opaque refresh-token use should the two ever cross paths.
 */
export type AccessTokenPayload = {
  sub: string;
  jti: string;
  kind: 'access';
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
};

/**
 * Service that signs / verifies RS256 access tokens. Refresh tokens are
 * opaque (random bytes) and stored argon2-hashed in Postgres — see TokensService.
 */
@Injectable()
export class AppJwtService implements OnModuleInit {
  private privateKey!: string;
  private publicKey!: string;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly nestJwt: NestJwtService,
  ) {}

  onModuleInit(): void {
    this.privateKey = decodeBase64Pem(this.config.get('JWT_PRIVATE_KEY_B64', { infer: true }));
    this.publicKey = decodeBase64Pem(this.config.get('JWT_PUBLIC_KEY_B64', { infer: true }));
  }

  signAccessToken(userId: string): { token: string; jti: string; expiresIn: number } {
    const jti = randomUUID();
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    const payload: AccessTokenPayload = { sub: userId, jti, kind: 'access' };
    const token = this.nestJwt.sign(payload, {
      algorithm: 'RS256',
      privateKey: this.privateKey,
      issuer: this.config.get('JWT_ISSUER', { infer: true }),
      audience: this.config.get('JWT_AUDIENCE', { infer: true }),
      expiresIn,
    });
    return { token, jti, expiresIn };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.nestJwt.verify<AccessTokenPayload>(token, {
      algorithms: ['RS256'],
      publicKey: this.publicKey,
      issuer: this.config.get('JWT_ISSUER', { infer: true }),
      audience: this.config.get('JWT_AUDIENCE', { infer: true }),
    });
  }
}

function decodeBase64Pem(value: string): string {
  // Allow already-decoded PEM through unchanged for local dev convenience.
  if (value.startsWith('-----BEGIN')) return value;
  return Buffer.from(value, 'base64').toString('utf8');
}
