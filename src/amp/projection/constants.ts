/**
 * AMP filesystem projection constants (v1.5 design).
 *
 * Falsifiable claim: four projection file kinds map to stable default paths,
 * scopes, and per-file token targets aligned with AMP_CONSOLIDATED_SPEC §4.2.1.
 */

export const AMP_PROJECTION_ARTIFACT_VERSION = "1.0";

/** Default combined token cap across all four projection files (§4.2.3). */
export const DEFAULT_COMBINED_TOKEN_BUDGET = 2000;

/** Hard failure multiplier when materialization must refuse (§4.2.3). */
export const PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER = 2;

/** Per-file suggested token targets (§4.2.1). */
export const DEFAULT_FILE_TOKEN_TARGETS = {
  global_projection: 500,
  global_runtime: 300,
  project_projection: 700,
  project_runtime: 500,
} as const;

export type ProjectionFileKind = keyof typeof DEFAULT_FILE_TOKEN_TARGETS;

/** Sum of per-file targets; informational only — combined cap is authoritative. */
export const DEFAULT_FILE_TOKEN_TARGET_SUM = Object.values(DEFAULT_FILE_TOKEN_TARGETS).reduce(
  (sum, target) => sum + target,
  0
);

export const PROJECTION_TRUNCATION_MARKER = "<!-- amp:truncated -->";

export const PROJECTION_FILE_KINDS = [
  "global_projection",
  "global_runtime",
  "project_projection",
  "project_runtime",
] as const satisfies readonly ProjectionFileKind[];
