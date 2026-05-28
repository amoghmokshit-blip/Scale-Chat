import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';

import type { Env } from '../../config/env';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { AuthController } from './auth.controller';
import { Msg91Service } from './services/msg91.service';
import { OtpService } from './services/otp.service';
import { TokensService } from './services/tokens.service';
import { DevVerifyProvider } from './services/providers/dev-verify.provider';
import {
  OTP_VERIFICATION_PROVIDER,
  type OtpVerificationProvider,
} from './services/providers/otp-verification.provider';
import { TwilioVerifyProvider } from './services/providers/twilio-verify.provider';

const moduleLogger = new Logger('AuthModule');

/**
 * Factory-bound provider for OTP delivery + verification.
 *
 * Selection:
 *   - All three TWILIO_* env vars set → TwilioVerifyProvider (worldwide, managed).
 *   - Otherwise → DevVerifyProvider (argon2 + Redis + MSG91, or console-log
 *     when MSG91 creds are also absent — the dev/e2e path).
 *
 * `loadEnv()` refuses to start `NODE_ENV=production` without one of those two
 * paths configured, so the dev fallback in prod is impossible.
 */
@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [
    OtpService,
    TokensService,
    Msg91Service,
    {
      provide: OTP_VERIFICATION_PROVIDER,
      inject: [ConfigService, REDIS_CLIENT, Msg91Service],
      useFactory: (
        config: ConfigService<Env, true>,
        redis: Redis,
        msg91: Msg91Service,
      ): OtpVerificationProvider => {
        const accountSid = config.get('TWILIO_ACCOUNT_SID', { infer: true });
        const authToken = config.get('TWILIO_AUTH_TOKEN', { infer: true });
        const verifySid = config.get('TWILIO_VERIFY_SERVICE_SID', { infer: true });
        if (accountSid && authToken && verifySid) {
          moduleLogger.log('OTP provider: TwilioVerifyProvider (worldwide)');
          return new TwilioVerifyProvider(config, redis);
        }
        moduleLogger.log('OTP provider: DevVerifyProvider (argon2 + Redis + MSG91/console)');
        return new DevVerifyProvider(redis, msg91);
      },
    },
  ],
  exports: [TokensService],
})
export class AuthModule {}
