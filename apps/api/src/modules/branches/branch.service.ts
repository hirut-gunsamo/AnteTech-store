import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  CreateBranchInput,
  ListBranchesQuery,
  UpdateBranchInput,
} from "./branch.schema.js";

const branchSelect = {
  id: true,
  name: true,
  isMainStock: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,

  _count: {
    select: {
      users: { where: { isActive: true } },
      balances: true,
      // Stock is a count. Unit rows exist only for items already sold, so
      // this is "units sold at this store", not stock on the shelf.
      units: { where: { status: "SOLD" } },
    },
  },
} satisfies Prisma.StockLocationSelect;

type RawBranch = Prisma.StockLocationGetPayload<{
  select: typeof branchSelect;
}>;

function shape(branch: RawBranch) {
  const { _count, ...rest } = branch;

  return {
    ...rest,
    counts: {
      users: _count.users,
      products: _count.balances,
      unitsSold: _count.units,
    },
  };
}

async function requireBranch(id: string) {
  const branch = await prisma.stockLocation.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      isActive: true,
      isMainStock: true,
    },
  });

  if (!branch) {
    throw new Error("BRANCH_NOT_FOUND");
  }

  return branch;
}

async function assertNameIsFree(name: string, exceptId?: string) {
  const clash = await prisma.stockLocation.findFirst({
    where: {
      name,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new Error("BRANCH_NAME_EXISTS");
  }
}

/** The one main store, if the database has been seeded. */
export async function mainStore() {
  return prisma.stockLocation.findFirst({
    where: { isMainStock: true },
    select: { id: true, name: true, isActive: true },
  });
}

// Every store the Owner adds is a selling store. The main store is made once,
// by the seed, and there is only ever one.
export async function createBranch(data: CreateBranchInput) {
  const name = data.name.trim();

  await assertNameIsFree(name);

  const branch = await prisma.stockLocation.create({
    data: {
      name,
      isMainStock: false,
      isActive: true,
    },
    select: branchSelect,
  });

  return shape(branch);
}

// Everything a seller may know about a DIFFERENT store: its name, and nothing
// about its people or its stock.
function shapePublic(branch: RawBranch) {
  return {
    id: branch.id,
    name: branch.name,
    isMainStock: branch.isMainStock,
    isActive: branch.isActive,
  };
}

// The Owner sees every store in full. A seller sees their own store in full,
// plus the bare identity of the main store, where restocks come from. Other
// stores are invisible.
export async function getBranches(
  query: ListBranchesQuery,
  viewer: Viewer,
) {
  const filters = {
    ...(query.isActive !== undefined
      ? { isActive: query.isActive }
      : {}),
    ...(query.isMainStock !== undefined
      ? { isMainStock: query.isMainStock }
      : {}),
  };

  const scope =
    viewer.role === "OWNER"
      ? filters
      : {
          AND: [
            filters,
            {
              OR: [
                ...(viewer.branchId
                  ? [{ id: viewer.branchId }]
                  : []),
                { isMainStock: true, isActive: true },
              ],
            },
          ],
        };

  const branches = await prisma.stockLocation.findMany({
    where: scope,
    select: branchSelect,
    orderBy: [
      { isActive: "desc" },
      { isMainStock: "desc" },
      { name: "asc" },
    ],
  });

  return branches.map((branch) =>
    viewer.role === "OWNER" || branch.id === viewer.branchId
      ? shape(branch)
      : shapePublic(branch),
  );
}

export async function getBranchById(id: string, viewer: Viewer) {
  const branch = await prisma.stockLocation.findUnique({
    where: { id },
    select: branchSelect,
  });

  if (!branch) {
    return null;
  }

  if (viewer.role === "OWNER" || branch.id === viewer.branchId) {
    return shape(branch);
  }

  // The main store is addressable by everyone, but only by identity.
  if (branch.isMainStock && branch.isActive) {
    return shapePublic(branch);
  }

  // Report another store as missing rather than forbidden, so its existence
  // is not disclosed.
  return null;
}

export async function updateBranch(
  id: string,
  data: UpdateBranchInput,
) {
  await requireBranch(id);

  const name = data.name.trim();
  await assertNameIsFree(name, id);

  const branch = await prisma.stockLocation.update({
    where: { id },
    data: { name },
    select: branchSelect,
  });

  return shape(branch);
}

// Closing a store must not strand staff or stock. The main store never closes:
// every delivery enters there.
export async function changeBranchStatus(
  id: string,
  isActive: boolean,
) {
  const branch = await requireBranch(id);

  if (!isActive) {
    if (branch.isMainStock) {
      throw new Error("MAIN_STORE_FIXED");
    }

    const activeUsers = await prisma.user.count({
      where: { branchId: id, isActive: true },
    });

    if (activeUsers > 0) {
      const error = new Error("BRANCH_HAS_ACTIVE_USERS");
      Object.assign(error, { activeUsers });
      throw error;
    }

    const remainingStock = await prisma.inventoryBalance.aggregate({
      where: { locationId: id },
      _sum: { quantity: true },
    });

    if ((remainingStock._sum.quantity ?? 0) > 0) {
      const error = new Error("BRANCH_HAS_STOCK");
      Object.assign(error, {
        remainingQuantity: remainingStock._sum.quantity,
      });
      throw error;
    }
  }

  const updated = await prisma.stockLocation.update({
    where: { id },
    data: { isActive },
    select: branchSelect,
  });

  return shape(updated);
}

// Only a store that was never used can be removed outright. Anything with
// history is deactivated instead.
async function countBranchHistory(id: string) {
  const [
    users,
    balances,
    units,
    sales,
    transfersFrom,
    transfersTo,
    movementsFrom,
    movementsTo,
    expenses,
    equipment,
  ] = await prisma.$transaction([
    prisma.user.count({ where: { branchId: id } }),
    prisma.inventoryBalance.count({ where: { locationId: id } }),
    prisma.inventoryUnit.count({ where: { locationId: id } }),
    prisma.sale.count({ where: { locationId: id } }),
    prisma.stockTransfer.count({ where: { fromLocationId: id } }),
    prisma.stockTransfer.count({ where: { toLocationId: id } }),
    prisma.stockMovement.count({ where: { fromLocationId: id } }),
    prisma.stockMovement.count({ where: { toLocationId: id } }),
    prisma.expense.count({ where: { locationId: id } }),
    prisma.officeAsset.count({ where: { locationId: id } }),
  ]);

  return {
    users,
    balances,
    units,
    sales,
    transfersFrom,
    transfersTo,
    movementsFrom,
    movementsTo,
    expenses,
    equipment,
  };
}

export async function deleteBranch(id: string) {
  const branch = await requireBranch(id);

  if (branch.isMainStock) {
    throw new Error("MAIN_STORE_FIXED");
  }

  const history = await countBranchHistory(id);
  const total = Object.values(history).reduce((a, b) => a + b, 0);

  if (total > 0) {
    const error = new Error("BRANCH_HAS_HISTORY");
    Object.assign(error, {
      history: Object.fromEntries(
        Object.entries(history).filter(([, count]) => count > 0),
      ),
    });
    throw error;
  }

  await prisma.stockLocation.delete({ where: { id } });

  return { id: branch.id, name: branch.name };
}
