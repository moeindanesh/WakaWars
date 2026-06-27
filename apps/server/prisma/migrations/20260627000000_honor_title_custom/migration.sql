-- Mark honor titles set by hand so the AI sync leaves them untouched
ALTER TABLE "ww_user"
  ADD COLUMN "ai_honor_title_custom" BOOLEAN NOT NULL DEFAULT false;
