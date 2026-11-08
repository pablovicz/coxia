-- CreateEnum
CREATE TYPE "BillKind" AS ENUM ('monthly', 'one_time');

-- AlterTable
ALTER TABLE "recurring_bills" ADD COLUMN     "expense_category_id" TEXT,
ADD COLUMN     "kind" "BillKind" NOT NULL DEFAULT 'monthly',
ADD COLUMN     "late_fee_cents" INTEGER;

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'outros',
    "color" TEXT NOT NULL DEFAULT 'grafite',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organization_id_name_key" ON "expense_categories"("organization_id", "name");

-- AddForeignKey
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Categorias iniciais em cada organização; as contas existentes ficam em "Casa".
INSERT INTO "expense_categories" ("id", "organization_id", "name", "icon", "color", "sort_order", "updated_at")
SELECT 'ec' || md5(o.id || ':' || c.name), o.id, c.name, c.icon, c.color, c.ord, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES ('Casa', 'casa', 'floresta', 1), ('Estoque', 'estoque', 'mostarda', 2), ('Manutenção', 'manutencao', 'terracota', 3)) AS c(name, icon, color, ord)
ON CONFLICT ("organization_id", "name") DO NOTHING;

UPDATE "recurring_bills" b
SET "expense_category_id" = ec.id
FROM "expense_categories" ec
WHERE ec.organization_id = b.organization_id AND ec.name = 'Casa' AND b.expense_category_id IS NULL;
