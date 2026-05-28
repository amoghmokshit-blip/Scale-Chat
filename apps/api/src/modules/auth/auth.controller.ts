import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import {
  OtpRequestSchema,
  OtpVerifySchema,
  RefreshBodySchema,
  type OtpRequestBody,
  type OtpRequestResponse,
  type OtpVerifyBody,
  type RefreshBody,
  type TokenPair,
} from '@scalechat/shared';

import type { Env } from '../../config/env';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OtpService } from './services/otp.service';
import { TokensService } from './services/tokens.service';

/**
 * Public auth endpoints. None of these are JWT-guarded — they're how a user
 * *obtains* a JWT in the first place.
 *
 * Routes:
 *   POST /auth/otp/request   — production-ready (country allow-list + rate limits + provider seam)
 *   POST /auth/otp/verify    — production-ready (provider seam: Twilio Verify or Dev/MSG91)
 *   POST /auth/refresh       — production-ready (family-rotation + replay detect)
 *   POST /auth/signout       — production-ready
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
  ) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(
    @Body(new ZodValidationPipe(OtpRequestSchema)) body: OtpRequestBody,
    @Req() req: FastifyRequest,
  ): Promise<OtpRequestResponse> {
    const ipAddress = extractIp(req);
    const userAgent = req.headers['user-agent'] ?? null;

    const outcome = await this.otp.request({
      phoneE164: body.phoneE164,
      ipAddress,
      userAgent,
    });

    if (!outcome.ok) {
      // Country gate is a client-side problem (unsupported market) → 400.
      // Everything else is a transient/server condition → 401 to match the
      // existing surface.
      if (outcome.reason === 'country_not_supported') {
        throw new BadRequestException({
          code: outcome.reason,
          message: 'Sign-ups from this country aren’t supported yet.',
        });
      }
      const message =
        outcome.reason === 'rate_limited_phone'
          ? 'Too many OTP requests for this number. Try again later.'
          : outcome.reason === 'rate_limited_ip'
            ? 'Too many OTP requests from this device. Try again later.'
            : 'We couldn’t send the OTP. Please try again.';
      throw new UnauthorizedException({
        code: outcome.reason,
        message,
        retryAfterMs: 'retryAfterMs' in outcome ? outcome.retryAfterMs : undefined,
      });
    }

    return {
      requestId: outcome.requestId,
      expiresAt: outcome.expiresAt.toISOString(),
      cooldownMs: outcome.cooldownMs,
    };
  }

  /**
   * OTP verify — production wiring.
   *
   * Flow:
   *   1. In dev (`ENABLE_DEV_OTP=true`) and when the request matches the
   *      configured `DEV_OTP_CODE`, accept without hitting the provider so
   *      contributors can run the mobile flow without provisioning an OTP
   *      first. Guarded by `loadEnv()` — refuses to start prod with
   *      `ENABLE_DEV_OTP=true`.
   *   2. Otherwise delegate to `OtpService.verify()` which delegates to the
   *      bound `OtpVerificationProvider` (Twilio Verify in prod when creds
   *      are set, DevVerifyProvider — argon2 + Redis + MSG91 — otherwise).
   *   3. On success upsert the User row and mint a fresh JWT pair via
   *      `TokensService.issueNew()`.
   */
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body(new ZodValidationPipe(OtpVerifySchema)) body: OtpVerifyBody,
    @Req() req: FastifyRequest,
  ): Promise<TokenPair> {
    const userId = await this.resolveUserIdForVerify(body);

    const pair = await this.tokens.issueNew({
      userId,
      deviceId: body.deviceId,
      ipAddress: extractIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      accessExpiresIn: pair.accessExpiresIn,
    };
  }

  private async resolveUserIdForVerify(body: OtpVerifyBody): Promise<string> {
    const enableDevOtp = this.config.get('ENABLE_DEV_OTP', { infer: true });
    const devCode = this.config.get('DEV_OTP_CODE', { infer: true });
    if (enableDevOtp && body.code === devCode) {
      const user = await this.prisma.user.upsert({
        where: { phoneE164: body.phoneE164 },
        create: { phoneE164: body.phoneE164, fullName: '' },
        update: {},
        select: { id: true },
      });
      return user.id;
    }

    const outcome = await this.otp.verify({ phoneE164: body.phoneE164, code: body.code });
    if (!outcome.ok) {
      const map = {
        invalid_code: 'Wrong OTP. Check your message again.',
        expired: 'OTP expired. Request a new one.',
        attempts_exceeded: 'Too many wrong attempts. Request a new OTP.',
      } as const;
      throw new UnauthorizedException({ code: outcome.reason, message: map[outcome.reason] });
    }
    return outcome.userId;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(RefreshBodySchema)) body: RefreshBody,
    @Req() req: FastifyRequest,
  ): Promise<TokenPair> {
    const deviceId = (req.headers['x-device-id'] as string | undefined) ?? 'unknown';
    const result = await this.tokens.rotate({
      presentedToken: body.refreshToken,
      deviceId,
      ipAddress: extractIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    if (!result) {
      throw new UnauthorizedException({
        code: 'invalid_refresh',
        message: 'Refresh token rejected. Sign in again.',
      });
    }
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessExpiresIn: result.accessExpiresIn,
    };
  }

  @Post('signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signout(
    @Body(new ZodValidationPipe(RefreshBodySchema)) body: RefreshBody,
  ): Promise<void> {
    // Best-effort: look up the row, revoke the whole family. Errors don't 500
    // because signout should be idempotent from the client's perspective.
    try {
      const [id] = body.refreshToken.split('.');
      if (!id) return;
      const row = await this.prisma.refreshToken.findUnique({ where: { id } });
      if (row && !row.revokedAt) {
        await this.tokens.revokeFamily(row.familyId, 'user_signout');
        await this.prisma.securityEvent.create({
          data: { kind: 'SIGNOUT', userId: row.userId },
        });
      }
    } catch (err) {
      this.logger.warn({ err }, 'signout cleanup failed (swallowed)');
    }
  }
}

function extractIp(req: FastifyRequest): string | null {
  // Trust the first `x-forwarded-for` entry (Fly + Cloudflare both set this).
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0]!.trim();
  return req.ip ?? null;
}
