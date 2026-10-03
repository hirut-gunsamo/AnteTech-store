import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  uploadReceiptController,
  getReceiptFileController,
  getReceiptsController,
  getReceiptController,
  getDaySummaryController,
  verifyReceiptController,
  rejectReceiptController,
  deleteReceiptController,
} from "./receipt.controller.js";

type ReceiptParams = {
  id: string;
};

export async function receiptRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Sellers see their own uploads, the Owner all.
  app.get<{
    Querystring: { status?: string; branchId?: string };
  }>("/", getReceiptsController);

  // Registered before "/:id" for readability; Fastify prefers static paths.
  app.get<{ Params: { filename: string } }>(
    "/file/:filename",
    getReceiptFileController,
  );

  app.get<{ Querystring: { date?: string; branchId?: string } }>(
    "/day-summary",
    {
      preHandler: [authorize(UserRole.OWNER, UserRole.SALES)],
    },
    getDaySummaryController,
  );

  app.get<{ Params: ReceiptParams }>(
    "/:id",
    getReceiptController,
  );

  // multipart/form-data: the image plus amount, receiptDate, bankName,
  // referenceNumber and an optional cashReportId.
  //
  // A seller banks their store's takings and records the deposit; the slip
  // is optional, since a transfer often comes with none. The Owner may record
  // one too.
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.OWNER, UserRole.SALES)],
    },
    uploadReceiptController,
  );

  app.patch<{ Params: ReceiptParams; Body: { notes?: string } }>(
    "/:id/verify",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    verifyReceiptController,
  );

  app.patch<{ Params: ReceiptParams; Body: { notes?: string } }>(
    "/:id/reject",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    rejectReceiptController,
  );

  app.delete<{ Params: ReceiptParams }>(
    "/:id",
    deleteReceiptController,
  );
}
