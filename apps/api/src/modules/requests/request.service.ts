import type { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  ApproveRequestInput,
  CreateRequestInput,
  ListRequestsQuery,
} from "./request.schema.js";

const shipmentDetail = {
  id: true,
  status: true,
  shippedAt: true,
  receivedAt: true,
  receivedBy: { select: { id: true, name: true } },
  fromLocation: { select: { id: true, name: true } },
  toLocation: { select: { id: true, name: true } },
} as const;

const requestDetail = {
  id: true,
  kind: true,
  status: true,
  notes: true,
  rejectionReason: true,
  sentByOwner: true,
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

  transfer: { select: shipmentDetail },
  shipment: { select: shipmentDetail },
};

/**
 * A request in a lot of several reaches its shipment through `shipment`; the
 * first request of the lot also through `transfer`. Either way the screens
 * read it as `transfer`.
 */
function withShipment<T extends { transfer: unknown; shipment: unknown }>(
  request: T,
): Omit<T, "shipment"> {
  const { shipment, ...rest } = request;
  return { ...rest, transfer: rest.transfer ?? shipment };
}

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
  // The Owner sends "as a branch": the request is filed under a seller of
  // that store and addressed to the Owner, so it ships and is received exactly
  // like one the store raised.
  const asBranch = viewer.role === "OWNER";

  let requestedById = viewer.userId;
  let addresseeId: string;

  if (asBranch) {
    if (!data.branchId) {
      throw new Error("BRANCH_REQUIRED");
    }

    const store = await prisma.stockLocation.findUnique({
      where: { id: data.branchId },
      select: { isActive: true, isMainStock: true },
    });

    if (!store || !store.isActive || store.isMainStock) {
      throw new Error("NOT_A_SELLING_STORE");
    }

    const seller = await prisma.user.findFirst({
      where: { role: "SALES", branchId: data.branchId, isActive: true },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    if (!seller) {
      throw new Error("NO_SELLER_AT_STORE");
    }

    requestedById = seller.id;
    addresseeId = viewer.userId;
  } else {
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

    addresseeId = addressee.id;
  }

  const productIds = data.items.map((item) => item.productId);

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: "ACTIVE" },
    select: { id: true },
  });

  if (products.length !== new Set(productIds).size) {
    throw new Error("INVALID_PRODUCT");
  }

  const created = await prisma.stockRequest.create({
    data: {
      kind: "RESTOCK",
      requestedById,
      requestedToId: addresseeId,
      sentByOwner: asBranch,
      status: "PENDING",
      notes: data.notes ?? null,

      items: {
        create: data.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
      },
    },
    select: { id: true },
  });

  // The Owner's "Send to store" goes out at once, from the store they picked:
  // nothing waits for approval, and a seller there presses Received.
  if (asBranch) {
    const mainStore = data.sourceBranchId
      ? null
      : await prisma.stockLocation.findFirst({ where: { isMainStock: true }, select: { id: true } });

    try {
      await shipRequests(
        [created.id],
        { sourceBranchId: data.sourceBranchId ?? mainStore?.id },
        viewer,
      );
    } catch (error) {
      await prisma.stockRequest.delete({ where: { id: created.id } });
      throw error;
    }
  }

  return getRequestById(created.id, viewer);
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

  const rows = await prisma.stockRequest.findMany({
    where: {
      ...scope,
      ...(query.status ? { status: query.status } : {}),
    },
    select: requestDetail,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(withShipment);
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

  return withShipment(request);
}

/**
 * Approving is sending: the Owner names the store the goods come from and the
 * goods leave at once. One request is a lot of one; see shipRequests.
 */
export async function approveRequest(
  id: string,
  data: ApproveRequestInput,
  viewer: Viewer,
) {
  await shipRequests([id], data, viewer);
  return getRequestById(id, viewer);
}

/**
 * Step one of sending, as on the SIM app: the Owner saves how many of each
 * item go (the same as asked, or fewer). Nothing moves yet; the request waits
 * for Send. A line left out goes in full.
 */
export async function approveQuantities(
  id: string,
  items: { itemId: string; approvedQuantity: number }[],
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!request) throw new Error("REQUEST_NOT_FOUND");
  if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
  if (request.requestedToId !== viewer.userId) throw new Error("NOT_THE_ADDRESSEE");

  const approved = resolveApprovedQuantities(request.items, items);

  await prisma.$transaction((tx) => recordApprovedQuantities(tx, approved));

  return getRequestById(id, viewer);
}

/**
 * One lot for a store, as on the SIM app: several of its waiting requests go
 * out together as a single shipment, and a seller there receives them all
 * with one Received. The goods come off the source store now.
 *
 * `items` may lower any line (the store has fewer); a line left out goes as
 * decided, or in full when it was never decided. 0 declines that line.
 */
