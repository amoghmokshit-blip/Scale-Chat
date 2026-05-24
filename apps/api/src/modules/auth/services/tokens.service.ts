import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';

import type { Env } from '../../../config/env';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AppJwtService } from '../../../common/auth/jwt.service';

export type IssueTokenInput = {
  userId: string;
  deviceId: string;
  /** Existing family to rotate within, or null to start a new family. */
  familyId?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export type IssueTokenResult = {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  familyId: string;
};

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Issues and rotates the JWT access + opaque refresh token pair.
 *
 * Refresh-rotation contract (CLAUDE.md §4):
 *   - Each refresh issues a new (token, jti) pair tied to the same familyId.
 *   - The presented refresh row is `rotatedAt = now, rotatedToId = newRow.id`.
 *   - If a refresh is presented that has *already* been rotated, we treat that as
 *     a replay attack: revoke the entire family + log a SecurityEvent + return null.
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly jwt: AppJwtService,
  ) {}

  /** Issue a *fresh* pair (no rotation — call after verify or initial signup). */
  async issueNew(input: IssueTokenInput): Promise<IssueTokenResult> {
    const familyId = input.familyId ?? randomUUID();
    return this.issue(input, familyId, null);
  }

  /**
   * Verify a presented opaque refresh token + rotate it.
   * Returns `null` on any error (revocation, replay, expiry) — the controller
   * surfaces this as a 401.
   */
  async rotate(args: {
    presentedToken: string;
    deviceId: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<IssueTokenResult | null> {
    // Brute-force defence: the opaque token contains a UUID lookup id so we don't
    // have to argon2-compare every row.
    const decoded = decodeRefreshToken(args.presentedToken);
    if (!decoded) return null;

    const row = await this.prisma.refreshToken.findUnique({
      where: { id: decoded.id },
    });
    if (!row) return null;

    // Token signature mismatch → potential replay of a forged token id.
    const ok = await argon2.verify(row.tokenHash, args.presentedToken);
    if (!ok) {
      await this.recordSecurityEvent('REFRESH_REPLAY_DETECTED', {
        userId: row.userId,
        familyId: row.familyId,
        reason: 'token_hash_mismatch',
      });
      return null;
    }

    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;

    // Already rotated → replay.
    if (row.rotatedAt || row.rotatedToId) {
      await this.revokeFamily(row.familyId, 'replay_after_rotation');
      return null;
    }

    return this.issue(
      {
        userId: row.userId,
        deviceId: args.deviceId,
        familyId: row.familyId,
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
      },
      row.familyId,
      row.id
    );
  }

  /** Revoke every refresh in a family. Idempotent. */
  async revokeFamily(familyId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.recordSecurityEvent('REFRESH_FAMILY_REVOKED', { familyId, reason });
  }

  /** Revoke all refresh tokens for a user (signout-all-devices). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ──────────────── internal ────────────────

  private async issue(
    input: IssueTokenInput,
    familyId: string,
    previousRowId: string | null
  ): Promise<IssueTokenResult> {
    const refreshTtlDays = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + refreshTtlDays * 86_400_000);

    const newRowId = randomUUID();
    const raw = encodeRefreshToken(newRowId, randomBytes(32));
    const tokenHash = await argon2.hash(raw, ARGON2_OPTS);

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.create({
        data: {
          id: newRowId,
          userId: input.userId,
          familyId,
          tokenHash,
          deviceId: input.deviceId,
          expiresAt,
          ipAddress: input.ipAddress?.slice(0, 64) ?? null,
          userAgent: input.userAgent?.slice(0, 256) ?? null,
        },
      });

      if (previousRowId) {
        await tx.refreshToken.update({
          where: { id: previousRowId },
          data: { rotatedAt: new Date(), rotatedToId: newRowId },
        });
      }
    });

    const access = this.jwt.signAccessToken(input.userId);
    return {
      accessToken: access.token,
      refreshToken: raw,
      accessExpiresIn: access.expiresIn,
      familyId,
    };
  }

  private async recordSecurityEvent(
    kind: 'REFRESH_REPLAY_DETECTED' | 'REFRESH_FAMILY_REVOKED',
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.prisma.securityEvent.create({
        data: {
          kind,
          userId: typeof metadata.userId === 'string' ? metadata.userId : null,
          metadata: metadata as object,
        },
      });
    } catch (err) {
      this.logger.error({ err, kind, metadata }, 'failed to record security event');
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Opaque refresh-token encoding.
//
// The on-the-wire token is `<rowId>.<base64url(32 random bytes)>`. The `rowId`
// lets us look up the candidate row in O(1) without argon2-comparing every row;
// the random suffix is what argon2-verify confirms against `tokenHash`.
// ────────────────────────────────────────────────────────────────────────────

function encodeRefreshToken(rowId: string, secret: Buffer): string {
  return `${rowId}.${secret.toString('base64url')}`;
}

function decodeRefreshToken(token: string): { id: string; secret: string } | null {
  const [id, secret] = token.split('.');
  if (!id || !secret) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { id, secret };
}
