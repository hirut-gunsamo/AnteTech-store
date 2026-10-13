import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  CreateSaleInput,
  ListSalesQuery,
} from "./sale.schema.js";

const saleDetail = {
  id: true,
  status: true,
  subtotal: true,
  totalAmount: true,
  cashReceived: true,
  paymentMethod: true,
  bankName: true,
  transferReceived: true,
  notes: true,
  saleDate: true,
  submittedAt: true,
  approvedAt: true,
  createdAt: true,

  salesperson: {
    select: { id: true, name: true, role: true },
  },
  approvedBy: {
    select: { id: true, name: true, role: true },
  },
  location: {
    select: { id: true, name: true },
  },

  items: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,

      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
        },
      },

      inventoryUnits: {
        select: {
          id: true,
          serial: true,
          status: true,
        },
      },
    },
  },
};


/**
 * A seller records a sale from their own store's stock.
 *
 * There is no approval step: the sale counts as revenue at once and the goods
 * leave the store's shelf in the same transaction.
 */
export async function createSale(
  data: CreateSaleInput,
  viewer: Viewer,
) {
  if (!viewer.branchId) {
    throw new Error("NO_BRANCH");
  }

  // The main store is storage only: nothing is sold from it.
  const store = await prisma.stockLocation.findUnique({
    where: { id: viewer.branchId },
    select: { isMainStock: true, isActive: true },
  });

  if (!store || store.isMainStock || !store.isActive) {
    throw new Error("NOT_A_SELLING_STORE");
  }

  const productIds = data.items.map((item) => item.productId);

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: "ACTIVE" },
    // costPrice is read only to stamp each line with what it cost; it is
    // never sent back to the seller.
    select: { id: true, price: true, costPrice: true, category: true, sku: true },
  });

  if (products.length !== new Set(productIds).size) {
    throw new Error("INVALID_PRODUCT");
  }

  const catalogue = new Map(products.map((p) => [p.id, p]));

  // Serials are checked before anything is written: a sale that is going to be
  // refused must not move stock first. They are checked before the stock
  // check too, because a request carrying the wrong serials is malformed — the
  // seller can fix it at the till.
  //
  // Keyed by the line's position in the request, not by productId: the same
  // product may legitimately appear on two lines of one sale, and a productId
  // key would let the second line's serials overwrite the first's.
  const serialsByLine = new Map<number, string[]>();

  for (const [index, item] of data.items.entries()) {
    // Non-null: every productId was found above, or INVALID_PRODUCT threw.
    const product = catalogue.get(item.productId)!;
    const serials = item.serials ?? [];

    if (product.category !== "SERIALIZED") {
      if (serials.length > 0) {
        throw new Error("SERIALS_NOT_EXPECTED");
      }

      continue;
    }

    if (serials.length !== item.quantity) {
      throw new Error("SERIAL_COUNT_MISMATCH");
    }

    serialsByLine.set(index, serials);
  }

  // Repeats are looked for across the whole request, not just inside one line:
  // two lines of the same sale must not name the same handset either.
  const allSerials = [...serialsByLine.values()].flat();

  if (new Set(allSerials).size !== allSerials.length) {
    throw new Error("SERIAL_REPEATED");
  }

  // The unique index on serial is the real guard — it is what stops the same
  // handset being sold twice at two stores at the same moment. This read is
  // so that the sale is refused with a sentence the seller can act on, before
  // any stock moves.
  if (allSerials.length > 0) {
    const taken = await prisma.inventoryUnit.findFirst({
      where: { serial: { in: allSerials } },
      select: { id: true },
    });

    if (taken) {
      throw new Error("SERIAL_ALREADY_SOLD");
    }
  }

  await assertBranchHasStock(viewer.branchId, data.items);

  let subtotal = new Prisma.Decimal(0);

  const items = data.items.map((item) => {
    const product = catalogue.get(item.productId)!;
    // The price the seller entered, else the product's suggested price.
    const unitPrice =
      item.unitPrice !== undefined ? new Prisma.Decimal(item.unitPrice) : product.price;
    // An item given with a phone (its local charger) leaves stock at no
    // price; everything else needs one.
    if (!unitPrice || (unitPrice.lte(0) && !(item.included && unitPrice.eq(0)))) {
      throw new Error("PRICE_REQUIRED");
    }
    const lineTotal = unitPrice.mul(item.quantity);

    subtotal = subtotal.add(lineTotal);

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice,
      // What it cost when sold, so later price changes never rewrite profit.
      unitCost: product.costPrice,
      lineTotal,
    };
  });

  const branchId = viewer.branchId;

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        salespersonId: viewer.userId,
        locationId: branchId,
        status: "APPROVED",
        // Nobody approved it, so approvedById stays empty; the time is kept
        // because the reports read it.
        approvedAt: new Date(),
        subtotal,
        totalAmount: subtotal,
        // Only cash counts as money the seller holds; transfer is already in
        // the bank, so it is tracked separately.
        paymentMethod: data.paymentMethod,
        bankName:
          data.paymentMethod === "CASH" ? null : (data.bankName ?? null),
        cashReceived: new Prisma.Decimal(data.cashReceived),
        transferReceived: new Prisma.Decimal(data.transferReceived ?? 0),
        notes: data.customerNote ?? null,
      },
      select: { id: true },
    });

    // The lines are written one at a time rather than nested under the sale, so
    // that each created SaleItem is known to belong to the request line at the
    // same index. A nested create returns its rows in no guaranteed order, and
    // the serials have to land on the right line.
    for (const [index, line] of items.entries()) {
      const item = await tx.saleItem.create({
        data: { saleId: sale.id, ...line },
        select: { id: true, productId: true, quantity: true },
      });

      // Only succeeds while the shelf still holds enough, so two tills
      // selling the last unit at the same moment cannot both go through.
      const { count } = await tx.inventoryBalance.updateMany({
        where: {
          locationId: branchId,
          productId: item.productId,
          quantity: { gte: item.quantity },
        },
        data: { quantity: { decrement: item.quantity } },
      });

      if (count === 0) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      const serials = serialsByLine.get(index);

      if (serials) {
        // Each serial becomes the record of one unit leaving the business.
        // Stock arrives as a plain count, so this is the first and only moment
        // the business learns which handset this was.
        for (const serial of serials) {
          await tx.inventoryUnit.create({
            data: {
              productId: item.productId,
              locationId: branchId,
              status: "SOLD",
              saleItemId: item.id,
              serial,
            },
          });
        }
      }

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          fromLocationId: branchId,
          quantity: item.quantity,
          type: "SALE",
          referenceType: "Sale",
          referenceId: sale.id,
          createdById: viewer.userId,
        },
      });
    }

    return tx.sale.findUnique({ where: { id: sale.id }, select: saleDetail });
  });
}

