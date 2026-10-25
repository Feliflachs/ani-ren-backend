CREATE TABLE "QuerySnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  CONSTRAINT "QuerySnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QuerySnapshot_userId_scope_idx" ON "QuerySnapshot"("userId", "scope");
CREATE INDEX "QuerySnapshot_expiresAt_idx" ON "QuerySnapshot"("expiresAt");
