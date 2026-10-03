import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createCashReportController,
  getCashReportsController,
  getCashReportController,
  submitCashReportController,
  approveCashReportController,
  rejectCashReportController,
} from "./cashReport.controller.js";

type ReportParams = {
  id: string;
};

export async function cashReportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Sellers see their own reports, the Owner all.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    getCashReportsController,
  );

  app.get<{ Params: ReportParams }>(
    "/:id",
    getCashReportController,
  );

  // A seller reconciles a period, then submits it to the Owner
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.SALES)],
    },
    createCashReportController,
  );

  app.patch<{ Params: ReportParams }>(
    "/:id/submit",
    {
      preHandler: [authorize(UserRole.SALES)],
    },
    submitCashReportController,
  );

  // The Owner checks the cash against the sales
  app.patch<{ Params: ReportParams }>(
    "/:id/approve",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    approveCashReportController,
  );

  app.patch<{ Params: ReportParams }>(
    "/:id/reject",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    rejectCashReportController,
  );

}
