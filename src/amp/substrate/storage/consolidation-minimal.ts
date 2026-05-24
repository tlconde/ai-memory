/**
 * Minimal synchronous consolidation: drain runtime queue → knowledge store.
 *
 * Falsifiable claim: queued episodic signals become semantic frames in the
 * knowledge store and are removed from the runtime queue.
 */

import { projectScopeRequiresRef } from "../../core/errors.js";
import { createFrame, type Frame } from "../../core/frame-schema.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import type { EpisodicSignal } from "./episodic-signal.js";
import { RuntimeStore } from "./runtime-store.js";

export interface ConsolidationResult {
  processed: number;
  frameIds: string[];
}

function signalToSemanticFrame(signal: EpisodicSignal): Frame {
  if (signal.scope === "project" && !signal.projectRef) {
    throw projectScopeRequiresRef("consolidateNow");
  }

  const scope =
    signal.scope === "project"
      ? { kind: signal.scope, project_ref: signal.projectRef! }
      : { kind: signal.scope };

  return createFrame({
    id: `frame-${signal.id}`,
    kind: "semantic",
    content: signal.content,
    source: signal.source,
    created_at: signal.source.captured_at ?? new Date().toISOString(),
    scope,
    curation_mode: signal.curationMode ?? "personal",
    kind_provenance: {
      default_inferred: "semantic",
      default_basis: "consolidation:preference-signal",
      user_override: null,
      override_reason: null,
      final_kind_source: "default",
    },
  });
}

/** Drain runtime episodic queue into the knowledge store (C5). */
export function consolidateNow(runtime: RuntimeStore, knowledge: KnowledgeStore): ConsolidationResult {
  const queued = runtime.queueList();
  const frames = queued.map((item) => signalToSemanticFrame(item.payload));
  if (frames.length > 0) {
    knowledge.write(frames);
    runtime.queueRemoveIds(queued.map((item) => item.id));
  }
  return {
    processed: frames.length,
    frameIds: frames.map((frame) => frame.id),
  };
}
