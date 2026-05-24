/**
 * SSA (Substrate Storage Adapter) declarative spec schema.
 *
 * Falsifiable claim: substrate-role specs require a valid capability_coverage block
 * parsed via the shared adapter-contract parser.
 */

import { z } from "zod";

import {
  parseCapabilityCoverage,
  type CapabilityCoverage,
} from "../adapter-contract/capability-coverage.js";
import { ExternalClaimSchema, type ExternalClaim } from "./claim-label.js";

export const SSA_ROLE = "substrate" as const;

export const SsaSpecBaseSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    role: z.literal(SSA_ROLE),
    capability_coverage: z.unknown(),
    external_claims: z.array(ExternalClaimSchema).optional(),
  })
  .strict();

export type SsaSpecBase = z.infer<typeof SsaSpecBaseSchema>;

export type SsaSpec = Omit<SsaSpecBase, "capability_coverage"> & {
  capability_coverage: CapabilityCoverage;
};

export type SsaSpecParseResult =
  | { success: true; spec: SsaSpec }
  | { success: false; error: string; issues?: z.ZodIssue[] };

export function parseSsaSpec(input: unknown): SsaSpecParseResult {
  const base = SsaSpecBaseSchema.safeParse(input);
  if (!base.success) {
    return {
      success: false,
      error: base.error.message,
      issues: base.error.issues,
    };
  }

  const coverage = parseCapabilityCoverage(base.data.capability_coverage);
  if (!coverage.success) {
    return {
      success: false,
      error: coverage.error,
      issues: [
        {
          code: "custom",
          message: coverage.error,
          path: ["capability_coverage"],
        } as z.ZodIssue,
      ],
    };
  }

  const { capability_coverage: _raw, external_claims, ...rest } = base.data;
  const spec: SsaSpec = {
    ...rest,
    capability_coverage: coverage.coverage,
    ...(external_claims !== undefined ? { external_claims } : {}),
  };

  return { success: true, spec };
}

export function safeParseSsaSpec(input: unknown): SsaSpecParseResult {
  return parseSsaSpec(input);
}

export type { ExternalClaim };
