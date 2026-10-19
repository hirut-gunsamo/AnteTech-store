import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createSaleController,
  getSalesController,
  getSaleController,
  deleteSaleController,
  updateSaleController,
  requestSaleEditController,
  listEditRequestsController,
  allowSaleEditsController,
  declineEditRequestController,
} from "./sale.controller.js";

type SaleParams = {
  id: string;
};

export async function saleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Sellers see their own sales, the Owner everything. The narrowing happens
  // in the service.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    getSalesController,
  );

  app.get<{ Params: SaleParams }>(
    "/:id",
    getSaleController,
  );

  // A seller records a sale against their own store's stock
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.SALES)],
    },
    createSaleController,
  );

  // Days sellers asked to correct, waiting on the Owner. Before "/:id".
  app.get(
    "/edit-requests",
    { preHandler: [authorize(UserRole.OWNER)] },
    listEditRequestsController,
  );

  // The Owner lets a seller correct one day's sales, until midnight.
  app.post(
    "/edit-requests/allow",
    { preHandler: [authorize(UserRole.OWNER)] },
    allowSaleEditsController,
  );

  app.post(
    "/edit-requests/decline",
    { preHandler: [authorize(UserRole.OWNER)] },
    declineEditRequestController,
  );

  // A seller corrects their own sale: on its day, or once the Owner allowed it.
  app.put<{ Params: SaleParams }>(
    "/:id",
    { preHandler: [authorize(UserRole.SALES)] },
    updateSaleController,
  );

  // A seller asks the Owner to let them correct a past day's sale.
  app.post<{ Params: SaleParams }>(
    "/:id/request-edit",
    { preHandler: [authorize(UserRole.SALES)] },
    requestSaleEditController,
  );

  // Only an unsubmitted draft can be removed
  app.delete<{ Params: SaleParams; Body: { restock?: boolean } | undefined }>(
    "/:id",
    {
      preHandler: [
        authorize(UserRole.SALES, UserRole.OWNER),
      ],
    },
    deleteSaleController,
  );
}
