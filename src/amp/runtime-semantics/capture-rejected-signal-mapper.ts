/**
 * Pure mapper from rejected capture audit metadata to rejected-signal-log entities (RUNTIME-06).
 *
 * Falsifiable claim: rejected capture signals become audit-only rejected-signal-log rows
 * without raw content fields.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import type { RuntimeCaptureRejectionReasonCode } from "./capture-exclusion-filter.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import type { RejectedSignalLog } from "./schema.js";

export const REJECTED_SIGNAL_DEFAULT_RECORD_ID_PREFIX = "rejected-signal:";

export interface RuntimeRejectedCaptureInput {
  /** Typed runtime semantic entity id for the audit row. */
  recordId: string;
  /** Payload rejected_signal_id (may differ from record id). */
  rejectedSignalId: string;
  timestamp: string;
  reasonCode: RuntimeCaptureRejectionReasonCode;
  sourceSurface: string;
  scope: ScopeKind;
  projectRef?: string;
  sourceHash: string;
  redactedExcerpt?: string;
}

export type RuntimeRejectedCaptureMapFailureReason = "missing_project_ref";

export type RuntimeRejectedCaptureMapResult =
  | { ok: true; record: RuntimeSemanticEntityRecord }
  | {
      ok: false;
      reason: RuntimeRejectedCaptureMapFailureReason;
      message: string;
    };

/** Default typed record id for one rejected capture audit row. */
export function defaultRejectedSignalRecordId(rejectedSignalId: string): string {
  return `${REJECTED_SIGNAL_DEFAULT_RECORD_ID_PREFIX}${rejectedSignalId}`;
}

/** Map rejected capture audit metadata to a rejected-signal-log runtime entity record. */
export function mapRejectedRuntimeCaptureToEntityRecord(
  input: RuntimeRejectedCaptureInput,
): RuntimeRejectedCaptureMapResult {
  if (input.scope === "project" && !input.projectRef?.trim()) {
    return {
      ok: false,
      reason: "missing_project_ref",
      message: "Project-scoped rejected-signal-log rows require project_ref.",
    };
  }

  const projectRef = input.projectRef?.trim();
  const payload: RejectedSignalLog = {
    rejected_signal_id: input.rejectedSignalId,
    timestamp: input.timestamp,
    reason_code: input.reasonCode,
    source_surface: input.sourceSurface,
    scope: input.scope,
    source_hash: input.sourceHash,
    ...(input.redactedExcerpt ? { redacted_excerpt: input.redactedExcerpt } : {}),
  };

  return {
    ok: true,
    record: {
      id: input.recordId,
      kind: "rejected-signal-log",
      scope: input.scope,
      ...(projectRef ? { project_ref: projectRef } : {}),
      observed_at: input.timestamp,
      payload,
    },
  };
}
