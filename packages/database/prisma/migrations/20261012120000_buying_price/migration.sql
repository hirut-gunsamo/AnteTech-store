-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "costPrice" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "unitCost" DECIMAL(12,2);


-- Money can never be negative, kept true by the database itself.
ALTER TABLE "Product" ADD CONSTRAINT "Product_costPrice_not_negative" CHECK ("costPrice" IS NULL OR "costPrice" >= 0);
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_unitCost_not_negative" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);
