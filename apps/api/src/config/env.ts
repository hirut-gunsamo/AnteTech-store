import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  // 3001, not the common 3000, so another app on the same computer can keep 3000.
  PORT: z.coerce.number().default(3001),
  // Phone notifications. All three unset turns them off; nothing else breaks.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:owner@example.com"),
});

export const env = envSchema.parse(process.env);