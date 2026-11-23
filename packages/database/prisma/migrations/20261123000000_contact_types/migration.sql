-- AlterEnum
ALTER TYPE "ContactKind" ADD VALUE 'lead';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "type_id" TEXT;

-- CreateTable
CREATE TABLE "contact_types" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contact_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_types_organization_id_name_key" ON "contact_types"("organization_id", "name");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "contact_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_types" ADD CONSTRAINT "contact_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

