/**
 * Pure mapper from explicit preference-candidate capture input to typed runtime entities.
 *
 * Falsifiable claim: explicit preference capture input becomes a runtime-preference-candidate
 * record without queue or durable semantic promotion side effects.
 */

import { createHash } from "node:crypto";

import type { ScopeKind } from "../core/frame-schema.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import type {
  RuntimeConfidence,
  RuntimePreferenceCandidate,
  RuntimePreferenceContext,
  RuntimePreferenceMode,
} from "./schema.js";

export const RUNTIME_PREFERENCE_CANDIDATE_DEFAULT_RECORD_ID_PREFIX =
  "runtime-preference-candidate:";

export interface CaptureRuntimePreferenceCandidateInput {
  /** Preference statement text. */
  statement: string;
  mode: RuntimePreferenceMode;
  scope: ScopeKind;
  projectRef?: string;
  /** Typed runtime semantic entity id; defaults from statement/scope when omitted. */
  recordId?: string;
  /** Required when mode is time_bounded. */
  expiresAt?: string;
  /** ISO timestamp used for first_observed_at and last_observed_at. */
  observedAt: string;
  /** Traceable source signal ids for RUNTIME-28 provenance gates. */
  sourceSignalIds: readonly string[];
  confidence?: RuntimeConfidence;
  context?: RuntimePreferenceContext;
}

export type CaptureRuntimePreferenceCandidateMapFailureReason =
  | "invalid_statement"
  | "missing_project_ref"
  | "missing_source_signal_id"
  | "missing_expires_at";

export type CaptureRuntimePreferenceCandidateMapResult =
  | { ok: true; record: RuntimeSemanticEntityRecord }
  | {
      ok: false;
      reason: CaptureRuntimePreferenceCandidateMapFailureReason;
      message: string;
    };

function hasNonBlankSourceSignalIds(sourceSignalIds: readonly string[]): boolean {
  return sourceSignalIds.some((value) => value.trim().length > 0);
}

/** Default typed record id derived deterministically from capture input. */
export function defaultRuntimePreferenceCandidateRecordId(input: {
  statement: string;
  scope: ScopeKind;
  projectRef?: string;
  mode: RuntimePreferenceMode;
}): string {
  const digest = createHash("sha256")
    .update(input.scope)
    .update("\0")
    .update(input.projectRef?.trim() ?? "")
    .update("\0")
    .update(input.mode)
    .update("\0")
    .update(input.statement.trim())
    .digest("hex")
    .slice(0, 16);
  return `${RUNTIME_PREFERENCE_CANDIDATE_DEFAULT_RECORD_ID_PREFIX}${digest}`;
}

/** Map explicit preference-candidate capture input to a typed runtime semantic entity record. */
export function mapCaptureRuntimePreferenceCandidateToEntityRecord(
  input: CaptureRuntimePreferenceCandidateInput,
): CaptureRuntimePreferenceCandidateMapResult {
  const statement = input.statement.trim();
  if (statement.length === 0) {
    return {
      ok: false,
      reason: "invalid_statement",
      message: "Preference statement must be a non-empty string.",
    };
  }

  if (input.scope === "project" && !input.projectRef?.trim()) {
    return {
      ok: false,
      reason: "missing_project_ref",
      message: "Project-scoped preference candidates require project_ref.",
    };
  }

  if (!hasNonBlankSourceSignalIds(input.sourceSignalIds)) {
    return {
      ok: false,
      reason: "missing_source_signal_id",
      message: "Preference candidates require at least one non-blank source_signal_id.",
    };
  }

  if (input.mode === "time_bounded" && !input.expiresAt?.trim()) {
    return {
      ok: false,
      reason: "missing_expires_at",
      message: "time_bounded preference candidates require expires_at.",
    };
  }

  const projectRef = input.projectRef?.trim();
  const recordId =
    input.recordId?.trim() ??
    defaultRuntimePreferenceCandidateRecordId({
      statement,
      scope: input.scope,
      projectRef,
      mode: input.mode,
    });

  const payload: RuntimePreferenceCandidate = {
    id: recordId,
    statement,
    mode: input.mode,
    scope: input.scope,
    ...(projectRef ? { project_ref: projectRef } : {}),
    context: input.context ?? {},
    status: "active",
    ...(input.mode === "time_bounded" && input.expiresAt
      ? { expires_at: input.expiresAt.trim() }
      : {}),
    first_observed_at: input.observedAt,
    last_observed_at: input.observedAt,
    source_signal_ids: input.sourceSignalIds.map((value) => value.trim()).filter(Boolean),
    confidence: input.confidence ?? "medium",
    promotion_evidence: {
      repetition_count: 0,
      independent_sessions: 0,
    },
  };

  return {
    ok: true,
    record: {
      id: recordId,
      kind: "runtime-preference-candidate",
      scope: input.scope,
      ...(projectRef ? { project_ref: projectRef } : {}),
      observed_at: input.observedAt,
      payload,
    },
  };
}
