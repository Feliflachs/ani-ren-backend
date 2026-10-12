-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "normalizedHandle" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Anime" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "japanese" TEXT,
    "imageUrl" TEXT,
    "synopsis" TEXT,
    "episodes" INTEGER,
    "year" INTEGER,
    "season" TEXT,
    "genres" JSONB NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LibraryEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "watched" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "LibraryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LibraryEntry_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RatingEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "animeId" TEXT NOT NULL,
    "rating" REAL NOT NULL CHECK ("rating" >= 0.5 AND "rating" <= 5 AND "rating" * 2 = CAST("rating" * 2 AS INTEGER)),
    "watchedOn" TEXT,
    "rewatched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "RatingEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RatingEntry_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "ratingEntryId" INTEGER NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "spoiler" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "Publication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Publication_ratingEntryId_fkey" FOREIGN KEY ("ratingEntryId") REFERENCES "RatingEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Operation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedHandle_key" ON "User"("normalizedHandle");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Anime_externalId_key" ON "Anime"("externalId");

-- CreateIndex
CREATE INDEX "LibraryEntry_userId_watched_id_idx" ON "LibraryEntry"("userId", "watched", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryEntry_userId_animeId_key" ON "LibraryEntry"("userId", "animeId");

-- CreateIndex
CREATE INDEX "RatingEntry_userId_animeId_id_idx" ON "RatingEntry"("userId", "animeId", "id");

-- CreateIndex
CREATE INDEX "RatingEntry_animeId_idx" ON "RatingEntry"("animeId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_ratingEntryId_key" ON "Publication"("ratingEntryId");

-- CreateIndex
CREATE INDEX "Publication_userId_id_idx" ON "Publication"("userId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_userId_key_key" ON "Operation"("userId", "key");
