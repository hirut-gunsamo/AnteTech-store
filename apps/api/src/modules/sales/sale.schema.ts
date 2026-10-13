import { z } from "zod";

// A salesperson records what they are selling, and the price each item was
// sold for: prices are agreed with the customer, so the product's price is
// only a suggestion, used when no price is sent.
export const createSaleSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),
        // What one sold for. Left out, the product's suggested price is used.
        unitPrice: z.coerce.number().positive().max(100_000_000).optional(),

        // One IMEI or serial number per unit of a serialized product. The
        // service checks the count against the quantity; counted goods must
        // send none.
        //
        // Trimmed before anything else sees them: the unique index on serial
        // is what stops a handset being sold twice, and it would treat
        // "12345 " and "12345" as two different handsets. No length or digit
        // rule beyond this — the owner has not fixed a format, and guessing one
        // would refuse real sales. The array is capped so a pathological payload
        // cannot build a huge IN clause before the cheaper checks run.
        serials: z
          .array(z.string().trim().min(3).max(40))
          .max(500)
          .optional(),
      }),
    )
    .min(1, "A sale needs at least one item"),

  // The amount received in cash.
  cashReceived: z.coerce.number().nonnegative(),
  // The amount received by transfer (0 unless transfer is used).
  transferReceived: z.coerce.number().nonnegative().default(0),

  // Cash only, transfer only, or a split payment.
  paymentMethod: z
    .enum(["CASH", "TRANSFER", "CASH_AND_TRANSFER"])
    .default("CASH"),
  bankName: z.string().trim().min(1).max(80).optional(),

  customerNote: z.string().max(500).optional(),
})
  .refine(
    (sale) => sale.paymentMethod === "CASH" || Boolean(sale.bankName),
    {
      message: "Choose the bank the transfer went to",
      path: ["bankName"],
    },
  )
  .refine(
    (sale) => {
      if (sale.paymentMethod === "CASH") {
        return sale.cashReceived > 0 && sale.transferReceived === 0;
      }

      if (sale.paymentMethod === "TRANSFER") {
        return sale.cashReceived === 0 && sale.transferReceived > 0;
      }

      return sale.cashReceived > 0 && sale.transferReceived > 0;
    },
    {
      message: "Enter valid received amounts for the selected payment method",
      path: ["cashReceived"],
    },
  );

export const listSalesQuerySchema = z.object({
  status: z
    .enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"])
    .optional(),
  branchId: z.string().min(1).optional(),
  salespersonId: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
