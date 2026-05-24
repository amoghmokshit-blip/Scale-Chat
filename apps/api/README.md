let# ScaleChat API

NestJS + Fastify backend for ScaleChat. Current scope:

- `POST /auth/otp/request` — MSG91 OTP send, rate-limited 5/h per phone + 20/h per IP, argon2-hashed code in Redis (300s TTL), durable audit row in Postgres.
- `POST /auth/otp/verify` — **STUB.** Returns `501` unless `ENABLE_DEV_OTP=true`, in which case it accepts `DEV_OTP_CODE` and issues tokens. Real verify lands in the next ticket.
- `POST /auth/refresh` — RS256 access + opaque refresh, family-based rotation with replay detection.
- `POST /auth/signout` — revokes the presented refresh family.
- `GET /me`, `PATCH /me` — JWT-guarded self-profile read + update.
- `GET /health`, `GET /ready` — Fly health checks (process + db + redis).

## Architecture reference

This implements §4 of the root [`../../my-app/CLAUDE.md`](../../my-app/CLAUDE.md). Read that before changing anything in `src/common/` — the privacy interceptor, branded types, and refresh-rotation contract are load-bearing for chat once it ships.

## Local setup

```bash
# From the repo root
npm install
cp apps/api/.env.example apps/api/.env

# Generate an RS256 keypair (development only — use a secrets manager in prod)
openssl genpkey -algorithm RSA -out /tmp/scalechat-private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -in /tmp/scalechat-private.pem -pubout -out /tmp/scalechat-public.pem
echo "JWT_PRIVATE_KEY_B64=$(base64 -i /tmp/scalechat-private.pem | tr -d '\n')" >> apps/api/.env
echo "JWT_PUBLIC_KEY_B64=$(base64 -i /tmp/scalechat-public.pem | tr -d '\n')" >> apps/api/.env

# Start dependencies (or use Docker Compose if you prefer)
docker run -d --name scalechat-pg -p 5432:5432 -e POSTGRES_DB=scalechat -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
docker run -d --name scalechat-redis -p 6379:6379 redis:7

# Generate Prisma client + run migrations
npm --workspace=apps/api run prisma:generate
npm --workspace=apps/api run prisma migrate dev --name init

# Build the shared package, then start the API
npm --workspace=packages/shared run build
npm run api:dev
```

In development, set `ENABLE_DEV_OTP=true` and the OTP printed in stdout (or `DEV_OTP_CODE=1234`) is accepted by `/auth/otp/verify`.

## Production deploy (Fly.io, ap-south-1 / Bombay)

```bash
# One-time
fly apps create scalechat-api --org <org>
fly secrets set \
  DATABASE_URL=postgresql://… \
  REDIS_URL=rediss://… \
  JWT_PRIVATE_KEY_B64=$(base64 -i private.pem | tr -d '\n') \
  JWT_PUBLIC_KEY_B64=$(base64 -i public.pem | tr -d '\n') \
  MSG91_AUTH_KEY=… \
  MSG91_TEMPLATE_ID=… \
  ALLOWED_ORIGINS=https://app.scalechat.app

# Each release
fly deploy --app scalechat-api --config apps/api/fly.toml --dockerfile Dockerfile
```

## What's intentionally NOT here yet

- **OTP verify implementation** — deferred per the current ticket. The stub returns 501 in production; the real impl belongs in `OtpService.verify()` and will replace the dev-mode branch in `AuthController.verifyOtp`.
- **Chat / Socket.IO gateway** — out of scope for account setup.
- **Razorpay payments** — out of scope until premium-admin sign-up ships.
- **BullMQ workers** — there is no offline-push fan-out yet (no chat). Worker entrypoint lands with chat.
- **PrivacyInterceptor fail-closed mode** — currently in audit mode. Flips when the first member-context endpoint ships.

## Error envelope

Every error response uses the same shape, so the mobile client can branch on `code` without parsing `message`:

```json
{
  "error": {
    "code": "rate_limited_phone",
    "message": "Too many OTP requests for this number. Try again later.",
    "retryAfterMs": 1234567,
    "requestId": "ltq8xy5g-abc123"
  }
}
```

## Privacy invariant (read this if you're adding endpoints)

Per CLAUDE.md §4 "Privacy engine": **a non-admin viewer must never receive a payload containing real `userId`, `phone`, or `displayName` of another user**. The `PrivacyInterceptor` is currently in audit mode — it'll flip to fail-closed when the first chat endpoint ships. Until then, any new endpoint that returns *another user's* data MUST go through `brandAsMasked()` from `@scalechat/shared`.

`/me` is exempt because the self-view legitimately includes the caller's own PII.
