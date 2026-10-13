import { PrismaClient } from "database";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});

export const prisma = new PrismaClient({
  adapter,
  // Buying prices are the Owner's alone. Left out of every query by default,
  // so no response can carry one to a seller by accident; the few places that
  // need them (the Owner's product reads, recording a sale, the profit report)
  // ask for them explicitly.
  omit: {
    product: { costPrice: true },
    saleItem: { unitCost: true },
  },
});