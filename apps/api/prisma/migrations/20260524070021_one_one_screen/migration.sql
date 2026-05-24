-- CreateEnum
CREATE TYPE "ChatKind" AS ENUM ('ONE_ON_ONE', 'GROUP', 'SUPER_GROUP');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'VOICE', 'IMAGE', 'SYSTEM');

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "contactUserId" UUID,
    "phoneE164" VARCHAR(16) NOT NULL,
    "displayName" VARCHAR(60) NOT NULL,
    "favouriteAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" UUID NOT NULL,
    "kind" "ChatKind" NOT NULL,
    "title" VARCHAR(80),
    "description" VARCHAR(280),
    "avatarUri" TEXT,
    "createdByUserId" UUID NOT NULL,
    "lastMessageId" UUID,
    "lastMessageAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_members" (
    "id" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(6),
    "mutedUntil" TIMESTAMPTZ(6),
    "pinnedAt" TIMESTAMPTZ(6),
    "archivedAt" TIMESTAMPTZ(6),
    "favouriteAt" TIMESTAMPTZ(6),
    "lastReadSequence" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "chat_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "chatId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "clientMessageId" VARCHAR(64) NOT NULL,
    "sequence" BIGINT NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "text" VARCHAR(4000),
    "mediaObjectKey" VARCHAR(256),
    "durationSec" INTEGER,
    "waveform" JSONB,
    "replyToMessageId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_ownerUserId_favouriteAt_idx" ON "contacts"("ownerUserId", "favouriteAt");

-- CreateIndex
CREATE INDEX "contacts_contactUserId_idx" ON "contacts"("contactUserId");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_ownerUserId_phoneE164_key" ON "contacts"("ownerUserId", "phoneE164");

-- CreateIndex
CREATE INDEX "chats_kind_lastMessageAt_idx" ON "chats"("kind", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chats_lastMessageAt_idx" ON "chats"("lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_members_userId_archivedAt_idx" ON "chat_members"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "chat_members_userId_favouriteAt_idx" ON "chat_members"("userId", "favouriteAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_members_chatId_userId_key" ON "chat_members"("chatId", "userId");

-- CreateIndex
CREATE INDEX "messages_chatId_createdAt_idx" ON "messages"("chatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_senderUserId_clientMessageId_key" ON "messages"("senderUserId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_chatId_sequence_key" ON "messages"("chatId", "sequence");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contactUserId_fkey" FOREIGN KEY ("contactUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_lastMessageId_fkey" FOREIGN KEY ("lastMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
