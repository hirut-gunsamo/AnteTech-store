import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  getTransfersController,
  getTransferController,
  shipTransferController,
  receiveTransferController,
  cancelTransferController,
  createTransferController,
} from "./transfer.controller.js";

type TransferParams = {
  id: string;
};

export async function transferRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // The Owner moves stock between branches; it leaves the source at once.
  app.post(
    "/",
    { preHandler: [authorize(UserRole.OWNER)] },
    createTransferController,
  );

  // Both ends of a transfer can watch it: the sending store and the
  // receiving store. Scoping happens in the service.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    {
      preHandler: [authorize(UserRole.OWNER, UserRole.SALES)],
    },
    getTransfersController,
  );

  app.get<{ Params: TransferParams }>(
    "/:id",
    {
      preHandler: [authorize(UserRole.OWNER, UserRole.SALES)],
    },
    getTransferController,
  );

  // The Owner dispatches the goods: stock leaves the source store here.
  app.patch<{ Params: TransferParams }>(
    "/:id/ship",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    shipTransferController,
  );

  // A seller at the receiving store confirms what arrived: store stock goes
  // up here and the original request is closed. The Owner receives
  // transfers back into the main store.
  app.patch<{ Params: TransferParams }>(
    "/:id/receive",
    {
      preHandler: [authorize(UserRole.OWNER, UserRole.SALES)],
    },
    receiveTransferController,
  );

  app.patch<{ Params: TransferParams }>(
    "/:id/cancel",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    cancelTransferController,
  );
}
