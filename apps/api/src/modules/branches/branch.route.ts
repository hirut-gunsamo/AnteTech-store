import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createBranchController,
  getBranchesController,
  getBranchController,
  updateBranchController,
  changeBranchStatusController,
  deleteBranchController,
} from "./branch.controller.js";

type BranchParams = {
  id: string;
};

export async function branchRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Any signed-in user may list stores: sellers see their own and the main
  // store. Filter with ?isActive=&isMainStock=
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    getBranchesController,
  );

  app.get<{ Params: BranchParams }>(
    "/:id",
    getBranchController,
  );

  // Everything below changes the store structure - Owner only.
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    createBranchController,
  );

  app.patch<{ Params: BranchParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    updateBranchController,
  );

  // Close / reopen a selling store
  app.patch<{ Params: BranchParams }>(
    "/:id/status",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    changeBranchStatusController,
  );

  // Delete a selling store that has never been used
  app.delete<{ Params: BranchParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    deleteBranchController,
  );
}
