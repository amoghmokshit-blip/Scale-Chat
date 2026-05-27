import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AuthCommonModule } from './common/auth/auth-common.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrivacyInterceptor } from './common/interceptors/privacy.interceptor';
import { PrismaModule } from './common/prisma/prisma.module';
import { BullMQModule } from './common/queues/bullmq.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RedisModule } from './common/redis/redis.module';
import { ConfigModule } from './config/config.module';
import { AuthModule } from './modules/auth/auth.module';
import { BlocksModule } from './modules/blocks/blocks.module';
import { CallsModule } from './modules/calls/calls.module';
import { ChatsModule } from './modules/chats/chats.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ForwardModule } from './modules/forward/forward.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
import { MessagesModule } from './modules/messages/messages.module';
import { PinModule } from './modules/pin/pin.module';
import { PollsModule } from './modules/polls/polls.module';
import { PushModule } from './modules/push/push.module';
import { ReactionsModule } from './modules/reactions/reactions.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // Pretty in dev; structured JSON in prod (for log aggregators).
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        // Don't log full request bodies — they contain OTPs / tokens / phone numbers.
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.refreshToken', '*.accessToken', '*.code'],
        autoLogging: {
          ignore: (req) => req.url === '/health' || req.url === '/ready',
        },
      },
    }),
    PrismaModule,
    RedisModule,
    RateLimitModule,
    BullMQModule,
    AuthCommonModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ContactsModule,
    ChatsModule,
    MediaModule,
    MessagesModule,
    ReportsModule,
    BlocksModule,
    ReactionsModule,
    ForwardModule,
    PinModule,
    PollsModule,
    PushModule,
    CallsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: PrivacyInterceptor },
  ],
})
export class AppModule {}
