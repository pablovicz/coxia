-- Quem já pediu orçamento pelo site (e não é residente) passa a ser "lead".
-- Separada da migração que cria o valor do enum: o Postgres não deixa usar um valor novo na mesma transação.
UPDATE "contacts" c
SET "kind" = 'lead'
WHERE c."kind" = 'contact'
  AND EXISTS (SELECT 1 FROM "quote_requests" q WHERE q."contact_id" = c."id");
