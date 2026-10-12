-- CreateTable
CREATE TABLE "AnimeList" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "ordered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME,
    CONSTRAINT "AnimeList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListItem" (
    "listId" INTEGER NOT NULL,
    "animeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    PRIMARY KEY ("listId", "animeId"),
    CONSTRAINT "ListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "AnimeList" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListItem_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListLike" (
    "userId" TEXT NOT NULL,
    "listId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "listId"),
    CONSTRAINT "ListLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListLike_listId_fkey" FOREIGN KEY ("listId") REFERENCES "AnimeList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "FeedSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedItem" (
    "snapshotId" TEXT NOT NULL,
    "publicationId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,

    PRIMARY KEY ("snapshotId", "publicationId"),
    CONSTRAINT "FeedItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "FeedSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeedItem_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AnimeList_userId_id_idx" ON "AnimeList"("userId", "id");

-- CreateIndex
CREATE INDEX "ListItem_animeId_idx" ON "ListItem"("animeId");

-- CreateIndex
CREATE UNIQUE INDEX "ListItem_listId_position_key" ON "ListItem"("listId", "position");

-- CreateIndex
CREATE INDEX "ListLike_listId_idx" ON "ListLike"("listId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedSnapshot_userId_key" ON "FeedSnapshot"("userId");

-- CreateIndex
CREATE INDEX "FeedSnapshot_expiresAt_idx" ON "FeedSnapshot"("expiresAt");

-- CreateIndex
CREATE INDEX "FeedItem_publicationId_idx" ON "FeedItem"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedItem_snapshotId_position_key" ON "FeedItem"("snapshotId", "position");
