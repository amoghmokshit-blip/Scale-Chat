/**
 * Jest global setup — runs ONCE before any test.
 *
 * Forces `NODE_ENV=test` + isolated `?schema=test_e2e` so tests never touch
 * the dev schema (where mokshith / Priya live). Then runs `prisma migrate
 * deploy` which both creates the schema (if missing) and applies every
 * migration in order. Idempotent on re-runs.
 *
 * Expectations:
 *   - Postgres + Redis are already reachable on the docker host ports
 *     (5433 / 6380) — run `npm run db:setup` once first.
 *   - On CI, set `TEST_DATABASE_URL_BASE` + `TEST_REDIS_URL` to point at
 *     whatever services the CI runner provides.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const TEST_SCHEMA = 'test_e2e';
const TEST_DB_BASE =
  process.env.TEST_DATABASE_URL_BASE ??
  'postgresql://scalechat:scalechat@localhost:5433/scalechat';
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380';
const TEST_DATABASE_URL = `${TEST_DB_BASE}?schema=${TEST_SCHEMA}`;

export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.ENABLE_DEV_OTP = 'false';
  // Country allow-list (Phase 2 OTP) — locked to India so the auth-otp suite
  // can assert rejections against non-IN numbers. Set HERE (not in a per-suite
  // beforeAll) because `NestConfigModule.forRoot()` validates the env at
  // module-import time, which happens before any Jest beforeAll runs.
  // All existing e2e suites seed users with +91 numbers, so this is a no-op
  // for them; the country gate accepts everything they create.
  process.env.OTP_ALLOWED_COUNTRIES = process.env.OTP_ALLOWED_COUNTRIES ?? 'IN';
  // Tell Prisma to suppress the cosmetic update-check spinner in CI logs.
  process.env.PRISMA_HIDE_UPDATE_MESSAGE = 'true';

  // `prisma migrate deploy` creates the schema (if missing) and applies all
  // pending migrations against the configured DATABASE_URL. Failure here
  // surfaces as a normal Jest setup error.
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
