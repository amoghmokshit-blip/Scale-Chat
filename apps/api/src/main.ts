import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  // Validate env FIRST so misconfigs fail fast with a useful diagnostic.
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true, // Fly + Cloudflare set x-forwarded-for
      bodyLimit: 256 * 1024, // 256 KiB — way more than any auth payload should need
      requestIdHeader: 'x-request-id',
      genReqId: () =>
        // Cheap unique id — pino will surface this in every log line.
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    }),
    { bufferLogs: true },
  );

  // Replace the default logger with pino as soon as the container is ready.
  app.useLogger(app.get(PinoLogger));

  // LiveKit posts webhooks as `application/webhook+json`. Preserve the exact
  // raw bytes (no JSON re-parse) so the calls webhook controller can hand them
  // to LiveKit's `WebhookReceiver`, which verifies the signed `Authorization`
  // JWT against a sha256 of the body. Any re-serialisation would break it.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser(
    'application/webhook+json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  await app.register(helmet, { contentSecurityPolicy: false });

  app.enableCors({
    origin: env.ALLOWED_ORIGINS.length > 0 ? env.ALLOWED_ORIGINS : false,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-device-id', 'x-request-id'],
    maxAge: 86_400,
  });

  app.enableShutdownHooks();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  // eslint-disable-next-line no-console
  console.log(`[scalechat-api] listening on :${env.PORT} (${env.NODE_ENV})`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
