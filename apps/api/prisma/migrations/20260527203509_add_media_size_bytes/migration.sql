-- Tranche P2-Storage: unified media size column.
-- NULL for pre-existing rows and non-media kinds (TEXT/SYSTEM/LOCATION/CONTACT_CARD).
-- Populated on send for IMAGE/VOICE/VIDEO/DOCUMENT.
ALTER TABLE "messages" ADD COLUMN "mediaSizeBytes" BIGINT;
