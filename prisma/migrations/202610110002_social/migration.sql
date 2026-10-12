-- Conservar las reviews existentes y sus IDs. RatingEntry no se reconstruye:
-- mantiene la restricción SQL de estrellas de la migración inicial.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

ALTER TABLE "LibraryEntry" ADD COLUMN "watchlist" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LibraryEntry" ADD COLUMN "favoritePosition" INTEGER CHECK ("favoritePosition" IS NULL OR "favoritePosition" BETWEEN 0 AND 99);
CREATE INDEX "LibraryEntry_userId_watchlist_id_idx" ON "LibraryEntry"("userId", "watchlist", "id");
CREATE UNIQUE INDEX "LibraryEntry_userId_favoritePosition_key" ON "LibraryEntry"("userId", "favoritePosition");

CREATE TABLE "new_Publication" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'review',
    "ratingEntryId" INTEGER,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "spoiler" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "Publication_kind_rating_check" CHECK (
      ("kind" = 'review' AND "ratingEntryId" IS NOT NULL) OR
      ("kind" = 'post' AND "ratingEntryId" IS NULL)
    ),
    CONSTRAINT "Publication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Publication_ratingEntryId_fkey" FOREIGN KEY ("ratingEntryId") REFERENCES "RatingEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Publication" ("id", "userId", "ratingEntryId", "title", "text", "spoiler", "createdAt", "updatedAt")
SELECT "id", "userId", "ratingEntryId", "title", "text", "spoiler", "createdAt", "updatedAt" FROM "Publication";
DROP TABLE "Publication";
ALTER TABLE "new_Publication" RENAME TO "Publication";
CREATE UNIQUE INDEX "Publication_ratingEntryId_key" ON "Publication"("ratingEntryId");
CREATE INDEX "Publication_userId_id_idx" ON "Publication"("userId", "id");

CREATE TABLE "PublicationAnime" (
    "publicationId" INTEGER NOT NULL,
    "animeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    PRIMARY KEY ("publicationId", "animeId"),
    FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("animeId") REFERENCES "Anime" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PublicationAnime_publicationId_position_key" ON "PublicationAnime"("publicationId", "position");
CREATE INDEX "PublicationAnime_animeId_publicationId_idx" ON "PublicationAnime"("animeId", "publicationId");

CREATE TABLE "Follow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "followerId" TEXT NOT NULL,
    "followedId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ("followerId" <> "followedId"),
    FOREIGN KEY ("followerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("followedId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Follow_followerId_followedId_key" ON "Follow"("followerId", "followedId");
CREATE INDEX "Follow_followerId_id_idx" ON "Follow"("followerId", "id");
CREATE INDEX "Follow_followedId_id_idx" ON "Follow"("followedId", "id");

CREATE TABLE "PublicationLike" (
    "userId" TEXT NOT NULL,
    "publicationId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("userId", "publicationId"),
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PublicationLike_publicationId_idx" ON "PublicationLike"("publicationId");

CREATE TABLE "Comment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "publicationId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Comment_publicationId_id_idx" ON "Comment"("publicationId", "id");

COMMIT;
PRAGMA foreign_keys=ON;
