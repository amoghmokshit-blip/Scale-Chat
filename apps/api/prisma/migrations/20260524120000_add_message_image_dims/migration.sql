-- Add intrinsic pixel dimensions to IMAGE messages so the bubble can reserve
-- aspect-ratio space pre-load (no jumpy paint).
ALTER TABLE "messages" ADD COLUMN "imageWidth" INTEGER;
ALTER TABLE "messages" ADD COLUMN "imageHeight" INTEGER;
