/**
 * External claim labels for adapter and spec documentation.
 *
 * Falsifiable claim: only VERIFIED, PROVISIONAL, and UNKNOWN labels are accepted.
 */

import { z } from "zod";

export const ExternalClaimLabelSchema = z.enum(["VERIFIED", "PROVISIONAL", "UNKNOWN"]);
export type ExternalClaimLabel = z.infer<typeof ExternalClaimLabelSchema>;

export const ExternalClaimSchema = z
  .object({
    claim: z.string().min(1),
    label: ExternalClaimLabelSchema,
    evidence: z.string().min(1).optional(),
  })
  .strict();

export type ExternalClaim = z.infer<typeof ExternalClaimSchema>;

export function parseExternalClaim(input: unknown) {
  return ExternalClaimSchema.safeParse(input);
}
