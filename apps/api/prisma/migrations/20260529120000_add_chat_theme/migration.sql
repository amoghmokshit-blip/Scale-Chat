-- P2-Theme: per-user per-chat theme override on ChatMember.
ALTER TABLE "chat_members" ADD COLUMN "chat_theme" VARCHAR(32);
