/**
 * Inference sub-layer: deterministic feedback from correction frames.
 *
 * @module amp/substrate/inference
 */

export const AMP_INFERENCE_VERSION = "1.0.0";

export {
  OVERRIDE_TABLE_SCHEMA_VERSION,
  applyCorrectionToOverrideTable,
  buildOverrideTableFromCorrections,
  createEmptyOverrideTable,
  lookupOverride,
  overrideLookupKey,
  type DeterministicOverrideEntry,
  type DeterministicOverrideTable,
  type OverrideLookupInput,
  type OverrideLookupResult,
} from "./override-table.js";
