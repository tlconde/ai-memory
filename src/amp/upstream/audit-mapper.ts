/**
 * Map upstream apply audit events to typed episodic-frame records.
 */

import type { RuntimeSemanticEntityRecord } from "../runtime-semantics/entity-record.js";
import type { EpisodicFrame } from "../runtime-semantics/schema.js";

export const UPSTREAM_APPLIED_CAPTURE_PATH = "upstream_sync_apply";

export interface UpstreamAppliedAuditInput {
  recordId: string;
  sourceId: string;
  changesetId: string;
  applied: readonly string[];
  skipped: readonly string[];
  projectRef?: string;
  occurredAt: string;
  recordedAt: string;
}

/** Map upstream apply result to an episodic-frame audit record. */
export function mapUpstreamAppliedToEntityRecord(
  input: UpstreamAppliedAuditInput
): RuntimeSemanticEntityRecord {
  const projectRef = input.projectRef?.trim();
  const payload: EpisodicFrame = {
    id: input.recordId,
    event_type: "upstream_applied",
    summary: `Upstream sync applied for ${input.sourceId}: ${input.applied.length} procedure(s).`,
    details: {
      source_id: input.sourceId,
      changeset_id: input.changesetId,
      applied: [...input.applied],
      skipped: [...input.skipped],
      capture_path: UPSTREAM_APPLIED_CAPTURE_PATH,
    },
    tags: ["upstream-sync"],
    scope: projectRef ? "project" : "user",
    ...(projectRef ? { project_ref: projectRef } : {}),
    curation_mode: "personal",
    occurred_at: input.occurredAt,
    recorded_at: input.recordedAt,
    source_signals: [],
    related_entities: {},
    evidence_refs: [],
    provenance: {
      transform_id: "upstream-sync:apply",
    },
    confidence: "high",
    source: "tool_observed",
    sensitivity: "normal",
    visibility: projectRef ? "project_only" : "user_private",
    pinned: false,
    lifecycle_state: "active",
  };

  return {
    id: input.recordId,
    kind: "episodic-frame",
    scope: projectRef ? "project" : "user",
    ...(projectRef ? { project_ref: projectRef } : {}),
    observed_at: input.occurredAt,
    payload,
  };
}