async function assertBranchHasStock(
  branchId: string,
  items: { productId: string; quantity: number }[],
) {
  const wanted = new Map<string, number>();

  for (const item of items) {
    wanted.set(
      item.productId,
      (wanted.get(item.productId) ?? 0) + item.quantity,
    );
  }

  const balances = await prisma.inventoryBalance.findMany({
    where: {
      locationId: branchId,
      productId: { in: [...wanted.keys()] },
    },
    select: { productId: true, quantity: true },
  });

  const available = new Map(
    balances.map((b) => [b.productId, b.quantity]),
  );

  const shortages = [...wanted.entries()]
    .filter(([productId, qty]) => (available.get(productId) ?? 0) < qty)
    .map(([productId, qty]) => ({
      productId,
      requested: qty,
      available: available.get(productId) ?? 0,
    }));

  if (shortages.length > 0) {
    const error = new Error("INSUFFICIENT_STOCK");
    Object.assign(error, { shortages });
    throw error;
  }
}

// A seller sees only their own sales, the Owner everything.
export async function getSales(
  query: ListSalesQuery,
  viewer: Viewer,
) {
  let scope: Prisma.SaleWhereInput = {};

  if (viewer.role === "SALES") {
    scope = { salespersonId: viewer.userId };
  } else if (query.branchId) {
    scope = { locationId: query.branchId };
  }

  const dateFilter =
    query.from || query.to
      ? {
          saleDate: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {};

  return prisma.sale.findMany({
    where: {
      ...scope,
      ...dateFilter,
      ...(query.status ? { status: query.status } : {}),
      ...(query.salespersonId && viewer.role !== "SALES"
        ? { salespersonId: query.salespersonId }
        : {}),
    },
    select: saleDetail,
    orderBy: { saleDate: "desc" },
  });
}

export async function getSaleById(id: string, viewer: Viewer) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: saleDetail,
  });

  if (!sale) {
    return null;
  }

  if (
    viewer.role === "SALES" &&
    sale.salesperson.id !== viewer.userId
  ) {
    return null;
  }

  return sale;
}

// Only an untouched draft can be removed. Anything submitted is part of the
// record.
export async function deleteSale(id: string, viewer: Viewer, restock = true) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      salespersonId: true,
      locationId: true,
      items: { select: { id: true, productId: true, quantity: true } },
    },
  });

  if (!sale) {
    throw new Error("SALE_NOT_FOUND");
  }

  // The Owner can remove any sale. With restock, what it took goes back on
  // that store's shelf; without, the goods stay gone and only the record
  // goes. Its IMEIs can be sold again either way.
  if (viewer.role === "OWNER") {
    await prisma.$transaction(async (tx) => {
      if (restock && sale.status !== "DRAFT") {
        for (const item of sale.items) {
          await tx.inventoryBalance.upsert({
            where: {
              locationId_productId: {
                locationId: sale.locationId,
                productId: item.productId,
              },
            },
            update: { quantity: { increment: item.quantity } },
            create: {
              productId: item.productId,
              locationId: sale.locationId,
              quantity: item.quantity,
            },
          });
        }
      }

      await tx.inventoryUnit.deleteMany({
        where: { saleItemId: { in: sale.items.map((item) => item.id) } },
      });
      await tx.stockMovement.deleteMany({
        where: { referenceType: "Sale", referenceId: sale.id },
      });
      await tx.sale.delete({ where: { id: sale.id } });
    });

    return { id };
  }

  if (sale.salespersonId !== viewer.userId) {
    throw new Error("NOT_YOUR_SALE");
  }

  if (sale.status !== "DRAFT") {
    throw new Error("SALE_NOT_DRAFT");
  }

  await prisma.sale.delete({ where: { id } });

  return { id };
}
