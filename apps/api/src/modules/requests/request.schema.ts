import { z } from "zod";

// A restock request: a seller telling the Owner their store is running low.
// Quantities only - the Owner decides which store the goods come from.
export const createRequestSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),
      }),
    )
    .min(1, "A request needs at least one item"),

  notes: z.string().max(500).optional(),
});

// The Owner approves and names the branch the stock will ship from.
//
// `items` lets the reviewer approve less than was asked for, line by line
// (50 requested, 40 approved). A line left out is approved in full, so a
// plain approval still needs no item list. 0 declines that line.
export const approveRequestSchema = z.object({
  sourceBranchId: z.string().min(1).optional(),
  notes: z.string().max(500).optional(),

  // Who is carrying it. Required: the goods travel by road to the store.
  driverName: z.string().trim().min(2).max(120).optional(),
  driverPhone: z
    .string()
    .trim()
    .min(7, "A phone number needs at least 7 digits")
    .max(24)
    .regex(/^[+()\d][\d\s()+-]*$/, "Use digits, spaces, and + ( ) - only")
    .optional(),
  vehiclePlate: z.string().trim().min(2).max(40).optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        approvedQuantity: z.coerce.number().int().min(0),
      }),
    )
    .optional(),
});

export const rejectRequestSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});

export const listRequestsQuerySchema = z.object({
  status: z
    .enum([
      "PENDING",
      "APPROVED",
      "REJECTED",
      "FULFILLED",
      "CANCELLED",
    ])
    .optional(),
  branchId: z.string().min(1).optional(),
});

export type CreateRequestInput = z.infer<
  typeof createRequestSchema
>;
export type ApproveRequestInput = z.infer<
  typeof approveRequestSchema
>;
export type ListRequestsQuery = z.infer<
  typeof listRequestsQuerySchema
>;
