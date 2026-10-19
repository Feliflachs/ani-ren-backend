ALTER TABLE "LibraryEntry" ADD COLUMN "currentRatingId" INTEGER REFERENCES "RatingEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "LibraryEntry_currentRatingId_idx" ON "LibraryEntry"("currentRatingId");
-- Preserve the previously current vote. Historical edits did not record whether
-- stars changed, so updatedAt cannot safely reconstruct a rating decision.
UPDATE "LibraryEntry" SET "currentRatingId" = (
  SELECT MAX("id") FROM "RatingEntry"
  WHERE "RatingEntry"."userId" = "LibraryEntry"."userId"
    AND "RatingEntry"."animeId" = "LibraryEntry"."animeId"
);
CREATE TABLE "DiscoverySnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "animeIds" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  CONSTRAINT "DiscoverySnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DiscoverySnapshot_userId_key" ON "DiscoverySnapshot"("userId");
CREATE INDEX "DiscoverySnapshot_expiresAt_idx" ON "DiscoverySnapshot"("expiresAt");
