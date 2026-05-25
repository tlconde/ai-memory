/**
 * Minimal synchronous consolidation: drain runtime queue → knowledge store.
 *
 * Falsifiable claim: queued episodic signals become semantic frames in the
 * knowledge store and are removed from the runtime queue.
 */

import type { KnowledgeStore } from "./knowledge-store.js";
import { RuntimeStore } from "./runtime-store.js";
import { episodicSignalToSemanticFrame } from "../consolidation/signal-to-frame.js";
import type { ConsolidationResult } from "../consolidation/types.js";

/** Drain runtime episodic queue into the knowledge store (C5). */
export function consolidateNow(runtime: RuntimeStore, knowledge: KnowledgeStore): ConsolidationResult {
  const queued = runtime.queueList();
  const frames = queued.map((item) => episodicSignalToSemanticFrame(item.payload));
  if (frames.length > 0) {
    knowledge.write(frames);
    runtime.queueRemoveIds(queued.map((item) => item.id));
  }
  return {
    processed: frames.length,
    frameIds: frames.map((frame) => frame.id),
  };
}
