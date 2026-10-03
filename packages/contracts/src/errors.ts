import { z } from "zod";

export const errorResponseSchema = z.discriminatedUnion("error", [
  z.object({
    error: z.literal("invalid_request"),
    message: z.string(),
    issues: z.array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    ),
  }),
  z.object({
    error: z.literal("configuration"),
    message: z.string(),
    missing: z.array(z.string()),
  }),
  z.object({
    error: z.literal("provider"),
    message: z.string(),
  }),
]);

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
