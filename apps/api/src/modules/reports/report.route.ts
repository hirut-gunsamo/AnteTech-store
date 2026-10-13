import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { authenticate, authorize } from "../../middleware/auth.js";
import { getProfitAndLoss } from "./profit.service.js";

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

  // Profit and loss: the Owner only. ?from=YYYY-MM-DD &to= &branchId=
  app.get<{ Querystring: { from?: string; to?: string; branchId?: string } }>(
    "/profit",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const day = /^\d{4}-\d{2}-\d{2}$/;
      const { from, to, branchId } = request.query;
      if ((from && !day.test(from)) || (to && !day.test(to))) {
        return reply.status(400).send({ message: "Use YYYY-MM-DD dates" });
      }
      return reply.send({ report: await getProfitAndLoss({ from, to, branchId }) });
    },
  );
}
