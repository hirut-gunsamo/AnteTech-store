import type { FastifyInstance } from "fastify";

import { authenticate } from "../../middleware/auth.js";

import {
  salesReportController,
  cashPositionController,
  inventoryReportController,
  dashboardController,
} from "./report.controller.js";

export async function reportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Every report is scoped in the service, so all roles may call them: a
  // seller sees their own figures, the Owner every store.

  // One call for a role's dashboard: today / week / month / year, stock and
  // outstanding cash.
  app.get("/dashboard", dashboardController);

  // ?period=daily|weekly|monthly|yearly &from= &to= &branchId= &format=csv
  app.get<{ Querystring: Record<string, string> }>(
    "/sales",
    salesReportController,
  );

  // What each salesperson sold, banked, and still holds. ?format=csv
  app.get<{ Querystring: Record<string, string> }>(
    "/cash-position",
    cashPositionController,
  );

  // Stock remaining per branch. ?format=csv
  app.get<{ Querystring: Record<string, string> }>(
    "/inventory",
    inventoryReportController,
  );
}
