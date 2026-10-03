import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  AdjustBalanceInput,
  RemoveBalanceInput,
  StockInInput,
  UpdateProductInput,
} from "./inventory.schema.js";

// Branch identity as it appears alongside stock. Staff details are deliberately
// absent: a branch's stock says nothing about who works there.
const branchSummary = {
  select: {
    id: true,
    name: true,
    isMainStock: true,
    isActive: true,
  },
};

const productDetail = {
  include: {
    phoneDetails: true,
    productCategory: { select: { id: true, name: true, kind: true } },
  },
};

// Restricts any inventory query to the branches the caller may read.
// The Owner sees every branch; everyone else sees only their own.
function branchScope(viewer: Viewer): string[] | null {
  if (viewer.role === "OWNER") {
    return null;
  }

  return viewer.branchId ? [viewer.branchId] : [];
}

function locationFilter(viewer: Viewer, locationId?: string) {
  const allowed = branchScope(viewer);

  if (allowed === null) {
    return locationId ? { locationId } : {};
  }

  // A non-owner asking for another branch gets their own scope, never a
  // wider one.
  const ids = locationId
    ? allowed.filter((id) => id === locationId)
    : allowed;

  return { locationId: { in: ids } };
}

export async function stockIn(
  data: StockInInput,
  performedById: string,
) {
  const product = await prisma.product.findUnique({
    where: {
      id: data.productId,
    },
  });

  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  if (product.status !== "ACTIVE") {
    throw new Error("PRODUCT_INACTIVE");
  }

  const location = await prisma.stockLocation.findUnique({
    where: {
      id: data.locationId,
    },
  });

  if (!location) {
    throw new Error("LOCATION_NOT_FOUND");
  }

  // Stock must not be added to a store that has been closed.
  if (!location.isActive) {
    throw new Error("LOCATION_INACTIVE");
  }

  // Every delivery enters the business at the main store; the selling stores
  // are stocked from it by transfer, so their stock always has a source.
  if (!location.isMainStock) {
    throw new Error("STOCK_IN_MAIN_ONLY");
  }

  return prisma.$transaction(async (tx) => {
    // One balance row per product per branch.
    const balance = await tx.inventoryBalance.upsert({
      where: {
        locationId_productId: {
          locationId: data.locationId,
          productId: data.productId,
        },
      },
      create: {
        productId: data.productId,
        locationId: data.locationId,
        quantity: data.quantity,
      },
      update: {
        quantity: {
          increment: data.quantity,
        },
      },
    });

    await tx.stockMovement.create({
      data: {
        productId: data.productId,
        toLocationId: data.locationId,
        quantity: data.quantity,
        type: "STOCK_IN",
        createdById: performedById,
        notes: data.note ?? null,
      },
    });

    return balance;
  });
}

export async function getInventory(
  viewer: Viewer,
  locationId?: string,
) {
  const balances = await prisma.inventoryBalance.findMany({
    where: locationFilter(viewer, locationId),

    include: {
      product: productDetail,
      location: branchSummary,
    },

    orderBy: {
      updatedAt: "desc",
    },
  });

  return balances;
}

export async function getInventoryUnits(
  viewer: Viewer,
  productId?: string,
  locationId?: string,
  status?: Prisma.InventoryUnitWhereInput["status"],
) {
  return prisma.inventoryUnit.findMany({
    where: {
      ...locationFilter(viewer, locationId),
      ...(productId ? { productId } : {}),
      ...(status ? { status } : {}),
    },

    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
        },
      },

      location: branchSummary,
    },

    orderBy: {
      createdAt: "desc",
    },
  });
}

// Stock remaining per product for one branch, which is what both the Sales
// "available stock" view and the branch dashboard need.
export async function getStockSummary(
  viewer: Viewer,
  locationId?: string,
) {
  const balances = await prisma.inventoryBalance.findMany({
    where: locationFilter(viewer, locationId),

    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          price: true,
          status: true,
          categoryId: true,
          productCategory: { select: { id: true, name: true } },
          // The Owner's type, and its parent (a phone's brand), so the sale
          // form can go category, then type, then product.
          type: {
            select: {
              id: true,
              name: true,
              parentId: true,
              parent: { select: { id: true, name: true } },
            },
          },
        },
      },
      location: branchSummary,
    },

    orderBy: [{ location: { name: "asc" } }, { quantity: "desc" }],
  });

  const items = balances;

  const totals = items.reduce(
    (acc, item) => {
      acc[item.product.category] = (acc[item.product.category] ?? 0) + item.quantity;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    byCategory: {
      SERIALIZED: totals.SERIALIZED ?? 0,
      QUANTITY: totals.QUANTITY ?? 0,
    },
    totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
  };
}

