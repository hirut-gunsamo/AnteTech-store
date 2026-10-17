-- The Owner may send stock to a store that did not ask: the request is filed
-- for that store and marked as raised by the Owner.
ALTER TABLE "StockRequest" ADD COLUMN "sentByOwner" BOOLEAN NOT NULL DEFAULT false;
