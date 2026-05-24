-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('SENT', 'VERIFIED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "SecurityEventKind" AS ENUM ('REFRESH_REPLAY_DETECTED', 'REFRESH_FAMILY_REVOKED', 'OTP_RATE_LIMIT_HIT', 'OTP_MAX_ATTEMPTS_HIT', 'SIGNOUT', 'PROFILE_UPDATED', 'PII_LEAK_DETECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phoneE164" VARCHAR(16) NOT NULL,
    "fullName" VARCHAR(60) NOT NULL,
    "bio" VARCHAR(160),
    "avatarUri" TEXT,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" VARCHAR(128) NOT NULL,
    "rotatedToId" UUID,
    "rotatedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" VARCHAR(256),
    "ipAddress" VARCHAR(64),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_requests" (
    "id" UUID NOT NULL,
    "phoneE164" VARCHAR(16) NOT NULL,
    "userId" UUID,
    "requestId" UUID NOT NULL,
    "status" "OtpStatus" NOT NULL DEFAULT 'SENT',
    "provider" VARCHAR(32) NOT NULL DEFAULT 'msg91',
    "providerRef" VARCHAR(128),
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(256),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMPTZ(6),

    CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "kind" "SecurityEventKind" NOT NULL,
    "userId" UUID,
    "phoneE164" VARCHAR(16),
    "ipAddress" VARCHAR(64),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneE164_key" ON "users"("phoneE164");

-- CreateIndex
CREATE INDEX "users_phoneE164_idx" ON "users"("phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_rotatedToId_key" ON "refresh_tokens"("rotatedToId");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "otp_requests_requestId_key" ON "otp_requests"("requestId");

-- CreateIndex
CREATE INDEX "otp_requests_phoneE164_createdAt_idx" ON "otp_requests"("phoneE164", "createdAt");

-- CreateIndex
CREATE INDEX "otp_requests_ipAddress_createdAt_idx" ON "otp_requests"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_kind_createdAt_idx" ON "security_events"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_userId_idx" ON "security_events"("userId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_requests" ADD CONSTRAINT "otp_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