// Movement history is scoped by either end of the movement: a branch sees
// stock that arrived at it or left it.
export async function getStockMovements(
  viewer: Viewer,
  locationId?: string,
) {
  const allowed = branchScope(viewer);

  const scope =
    allowed === null
      ? locationId
        ? {
            OR: [
              { fromLocationId: locationId },
              { toLocationId: locationId },
            ],
          }
        : {}
      : {
          OR: [
            { fromLocationId: { in: allowed } },
            { toLocationId: { in: allowed } },
          ],
        };

  return prisma.stockMovement.findMany({
    where: scope,

    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
        },
      },

      fromLocation: branchSummary,
      toLocation: branchSummary,

      createdBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });
}

// A mis-keyed intake is corrected here rather than by editing history: the
// balance is set to the true figure and the difference is recorded as an
// ADJUSTMENT movement, so the trail still explains itself afterwards.
export async function adjustBalance(
  balanceId: string,
  data: AdjustBalanceInput,
  performedById: string,
) {
  const balance = await prisma.inventoryBalance.findUnique({
    where: { id: balanceId },
    include: { product: true, location: true },
  });

  if (!balance) {
    throw new Error("BALANCE_NOT_FOUND");
  }

  if (!balance.location.isActive) {
    throw new Error("LOCATION_INACTIVE");
  }

  const difference = data.quantity - balance.quantity;

  if (difference === 0) {
    return balance;
  }

  // Nothing to reconcile against: stock is a count for every category, and
  // unit rows only exist for items already sold.

  return prisma.$transaction(async (tx) => {
    const updated = await tx.inventoryBalance.update({
      where: { id: balanceId },
      data: { quantity: data.quantity },
    });

    await tx.stockMovement.create({
      data: {
        productId: balance.productId,
        // An increase arrives at the branch; a decrease leaves it.
        ...(difference > 0
          ? { toLocationId: balance.locationId }
          : { fromLocationId: balance.locationId }),
        quantity: Math.abs(difference),
        type: "ADJUSTMENT",
        createdById: performedById,
        notes: `Corrected ${balance.quantity} → ${data.quantity}. ${data.reason}`,
      },
    });

    return updated;
  });
}

// Removing a stock row is only safe once it is empty: while it still holds
// units, deleting it would erase stock that physically exists.
export async function removeBalance(
  balanceId: string,
  data: RemoveBalanceInput,
  performedById: string,
) {
  const balance = await prisma.inventoryBalance.findUnique({
    where: { id: balanceId },
    include: { product: true },
  });

  if (!balance) {
    throw new Error("BALANCE_NOT_FOUND");
  }

  if (balance.quantity !== 0) {
    throw new Error("BALANCE_NOT_EMPTY");
  }

  const held = await prisma.inventoryUnit.count({
    where: {
      productId: balance.productId,
      locationId: balance.locationId,
      status: "IN_STOCK",
    },
  });

  if (held > 0) {
    throw new Error("UNITS_STILL_HELD");
  }

  return prisma.$transaction(async (tx) => {
    await tx.stockMovement.create({
      data: {
        productId: balance.productId,
        fromLocationId: balance.locationId,
        quantity: 0,
        type: "ADJUSTMENT",
        createdById: performedById,
        notes: `Stock row removed. ${data.reason}`,
      },
    });

    await tx.inventoryBalance.delete({ where: { id: balanceId } });

    return { id: balanceId };
  });
}

// Correcting the product itself - a typo in the name, the wrong price. SKU
// and category are deliberately not editable: stock, sales and movements all
// already point at them.
export async function updateProduct(
  productId: string,
  data: UpdateProductInput,
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  return prisma.product.update({
    where: { id: productId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.price !== undefined ? { price: data.price } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
    },
  });
}

