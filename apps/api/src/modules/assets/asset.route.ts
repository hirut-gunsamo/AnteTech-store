import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import { authenticate, authorize } from "../../middleware/auth.js";

import {
  createAssetController,
  deleteAssetController,
  getAssetsController,
  updateAssetController,
} from "./asset.controller.js";

type AssetParams = { id: string };

export async function assetRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Store-scoped in the service: a seller sees their own store's equipment,
  // the Owner every store's.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    { preHandler: [authorize(UserRole.OWNER, UserRole.SALES)] },
    getAssetsController,
  );

  // The Owner buys and ships equipment, so the Owner records it.
  app.post(
    "/",
    { preHandler: [authorize(UserRole.OWNER)] },
    createAssetController,
  );

  // A seller may only change the status of their own store's equipment; the
  // service refuses anything else.
  app.patch<{ Params: AssetParams }>(
    "/:id",
    { preHandler: [authorize(UserRole.OWNER, UserRole.SALES)] },
    updateAssetController,
  );

  app.delete<{ Params: AssetParams }>(
    "/:id",
    { preHandler: [authorize(UserRole.OWNER)] },
    deleteAssetController,
  );
}
