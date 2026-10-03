import type { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  ApproveRequestInput,
  CreateRequestInput,
  ListRequestsQuery,
} from "./request.schema.js";

const requestDetail = {
  id: true,
  kind: true,
  status: true,
  notes: true,
  rejectionReason: true,
  submittedAt: true,
  reviewedAt: true,
  fulfilledAt: true,
  createdAt: true,

  requestedBy: {
    select: {
      id: true,
      name: true,
      role: true,
      branch: { select: { id: true, name: true } },
    },
  },

  requestedTo: {
    select: { id: true, name: true, role: true },
  },

  approvedBy: {
    select: { id: true, name: true, role: true },
  },

  items: {
    select: {
      id: true,
      quantity: true,
      approvedQuantity: true,
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          // The Owner's category: a request is decided one category at a time.
          productCategory: { select: { id: true, name: true } },
        },
      },
    },
  },

  transfer: {
    select: {
      id: true,
      status: true,
      shippedAt: true,
      receivedAt: true,
      driverName: true,
      driverPhone: true,
      vehiclePlate: true,
      fromLocation: { select: { id: true, name: true } },
      toLocation: { select: { id: true, name: true } },
    },
  },
};

/**
 * A seller asks the Owner to restock their store.
 *
 * The Owner answers by sending goods from the main store, or from another
 * selling store, as a transfer. Nothing moves when the request is raised.
 */
export async function createRequest(
  data: CreateRequestInput,
  viewer: Viewer,
) {
  if (viewer.role !== "SALES") {
    throw new Error("OWNER_CANNOT_REQUEST");
  }

  if (!viewer.branchId) {
    throw new Error("NO_BRANCH");
  }

  const addressee = await prisma.user.findFirst({
    where: { role: "OWNER", isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (!addressee) {
    throw new Error("NO_ACTIVE_OWNER");
  }

  const productIds = data.items.map((item) => item.productId);

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: "ACTIVE" },
    select: { id: true },
  });

  if (products.length !== new Set(productIds).size) {
    throw new Error("INVALID_PRODUCT");
  }

  return prisma.stockRequest.create({
    data: {
      kind: "RESTOCK",
      requestedById: viewer.userId,
      requestedToId: addressee.id,
      status: "PENDING",
      notes: data.notes ?? null,

      items: {
        create: data.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
      },
    },
    select: requestDetail,
  });
}

// The Owner sees every request; a seller sees the ones they raised.
export async function getRequests(
  query: ListRequestsQuery,
  viewer: Viewer,
) {
  const scope =
    viewer.role === "OWNER"
      ? query.branchId
        ? { requestedBy: { branchId: query.branchId } }
        : {}
      : { requestedById: viewer.userId };

  return prisma.stockRequest.findMany({
    where: {
      ...scope,
      ...(query.status ? { status: query.status } : {}),
    },
    select: requestDetail,
    orderBy: { createdAt: "desc" },
  });
}

export async function getRequestById(
  id: string,
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    select: requestDetail,
  });

  if (!request) {
    return null;
  }

  // Report someone else's request as missing rather than forbidden.
  if (viewer.role !== "OWNER" && request.requestedBy.id !== viewer.userId) {
    return null;
  }

  return request;
}

/**
 * Approving is sending: the Owner names the store the goods come from and who
 * is driving them over, and a transfer leaves at once. The goods come off the
 * source store now and reach the requesting store when a seller there presses
 * Received.
 */
