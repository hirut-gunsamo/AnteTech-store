-- A seller corrects their own sale on its day; a past day only once the Owner
-- allows it, until the end of that day. As on the SIM app.
ALTER TABLE "Sale" ADD COLUMN "editAllowedUntil" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "editRequestedAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "editedAt" TIMESTAMP(3);
