-- One lot for a store: several requests go out together as one shipment and
-- are received together, as on the SIM app.
ALTER TABLE "StockRequest" ADD COLUMN "shipmentId" TEXT;

ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "StockRequest_shipmentId_idx" ON "StockRequest"("shipmentId");

-- Every request already sent was its own lot.
UPDATE "StockRequest" r SET "shipmentId" = t.id
FROM "StockTransfer" t WHERE t."requestId" = r.id;
