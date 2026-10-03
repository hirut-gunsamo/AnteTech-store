import type { FastifyInstance } from "fastify";
import { UserRole } from "database";

import {
  authenticate,
  authorize,
} from "../../middleware/auth.js";

import {
  createRequestController,
  getRequestsController,
  getRequestController,
  approveRequestController,
  rejectRequestController,
  cancelRequestController,
  decideRequestItemsController,
} from "./request.controller.js";

type RequestParams = {
  id: string;
};

export async function requestRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Restock requests go from a seller straight to the Owner. Reads are scoped
  // in the service: the Owner sees every store, a seller their own requests.
  app.get<{ Querystring: Record<string, string> }>(
    "/",
    getRequestsController,
  );

  app.get<{ Params: RequestParams }>("/:id", getRequestController);

  // A seller raises one for their own store.
  app.post(
    "/",
    {
      preHandler: [authorize(UserRole.SALES)],
    },
    createRequestController,
  );

  // The Owner decides. The service also checks the request was addressed to
  // this Owner.
  app.patch<{ Params: RequestParams }>(
    "/:id/approve",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    approveRequestController,
  );

  // A request may be decided one category at a time: the items sent together.
  app.patch<{ Params: RequestParams; Body: { itemIds?: unknown; approve?: unknown } }>(
    "/:id/items/decide",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    decideRequestItemsController,
  );

  app.patch<{ Params: RequestParams }>(
    "/:id/reject",
    {
      preHandler: [authorize(UserRole.OWNER)],
    },
    rejectRequestController,
  );

  // A seller may withdraw their own request while it is still pending.
  app.patch<{ Params: RequestParams }>(
    "/:id/cancel",
    {
      preHandler: [authorize(UserRole.OWNER, UserRole.SALES)],
    },
    cancelRequestController,
  );
}