export async function shipRequests(
  requestIds: string[],
  data: ApproveRequestInput,
  viewer: Viewer,
) {
  const ids = [...new Set(requestIds)];

  const requests = await prisma.stockRequest.findMany({
    where: { id: { in: ids } },
    include: {
      items: true,
      requestedBy: { select: { branchId: true } },
    },
  });

  if (ids.length === 0 || requests.length !== ids.length) {
    throw new Error("REQUEST_NOT_FOUND");
  }

  for (const request of requests) {
    if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
    // Only the person the request was addressed to may decide it.
    if (request.requestedToId !== viewer.userId) throw new Error("NOT_THE_ADDRESSEE");

    const decided = request.items.some((item) => item.approvedQuantity !== null);
    if (decided && request.items.some((item) => item.approvedQuantity === null)) {
      throw new Error("DECIDE_EACH_ITEM");
    }
  }

  // One lot goes to one store.
  const destinations = new Set(requests.map((request) => request.requestedBy.branchId));
  if (destinations.size !== 1) throw new Error("ONE_STORE_PER_LOT");

  const destinationId = [...destinations][0];
  if (!destinationId) throw new Error("NO_BRANCH");

  // How much of each line goes, across every request in the lot. Decided
  // lines may be lowered here, never raised past what was decided.
  const allItems = requests.flatMap((request) =>
    request.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.approvedQuantity ?? item.quantity,
    })),
  );
  const approved = resolveApprovedQuantities(allItems, data.items);

  // Added up per product: what goes in the lot.
  const totals = new Map<string, number>();
  for (const item of allItems) {
    const quantity = approved.get(item.id) ?? 0;
    if (quantity > 0) totals.set(item.productId, (totals.get(item.productId) ?? 0) + quantity);
  }
  const shipping = [...totals].map(([productId, quantity]) => ({ productId, quantity }));

  // Everything goes out from the Main Store unless another store is named.
  const sourceBranchId =
    data.sourceBranchId ??
    (await prisma.stockLocation.findFirst({ where: { isMainStock: true, isActive: true }, select: { id: true } }))?.id;
  if (!sourceBranchId) throw new Error("SOURCE_REQUIRED");
  if (destinationId === sourceBranchId) throw new Error("SAME_BRANCH");

  const source = await prisma.stockLocation.findUnique({
    where: { id: sourceBranchId },
    select: { id: true, isActive: true },
  });
  if (!source) throw new Error("SOURCE_NOT_FOUND");
  if (!source.isActive) throw new Error("SOURCE_INACTIVE");

  // Refuse to promise stock the source does not have. Sending less is how
  // the Owner answers a lot the source cannot fully cover.
  const available = await shelfStock(sourceBranchId, shipping.map((line) => line.productId));
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
    // Claimed first, so a double tap cannot send the same requests twice.
    const { count } = await tx.stockRequest.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: {
        status: "APPROVED",
        approvedById: viewer.userId,
        reviewedAt: new Date(),
      },
    });
    if (count !== ids.length) throw new Error("REQUEST_NOT_PENDING");

    await recordApprovedQuantities(tx, approved);

    const transfer = await tx.stockTransfer.create({
      data: {
        // The first request stands for the lot where one is shown; every
        // request in it is linked through shipmentId.
        requestId: ids[0],
        fromLocationId: sourceBranchId,
        toLocationId: destinationId,
        status: "IN_TRANSIT",
        deliveredById: viewer.userId,
        shippedAt: new Date(),
        notes: data.notes ?? null,
        items: { create: shipping },
      },
    });

    await sendOut(tx, transfer.id, sourceBranchId, destinationId, shipping, viewer.userId);

    await tx.stockRequest.updateMany({
      where: { id: { in: ids } },
      data: { shipmentId: transfer.id },
    });

    return { transferId: transfer.id, requests: ids.length, lines: shipping.length };
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

/**
 * Removes a request. The Owner may remove any; a seller only their own
 * request while it is still pending and nothing in it has been decided.
 * A delivery made for it is kept (stock already moved), only unlinked.
 */
export async function deleteRequest(id: string, viewer: Viewer) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    select: { id: true, status: true, requestedById: true },
  });

  if (!request) throw new Error("REQUEST_NOT_FOUND");

  if (viewer.role !== "OWNER") {
    if (request.requestedById !== viewer.userId) throw new Error("NOT_YOUR_REQUEST");
    if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
    if (await hasDecidedItems(id)) throw new Error("PARTLY_DECIDED");
  }

  await prisma.$transaction([
    prisma.stockTransfer.updateMany({ where: { requestId: id }, data: { requestId: null } }),
    prisma.stockRequest.delete({ where: { id } }),
  ]);
}
