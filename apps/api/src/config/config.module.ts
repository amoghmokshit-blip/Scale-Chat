import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { loadEnv } from './env';

/**
 * Global config module. Re-exports `ConfigService<Env>` for everyone else;
 * `loadEnv()` runs once at startup and throws on misconfig.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: false,
      cache: true,
      validate: (raw) => loadEnv(raw as NodeJS.ProcessEnv),
    }),
  ],
})
export class ConfigModule {}
