/**
 * Queue-to-gbrain consolidation with durable remove-after-write semantics.
 *
 * Falsifiable claim: runtime queue entries are removed only after a successful
 * gbrain knowledge write; failed or partial writes leave the queue intact.
 *
 * Live gbrain consolidation behavior is PROVISIONAL unless tested against
 * local `gbrain serve` — unit tests use {@link FakeGbrainMcpTransport}.
 */

import type { GbrainKnowledgeAdapter } from "../../adapters/ssa/gbrain/adapter.js";
import { isWriteSuccess } from "../../adapter-contract/operation-results.js";
import type { RuntimeStore } from "../storage/runtime-store.js";
import type { ConsolidationResult } from "../storage/consolidation-minimal.js";
import { episodicSignalToSemanticFrame } from "./signal-to-frame.js";

export type { ConsolidationResult };

/**
 * Drain runtime episodic queue into gbrain-backed knowledge storage.
 *
 * Queue entries are removed only after {@link GbrainKnowledgeAdapter.writeFrames}
 * reports full success for all converted frames.
 */
export async function consolidateToGbrain(
  runtime: RuntimeStore,
  knowledge: GbrainKnowledgeAdapter
): Promise<ConsolidationResult> {
  const queued = runtime.queueList();
  const frames = queued.map((item) => episodicSignalToSemanticFrame(item.payload));

  if (frames.length === 0) {
    return { processed: 0, frameIds: [] };
  }

  const writeResult = await knowledge.writeFrames(frames);
  if (!isWriteSuccess(writeResult)) {
    throw writeResult.error;
  }

  runtime.queueRemoveIds(queued.map((item) => item.id));

  return {
    processed: frames.length,
    frameIds: frames.map((frame) => frame.id),
  };
}
