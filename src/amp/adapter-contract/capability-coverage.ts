/**
 * Capability coverage declaration parser and validation.
 *
 * Falsifiable claim: unsupported capabilities are reported honestly as
 * `unsupported` rather than silently treated as native.
 */

import { z } from "zod";

export const CapabilityLevelSchema = z.enum(["native", "wrapped", "unsupported"]);
export type CapabilityLevel = z.infer<typeof CapabilityLevelSchema>;

export const CapabilityCoverageSchema = z
  .object({
    frame_kinds: z
      .object({
        episodic: CapabilityLevelSchema,
        semantic: CapabilityLevelSchema,
        crystal: CapabilityLevelSchema,
      })
      .strict(),
    curation_mode: CapabilityLevelSchema,
    vector_search: CapabilityLevelSchema,
    graph_traversal: CapabilityLevelSchema,
    transactions: CapabilityLevelSchema,
    embedding_storage: CapabilityLevelSchema,
    full_text_search: CapabilityLevelSchema,
    profile_slots: CapabilityLevelSchema,
    procedural_registry: CapabilityLevelSchema,
    skill_optimization: CapabilityLevelSchema,
    action_log: CapabilityLevelSchema,
  })
  .strict();

export type CapabilityCoverage = z.infer<typeof CapabilityCoverageSchema>;

export type CapabilityCoverageParseResult =
  | { success: true; coverage: CapabilityCoverage }
  | { success: false; error: string };

export function parseCapabilityCoverage(input: unknown): CapabilityCoverageParseResult {
  const parsed = CapabilityCoverageSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }
  return { success: true, coverage: parsed.data };
}

/** Returns true when the backend declares native or wrapped support. */
export function isCapabilitySupported(
  coverage: CapabilityCoverage,
  feature: keyof CapabilityCoverage
): boolean {
  const level = coverage[feature];
  if (typeof level === "string") {
    return level !== "unsupported";
  }
  return false;
}

/** Returns true when every frame kind is at least wrapped. */
export function meetsMinimalCompliance(coverage: CapabilityCoverage): boolean {
  const kinds = Object.values(coverage.frame_kinds);
  return (
    kinds.every((level) => level !== "unsupported") &&
    coverage.curation_mode !== "unsupported"
  );
}

/** Slice-default coverage for in-memory / raw-fs backends. */
export function createSliceCapabilityCoverage(
  overrides: Partial<CapabilityCoverage> = {}
): CapabilityCoverage {
  const base: CapabilityCoverage = {
    frame_kinds: {
      episodic: "native",
      semantic: "native",
      crystal: "wrapped",
    },
    curation_mode: "native",
    vector_search: "unsupported",
    graph_traversal: "unsupported",
    transactions: "wrapped",
    embedding_storage: "unsupported",
    full_text_search: "unsupported",
    profile_slots: "unsupported",
    procedural_registry: "unsupported",
    skill_optimization: "wrapped",
    action_log: "unsupported",
  };
  return CapabilityCoverageSchema.parse({ ...base, ...overrides });
}
