-- No inferir países para actividad anterior: los registros existentes quedan sin país.
ALTER TABLE "RatingEntry" ADD COLUMN "countryCode" TEXT;
CREATE INDEX "RatingEntry_countryCode_createdAt_animeId_idx" ON "RatingEntry"("countryCode", "createdAt", "animeId");
