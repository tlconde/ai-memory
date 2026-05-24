/**
 * Public substrate API for the AMP vertical slice.
 *
 * @module amp/substrate
 */

export {
  capturePreference,
  type CapturePreferenceInput,
  type CapturePreferenceResult,
} from "./capture-preference.js";
export {
  retrievePreference,
  retrievePreferences,
  type RetrievePreferenceInput,
  type RetrievedPreference,
} from "./retrieve-preference.js";
export { consolidateNow, type ConsolidationResult } from "./storage/consolidation-minimal.js";
export { consolidateToGbrain, episodicSignalToSemanticFrame } from "./consolidation/index.js";
export type { KnowledgeStore, KnowledgeListFilter } from "./storage/knowledge-store.js";
