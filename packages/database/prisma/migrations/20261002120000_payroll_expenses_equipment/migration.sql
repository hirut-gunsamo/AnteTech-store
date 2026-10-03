-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('ELECTRONICS', 'FURNITURE', 'STATIONERY', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_USE', 'DAMAGED', 'RETIRED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "monthlySalary" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "OfficeAsset" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_USE',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "serialNumber" TEXT,
    "cost" DECIMAL(12,2),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deduction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeductionLine" (
    "id" TEXT NOT NULL,
    "deductionId" TEXT NOT NULL,
    "productId" TEXT,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "DeductionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "salary" DECIMAL(12,2) NOT NULL,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL,
    "carriedOver" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "paidById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "paidById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionLine" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "categoryId" TEXT,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "percent" DECIMAL(6,2),
    "amount" DECIMAL(12,2) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficeAsset_locationId_idx" ON "OfficeAsset"("locationId");

-- CreateIndex
CREATE INDEX "OfficeAsset_category_idx" ON "OfficeAsset"("category");

-- CreateIndex
CREATE INDEX "OfficeAsset_status_idx" ON "OfficeAsset"("status");

-- CreateIndex
CREATE INDEX "OfficeAsset_receivedAt_idx" ON "OfficeAsset"("receivedAt");

-- CreateIndex
CREATE INDEX "Expense_locationId_idx" ON "Expense"("locationId");

-- CreateIndex
CREATE INDEX "Expense_expenseDate_idx" ON "Expense"("expenseDate");

-- CreateIndex
CREATE INDEX "Deduction_userId_idx" ON "Deduction"("userId");

-- CreateIndex
CREATE INDEX "Deduction_day_idx" ON "Deduction"("day");

-- CreateIndex
CREATE INDEX "DeductionLine_deductionId_idx" ON "DeductionLine"("deductionId");

-- CreateIndex
CREATE INDEX "DeductionLine_productId_idx" ON "DeductionLine"("productId");

-- CreateIndex
CREATE INDEX "PayrollPayment_month_idx" ON "PayrollPayment"("month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_userId_month_key" ON "PayrollPayment"("userId", "month");

-- CreateIndex
CREATE INDEX "CommissionPayment_month_idx" ON "CommissionPayment"("month");

-- CreateIndex
CREATE INDEX "CommissionPayment_userId_idx" ON "CommissionPayment"("userId");

-- CreateIndex
CREATE INDEX "CommissionLine_paymentId_idx" ON "CommissionLine"("paymentId");

-- CreateIndex
CREATE INDEX "CommissionLine_categoryId_idx" ON "CommissionLine"("categoryId");

-- AddForeignKey
ALTER TABLE "OfficeAsset" ADD CONSTRAINT "OfficeAsset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeAsset" ADD CONSTRAINT "OfficeAsset_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionLine" ADD CONSTRAINT "DeductionLine_deductionId_fkey" FOREIGN KEY ("deductionId") REFERENCES "Deduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionLine" ADD CONSTRAINT "DeductionLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPayment" ADD CONSTRAINT "CommissionPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPayment" ADD CONSTRAINT "CommissionPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLine" ADD CONSTRAINT "CommissionLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CommissionPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLine" ADD CONSTRAINT "CommissionLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Money and counts that can never be negative, kept true by the database
-- itself as the rest of AnteTech's money columns are.
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "OfficeAsset" ADD CONSTRAINT "OfficeAsset_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "DeductionLine" ADD CONSTRAINT "DeductionLine_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_net_not_negative" CHECK ("net" >= 0 AND "carriedOver" >= 0);
ALTER TABLE "CommissionLine" ADD CONSTRAINT "CommissionLine_period_forward" CHECK ("periodEnd" > "periodStart");
