import type { FastifyReply, FastifyRequest } from "fastify";

import { loadViewer } from "../../middleware/auth.js";
import { getNotifications } from "./notification.service.js";

export async function notificationsController(
  request: FastifyRequest<{
    Querystring: { requestsSeen?: string; transfersSeen?: string; expensesSeen?: string };
  }>,
  reply: FastifyReply,
) {
  const viewer = await loadViewer(request);

  if (!viewer) {
    return reply.status(403).send({ message: "User account is inactive" });
  }

  const seen = request.query.requestsSeen
    ? new Date(request.query.requestsSeen)
    : undefined;

  const transfersSeen = request.query.transfersSeen
    ? new Date(request.query.transfersSeen)
    : undefined;

  const expensesSeen = request.query.expensesSeen
    ? new Date(request.query.expensesSeen)
    : undefined;

  const payload = await getNotifications(viewer, {
    requestsSeenAt: seen && !Number.isNaN(seen.getTime()) ? seen : undefined,
    transfersSeenAt:
      transfersSeen && !Number.isNaN(transfersSeen.getTime()) ? transfersSeen : undefined,
    expensesSeenAt:
      expensesSeen && !Number.isNaN(expensesSeen.getTime()) ? expensesSeen : undefined,
  });

  return reply.send(payload);
}
