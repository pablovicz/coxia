-- CreateEnum
CREATE TYPE "ProjectDocumentKind" AS ENUM ('document', 'sketch', 'receipt');

-- CreateTable
CREATE TABLE "project_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "ProjectDocumentKind" NOT NULL DEFAULT 'document',
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_documents_project_id_kind_idx" ON "project_documents"("project_id", "kind");

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

