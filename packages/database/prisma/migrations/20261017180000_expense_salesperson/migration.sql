-- Whose day an expense comes off. A seller's own expense is theirs; the
-- Owner names the seller when recording one for a store.
ALTER TABLE "Expense" ADD COLUMN "salespersonId" TEXT;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_salespersonId_fkey"
  FOREIGN KEY ("salespersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Expense_salespersonId_idx" ON "Expense"("salespersonId");

-- Expenses a seller recorded were always theirs.
UPDATE "Expense" e SET "salespersonId" = e."recordedById"
FROM "User" u WHERE u.id = e."recordedById" AND u.role = 'SALES';
