import "dotenv/config";
import { PrismaClient, UserRole } from "database";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

/**
 * Sets up a fresh AnteTech database: the first Owner, the main store, and the
 * two starter categories. Nothing else.
 *
 * Selling stores, staff and products are the Owner's to set up in the app,
 * where the rules are enforced. The main store is made here because the app
 * never creates one: there is exactly one, and every delivery enters there.
 *
 * The credentials come from the environment, never from this file: a password
 * written into the repository is a password everyone has. Run it as
 *
 *   OWNER_EMAIL=you@example.com OWNER_PASSWORD='...' npx tsx prisma/seed.ts
 *
 * Optional: OWNER_NAME, MAIN_STORE_NAME (default "Main Store").
 *
 * It is safe to run twice: an existing Owner, main store or category is left
 * as it is, so a second run can never quietly add a way in beside yours.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function seedOwner() {
  const existing = await prisma.user.findFirst({
    where: { role: UserRole.OWNER },
    select: { email: true },
  });

  if (existing) {
    console.log(`An Owner already exists (${existing.email}). Left as it is.`);
    return;
  }

  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set OWNER_EMAIL and OWNER_PASSWORD, e.g.\n" +
        "  OWNER_EMAIL=you@example.com OWNER_PASSWORD='a long password' npx tsx prisma/seed.ts",
    );
  }

  if (password.length < 8) {
    throw new Error("OWNER_PASSWORD must be at least 8 characters");
  }

  const owner = await prisma.user.create({
    data: {
      name: process.env.OWNER_NAME?.trim() || "Owner",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: UserRole.OWNER,
    },
    select: { email: true },
  });

  console.log(`Owner created: ${owner.email}`);
}

async function seedMainStore() {
  const existing = await prisma.stockLocation.findFirst({
    where: { isMainStock: true },
    select: { name: true },
  });

  if (existing) {
    console.log(`Main store already exists (${existing.name}).`);
    return;
  }

  const name = process.env.MAIN_STORE_NAME?.trim() || "Main Store";

  await prisma.stockLocation.create({
    data: { name, isMainStock: true, isActive: true },
  });

  console.log(`Main store created: ${name}`);
}

async function seedCategories() {
  const starters = [
    { name: "Phones", kind: "SERIALIZED" as const },
    { name: "Accessories", kind: "QUANTITY" as const },
  ];

  for (const category of starters) {
    await prisma.category.upsert({
      where: { name: category.name },
      create: category,
      update: {},
    });
  }

  console.log("Categories ready: Phones (by IMEI), Accessories (by count).");
}

async function main() {
  await seedOwner();
  await seedMainStore();
  await seedCategories();

  console.log(
    "Sign in, then add your selling stores, staff and products in the app.",
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
