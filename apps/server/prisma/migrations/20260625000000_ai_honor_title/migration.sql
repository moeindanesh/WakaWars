-- Add AI-generated honor title cache to ww_user
ALTER TABLE "ww_user"
  ADD COLUMN "ai_honor_title" TEXT,
  ADD COLUMN "ai_honor_title_signature" TEXT,
  ADD COLUMN "ai_honor_title_generated_at" TIMESTAMP(3);

-- Index provider log timestamp to support retention deletes
CREATE INDEX "ww_provider_log_fetched_at_idx" ON "ww_provider_log"("fetched_at");
