-- Add a mixed mode so one sale can carry both cash and transfer amounts.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CASH_AND_TRANSFER';
