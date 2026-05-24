/**
 * Runtime store, knowledge store interface, consolidation.
 *
 * @module amp/substrate/storage
 */

export const AMP_STORAGE_VERSION = "0.0.0";

export * from "./knowledge-store.js";
export * from "./episodic-signal.js";
export * from "./runtime-store.js";
export * from "./consolidation-minimal.js";
export { consolidateToGbrain, episodicSignalToSemanticFrame } from "../consolidation/index.js";
