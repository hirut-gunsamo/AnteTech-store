import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { Prisma } from "database";

import { loadViewer } from "../../middleware/auth.js";

import {
  createSaleSchema,
  listSalesQuerySchema,
} from "./sale.schema.js";

import {
  createSale,
  getSales,
  getSaleById,
  deleteSale,
} from "./sale.service.js";

type SaleParams = {
  id: string;
};

type Shortage = {
  productId: string;
  requested: number;
  available: number;
};

function handleSaleError(
  error: unknown,
  reply: FastifyReply,
): FastifyReply | null {
  // Backstop for the SERIAL_ALREADY_SOLD race: that check is a read followed by
  // a write, so two tills entering the same handset at the same instant both
  // pass it and the second one loses on the unique index instead. The
  // transaction rolls back either way, so the stock stays right; this is only
  // so the seller reads the same sentence rather than a 500. The unique index
  // on serial is the only one the sales module can trip.
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return reply.status(409).send({
      message: "That serial number has already been sold",
    });
  }

  if (!(error instanceof Error)) {
    return null;
  }

  switch (error.message) {
    case "NO_BRANCH":
      return reply.status(400).send({
        message: "You are not assigned to a store",
      });

    case "NOT_A_SELLING_STORE":
      return reply.status(403).send({
        message: "Sales can only be recorded at an open selling store",
      });

    case "INVALID_PRODUCT":
      return reply.status(400).send({
        message: "One or more products are unknown or inactive",
      });

    case "INSUFFICIENT_STOCK":
      return reply.status(409).send({
        message:
          "Your store does not have enough stock for this sale",
        shortages: (error as Error & { shortages?: Shortage[] })
          .shortages,
      });

    case "SERIAL_COUNT_MISMATCH":
      return reply.status(400).send({
        message: "Enter one serial number for each item sold",
      });

    case "SERIAL_REPEATED":
      return reply.status(400).send({
        message: "The same serial number was entered twice",
      });

    case "SERIAL_ALREADY_SOLD":
      return reply.status(409).send({
        message: "That serial number has already been sold",
      });

    case "SERIALS_NOT_EXPECTED":
      return reply.status(400).send({
        message: "This product does not carry serial numbers",
      });

    case "SALE_NOT_FOUND":
      return reply.status(404).send({
        message: "Sale not found",
      });

    case "NOT_YOUR_SALE":
      return reply.status(403).send({
        message: "You can only act on your own sale",
      });

    case "SALE_NOT_DRAFT":
      return reply.status(409).send({
        message: "This sale has already been submitted",
      });

    default:
      return null;
  }
}

async function withViewer(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const viewer = await loadViewer(request);

  if (!viewer) {
    reply.status(403).send({
      message: "User account is inactive",
    });

    return null;
  }

  return viewer;
}

export async function createSaleController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = createSaleSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid sale data",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    const sale = await createSale(result.data, viewer);

    return reply.status(201).send({
      message: "Sale recorded",
      sale,
    });
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}

export async function getSalesController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = listSalesQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid filters",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const sales = await getSales(result.data, viewer);

  return reply.send({ sales });
}

export async function getSaleController(
  request: FastifyRequest<{
    Params: SaleParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const sale = await getSaleById(request.params.id, viewer);

  if (!sale) {
    return reply.status(404).send({
      message: "Sale not found",
    });
  }

  return reply.send({ sale });
}

export async function deleteSaleController(
  request: FastifyRequest<{
    Params: SaleParams;
  }>,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  try {
    await deleteSale(request.params.id, viewer);

    return reply.send({
      message: "Draft sale deleted",
    });
  } catch (error) {
    return handleSaleError(error, reply) ?? Promise.reject(error);
  }
}
