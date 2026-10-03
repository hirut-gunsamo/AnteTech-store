import { z } from "zod";

// Selling stores are created and retired through the API. There is no limit
// on how many there may be. The main store is made once, by the seed.
export const createBranchSchema = z.object({
  name: z.string().min(2).max(100),
});

export const updateBranchSchema = z.object({
  name: z.string().min(2).max(100),
});

export const updateBranchStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listBranchesQuerySchema = z.object({
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  isMainStock: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type ListBranchesQuery = z.infer<
  typeof listBranchesQuerySchema
>;