export async function approveRequest(
  id: string,
  data: ApproveRequestInput,
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    include: {
      items: true,
      requestedBy: { select: { branchId: true } },
    },
  });

  if (!request) {
    throw new Error("REQUEST_NOT_FOUND");
  }

  if (request.status !== "PENDING") {
    throw new Error("REQUEST_NOT_PENDING");
  }

  // Only the person the request was addressed to may decide it.
  if (request.requestedToId !== viewer.userId) {
    throw new Error("NOT_THE_ADDRESSEE");
  }

  // Items already decided one by one are shipped as decided.
  const decidedOneByOne = request.items.some((item) => item.approvedQuantity !== null);

  if (decidedOneByOne && request.items.some((item) => item.approvedQuantity === null)) {
    throw new Error("DECIDE_EACH_ITEM");
  }

  const approved = decidedOneByOne
    ? new Map(request.items.map((item) => [item.id, item.approvedQuantity ?? 0]))
    : resolveApprovedQuantities(request.items, data.items);

  // Lines approved at 0 are declined: they are recorded on the request but
  // nothing ships for them.
  const shipping = request.items
    .map((item) => ({
      productId: item.productId,
      quantity: approved.get(item.id) ?? 0,
    }))
    .filter((line) => line.quantity > 0);

  const destinationId = request.requestedBy.branchId;

  if (!destinationId) {
    throw new Error("NO_BRANCH");
  }

  if (!data.sourceBranchId) {
    throw new Error("SOURCE_REQUIRED");
  }

  // The goods travel by road, so the store expecting them is told who is
  // bringing them before the van leaves.
  if (!data.driverName || !data.driverPhone || !data.vehiclePlate) {
    throw new Error("DRIVER_REQUIRED");
  }

  const sourceBranchId = data.sourceBranchId;

  if (destinationId === sourceBranchId) {
    throw new Error("SAME_BRANCH");
  }

  const source = await prisma.stockLocation.findUnique({
    where: { id: sourceBranchId },
    select: { id: true, isActive: true },
  });

  if (!source) {
    throw new Error("SOURCE_NOT_FOUND");
  }

  if (!source.isActive) {
    throw new Error("SOURCE_INACTIVE");
  }

  // Refuse to promise stock the source does not have. Checked against what is
  // being approved, so approving less is how the Owner answers a request the
  // source cannot fully cover.
  const available = await shelfStock(
    sourceBranchId,
    shipping.map((line) => line.productId),
  );

  const shortages = shipping
    .filter((line) => (available.get(line.productId) ?? 0) < line.quantity)
    .map((line) => ({
      productId: line.productId,
      requested: line.quantity,
      available: available.get(line.productId) ?? 0,
    }));

  if (shortages.length > 0) {
    const error = new Error("INSUFFICIENT_SOURCE_STOCK");
    Object.assign(error, { shortages });
    throw error;
  }

  return prisma.$transaction(async (tx) => {
    await recordApprovedQuantities(tx, approved);

    await tx.stockRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: viewer.userId,
        reviewedAt: new Date(),
      },
    });

    const transfer = await tx.stockTransfer.create({
      data: {
        requestId: id,
        fromLocationId: sourceBranchId,
        toLocationId: destinationId,
        status: "IN_TRANSIT",
        deliveredById: viewer.userId,
        shippedAt: new Date(),
        notes: data.notes ?? null,

        driverName: data.driverName,
        driverPhone: data.driverPhone,
        vehiclePlate: data.vehiclePlate,

        items: { create: shipping },
      },
    });

    await sendOut(tx, transfer.id, sourceBranchId, destinationId, shipping, viewer.userId);

    return tx.stockRequest.findUnique({
      where: { id },
      select: requestDetail,
    });
  });
}

/**
 * Takes shipped goods off the source store and records the movement. The
 * decrement only succeeds while the shelf still holds enough, so stock sold in
 * the meantime cannot drive the source below zero.
 */
export async function sendOut(
  tx: Prisma.TransactionClient,
  transferId: string,
  fromLocationId: string,
  toLocationId: string,
  lines: { productId: string; quantity: number }[],
  userId: string,
) {
  for (const line of lines) {
    const { count } = await tx.inventoryBalance.updateMany({
      where: {
        locationId: fromLocationId,
        productId: line.productId,
        quantity: { gte: line.quantity },
      },
      data: { quantity: { decrement: line.quantity } },
    });

    if (count === 0) throw new Error("INSUFFICIENT_SOURCE_STOCK");

    await tx.stockMovement.create({
      data: {
        productId: line.productId,
        fromLocationId,
        toLocationId,
        quantity: line.quantity,
        type: "TRANSFER",
        referenceType: "StockTransfer",
        referenceId: transferId,
        createdById: userId,
        notes: "Sent",
      },
    });
  }
}

