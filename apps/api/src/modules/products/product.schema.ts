import { z } from "zod";

// A phone is filed under its brand (a type); an accessory straight under its
// category (Glass, Speaker) with a model. A name may be supplied to override
// the generated one, but never a code.
const baseProductSchema = z.object({
  typeId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().max(500).optional(),
  // A suggestion only: the seller enters the real price at each sale.
  price: z.coerce.number().nonnegative().nullable().optional(),
  // What the business pays for one, for profit and loss. Owner only.
  costPrice: z.coerce.number().nonnegative().max(100_000_000).nullable().optional(),
});

export const createProductSchema = baseProductSchema
  .extend({
    // The variant: part of the name, and kept as details for serialized goods.
    model: z.string().max(80).optional(),
    // A phone's brand, when it is not the type itself.
    brand: z.string().trim().max(60).optional(),
    storage: z.string().max(40).optional(),
    color: z.string().max(40).optional(),
  })
  .refine((v) => Boolean(v.typeId || v.categoryId), {
    message: "Choose a category",
    path: ["categoryId"],
  });

// The category, type and code are fixed once a product exists: stock and
// sales are counted against them. Everything that describes it can change.
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().max(500).nullable().optional(),
    price: z.coerce.number().nonnegative().nullable().optional(),
    // null clears a buying price typed by mistake.
    costPrice: z.coerce.number().nonnegative().max(100_000_000).nullable().optional(),
    // Moving a product to another type of the same category.
    typeId: z.string().min(1).optional(),
    // Serialized goods only.
    brand: z.string().trim().max(60).nullable().optional(),
    model: z.string().trim().min(1).max(80).optional(),
    storage: z.string().max(40).nullable().optional(),
    color: z.string().max(40).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: "Nothing to change",
  });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
