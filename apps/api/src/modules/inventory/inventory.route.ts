import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  stockInController,
  getInventoryController,
  getLocationInventoryController,
  getStockSummaryController,
  getInventoryUnitsController,
  getStockMovementsController,
  adjustBalanceController,
  removeBalanceController,
  updateProductController,
} from "./inventory.controller.js";

type LocationParams = {
  locationId: string;
};

type InventoryQuery = Record<string, string>;

type BalanceParams = {
  id: string;
};

export async function inventoryRoutes(
  app: FastifyInstance,
) {
  app.addHook("preHandler", authenticate);

  // Every read is store-scoped inside the service: the Owner sees all
  // stores, a seller only their own. Role checks alone are not enough, so
  // these are open to all signed-in users and narrowed by the viewer's store
  // instead.

  // Full balance rows, optionally ?locationId=
  app.get<{ Querystring: InventoryQuery }>(
    "/",
    getInventoryController,
  );

  // Remaining stock totals by category - the Sales "available stock" view
  app.get<{ Querystring: InventoryQuery }>(
    "/summary",
    getStockSummaryController,
  );

  // Sold serialized units (IMEI / serial), optionally ?productId=&status=
  app.get<{ Querystring: InventoryQuery }>(
    "/units",
    getInventoryUnitsController,
  );

  // Stock movement history
  app.get<{ Querystring: InventoryQuery }>(
    "/movements",
    getStockMovementsController,
  );

  app.get<{ Params: LocationParams }>(
    "/location/:locationId",
    getLocationInventoryController,
  );

  // Only the Owner brings new stock into the system.
  app.post(
    "/stock-in",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    stockInController,
  );

  // Corrections. All Owner-only for the same reason stock-in is: these change
  // what the business believes it holds.

  // Set a balance to its true figure, recorded as an ADJUSTMENT movement
  app.patch<{ Params: BalanceParams }>(
    "/balance/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    adjustBalanceController,
  );

  // Remove an empty stock row
  app.delete<{ Params: BalanceParams }>(
    "/balance/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    removeBalanceController,
  );

  // Fix the product behind a row - its name, price or description
  app.patch<{ Params: BalanceParams }>(
    "/product/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    updateProductController,
  );
}
