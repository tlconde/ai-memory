/**
 * Episodic signal → semantic frame mapping for consolidation.
 */

import { projectScopeRequiresRef } from "../../core/errors.js";
import { createFrame, type Frame } from "../../core/frame-schema.js";
import type { EpisodicSignal } from "../storage/episodic-signal.js";

export function episodicSignalToSemanticFrame(signal: EpisodicSignal): Frame {
  if (signal.scope === "project" && !signal.projectRef) {
    throw projectScopeRequiresRef("consolidate");
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
