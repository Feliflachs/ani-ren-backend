ALTER TABLE "Comment" ADD COLUMN "parentId" INTEGER REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE INDEX "Comment_publicationId_parentId_id_idx" ON "Comment"("publicationId", "parentId", "id");
