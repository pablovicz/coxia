-- CreateEnum
CREATE TYPE "SpaceStatus" AS ENUM ('available', 'unavailable', 'monthly_rental');

-- AlterTable
ALTER TABLE "spaces" ADD COLUMN     "color" TEXT NOT NULL DEFAULT 'floresta',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "icon" TEXT NOT NULL DEFAULT 'porta',
ADD COLUMN     "status" "SpaceStatus" NOT NULL DEFAULT 'available';

-- CreateTable
CREATE TABLE "space_photos" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "space_photos_storage_key_key" ON "space_photos"("storage_key");

-- CreateIndex
CREATE INDEX "space_photos_space_id_sort_order_idx" ON "space_photos"("space_id", "sort_order");

-- AddForeignKey
ALTER TABLE "space_photos" ADD CONSTRAINT "space_photos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_photos" ADD CONSTRAINT "space_photos_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Salas existentes: cores e ícones diferentes entre si (na ordem de exibição), para a agenda separar as salas.
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY sort_order, name) - 1 AS n FROM "spaces"
)
UPDATE "spaces" s
SET "color" = (ARRAY['floresta','terracota','azul','mostarda','ameixa','petroleo','rosa','grafite'])[(o.n % 8) + 1],
    "icon"  = (ARRAY['palco','musica','poltrona','paleta','microfone','camera','pessoas','porta'])[(o.n % 8) + 1]
FROM ordered o
WHERE s.id = o.id;