/** What a store has on the shelf of each of these products. */
export async function shelfStock(locationId: string, productIds: string[]) {
  const balances = await prisma.inventoryBalance.findMany({
    where: { locationId, productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });

  return new Map(balances.map((b) => [b.productId, Math.max(0, b.quantity)]));
}

/**
 * Works out how much of each line is approved, keyed by request item id.
 *
 * Lines the reviewer did not mention are approved in full. Every figure must
 * sit between 0 and what was asked for — approving more than was requested
 * would ship stock nobody asked for — and at least one unit must be approved,
 * since approving nothing is a rejection and should carry a reason.
 */
function resolveApprovedQuantities(
  items: { id: string; quantity: number }[],
  decisions: ApproveRequestInput["items"],
) {
  const requestedById = new Map(
    items.map((item) => [item.id, item.quantity]),
  );
  const approved = new Map(requestedById);
  const seen = new Set<string>();

  for (const decision of decisions ?? []) {
    const requested = requestedById.get(decision.itemId);

    if (requested === undefined || seen.has(decision.itemId)) {
      throw new Error("UNKNOWN_REQUEST_ITEM");
    }

    if (decision.approvedQuantity > requested) {
      throw new Error("APPROVED_EXCEEDS_REQUESTED");
    }

    seen.add(decision.itemId);
    approved.set(decision.itemId, decision.approvedQuantity);
  }

  const total = [...approved.values()].reduce((sum, qty) => sum + qty, 0);

  if (total === 0) {
    throw new Error("NOTHING_APPROVED");
  }

  return approved;
}

async function recordApprovedQuantities(
  tx: Prisma.TransactionClient,
  approved: Map<string, number>,
) {
  for (const [itemId, approvedQuantity] of approved) {
    await tx.stockRequestItem.update({
      where: { id: itemId },
      data: { approvedQuantity },
    });
  }
}

/**
 * The Owner may decide a request one category at a time (phones, accessories):
 * every line of that category is approved in full, or all are refused. The
 * lines are only recorded here; once all are decided the Owner sends the
 * approved ones with approveRequest. If every line was refused, the request
 * reads Rejected.
 */
export async function decideRequestItems(
  id: string,
  itemIds: string[],
  approve: boolean,
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!request) throw new Error("REQUEST_NOT_FOUND");
  if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
  if (request.requestedToId !== viewer.userId) throw new Error("NOT_THE_ADDRESSEE");

  const ids = [...new Set(itemIds)];
  const chosen = request.items.filter((row) => ids.includes(row.id));
  if (chosen.length !== ids.length || chosen.length === 0) throw new Error("ITEM_NOT_FOUND");
  if (chosen.some((row) => row.approvedQuantity !== null)) throw new Error("ITEM_ALREADY_DECIDED");

  return prisma.$transaction(async (tx) => {
    // Claimed first, so a double tap cannot decide a line twice.
    for (const item of chosen) {
      const { count } = await tx.stockRequestItem.updateMany({
        where: { id: item.id, approvedQuantity: null },
        data: { approvedQuantity: approve ? item.quantity : 0 },
      });
      if (count === 0) throw new Error("ITEM_ALREADY_DECIDED");
    }

    const lines = await tx.stockRequestItem.findMany({
      where: { requestId: id },
      select: { approvedQuantity: true },
    });

    const open = lines.some((line) => line.approvedQuantity === null);
    const anyApproved = lines.some((line) => (line.approvedQuantity ?? 0) > 0);

    // With something approved, the request waits, still pending, to be sent.
    return tx.stockRequest.update({
      where: { id },
      data: open || anyApproved
        ? {}
        : {
            status: "REJECTED",
            approvedById: viewer.userId,
            reviewedAt: new Date(),
          },
      select: requestDetail,
    });
  });
}

/** Lines already decided one by one: the request can only be finished that way. */
async function hasDecidedItems(id: string) {
  const decided = await prisma.stockRequestItem.count({
    where: { requestId: id, approvedQuantity: { not: null } },
  });
  return decided > 0;
}

export async function rejectRequest(
  id: string,
  rejectionReason: string,
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    select: { id: true, status: true, requestedToId: true },
  });

  if (!request) {
    throw new Error("REQUEST_NOT_FOUND");
  }

  if (request.status !== "PENDING") {
    throw new Error("REQUEST_NOT_PENDING");
  }

  if (request.requestedToId !== viewer.userId) {
    throw new Error("NOT_THE_ADDRESSEE");
  }

  if (await hasDecidedItems(id)) {
    throw new Error("PARTLY_DECIDED");
  }

  return prisma.stockRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason,
      approvedById: viewer.userId,
      reviewedAt: new Date(),
    },
    select: requestDetail,
  });
}

// A seller may withdraw their own request while it is still pending.
export async function cancelRequest(id: string, viewer: Viewer) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    select: { id: true, status: true, requestedById: true },
  });

  if (!request) {
    throw new Error("REQUEST_NOT_FOUND");
  }

  if (
    viewer.role !== "OWNER" &&
    request.requestedById !== viewer.userId
  ) {
    throw new Error("NOT_YOUR_REQUEST");
  }

  if (request.status !== "PENDING") {
    throw new Error("REQUEST_NOT_PENDING");
  }

  if (await hasDecidedItems(id)) {
    throw new Error("PARTLY_DECIDED");
  }

  return prisma.stockRequest.update({
    where: { id },
    data: { status: "CANCELLED", reviewedAt: new Date() },
    select: requestDetail,
  });
}
