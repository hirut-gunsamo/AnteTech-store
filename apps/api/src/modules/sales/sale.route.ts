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

  // Only an unsubmitted draft can be removed
  app.delete<{ Params: SaleParams }>(
    "/:id",
    {
      preHandler: [
        authorize(UserRole.SALES, UserRole.OWNER),
      ],
    },
    deleteSaleController,
  );
}
