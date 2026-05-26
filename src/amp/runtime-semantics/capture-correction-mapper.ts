/**
 * Pure mapper from explicit operator correction capture input to typed runtime entities (RUNTIME-23).
 *
 * Falsifiable claim: explicit correction input becomes an episodic-frame record with
 * event_type "correction" without queue or storage side effects.
 *
 * Entity choice: no dedicated RuntimeCorrectionCandidate schema exists. Corrections are
 * represented as EpisodicFrame rows with event_type "correction", matching existing
 * runtime semantics and projection formatting.
 */

import { createHash } from "node:crypto";

import type { ScopeKind } from "../core/frame-schema.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import type { EpisodicFrame, EpisodicVisibility } from "./schema.js";

/** Default typed record id prefix for one explicit correction per target entity. */
export const EXPLICIT_CORRECTION_DEFAULT_RECORD_ID_PREFIX = "explicit-correction:";

export const EXPLICIT_CORRECTION_CAPTURE_PATH = "explicit_operator_correction";

export const EXPLICIT_CORRECTION_CLI_SOURCE_COMMAND = "amp runtime correct";

/** Supported explicit correction capture surfaces (stored in payload details). */
export type ExplicitCorrectionSourceSurface = "cli" | "test" | "future_capture";

export interface ExplicitRuntimeCorrectionCaptureProvenance {
  sourceSurface: ExplicitCorrectionSourceSurface;
  sourceCommand?: string;
}

/** Stable CLI provenance marker for `amp runtime correct`. */
export const EXPLICIT_CORRECTION_CLI_PROVENANCE: ExplicitRuntimeCorrectionCaptureProvenance = {
  sourceSurface: "cli",
  sourceCommand: EXPLICIT_CORRECTION_CLI_SOURCE_COMMAND,
};

/** Stable test provenance marker for runtime-semantics unit/integration tests. */
export const EXPLICIT_CORRECTION_TEST_PROVENANCE: ExplicitRuntimeCorrectionCaptureProvenance = {
  sourceSurface: "test",
  sourceCommand: "runtime-semantics.test",
};

export interface ExplicitRuntimeCorrectionCaptureInput {
  /** Runtime semantic entity id being corrected. */
  targetEntityId: string;
  /** Id for the persisted episodic-frame correction record. */
  recordId: string;
  /** Operator note describing the correction intent. */
  note: string;
  scope: ScopeKind;
  projectRef?: string;
  occurredAt: string;
  recordedAt: string;
  /** External signal ids for consolidation correlation (preferred over operator-note ids). */
  sourceSignalIds?: readonly string[];
  /** Deterministic capture provenance (surface, command). */
  provenance: ExplicitRuntimeCorrectionCaptureProvenance;
}

export type ExplicitRuntimeCorrectionMapFailureReason =
  | "invalid_note"
  | "missing_project_ref";

export type ExplicitRuntimeCorrectionMapResult =
  | { ok: true; record: RuntimeSemanticEntityRecord }
  | {
      ok: false;
      reason: ExplicitRuntimeCorrectionMapFailureReason;
      message: string;
    };

function visibilityForScope(scope: ScopeKind): EpisodicVisibility {
  switch (scope) {
    case "user":
      return "user_private";
    case "project":
      return "project_only";
    case "universal":
      return "shared_candidate";
    default: {
      const _exhaustive: never = scope;
      throw new Error(`Unhandled scope: ${String(_exhaustive)}`);
    }
  }
}

/** Stable transform_id marker for explicit correction capture provenance. */
export function explicitCorrectionTransformId(
  sourceSurface: ExplicitCorrectionSourceSurface,
): string {
  return `explicit-correction:${sourceSurface}`;
}

function buildExplicitCorrectionDetails(
  input: ExplicitRuntimeCorrectionCaptureInput,
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    target_entity_id: input.targetEntityId,
    correction_of: input.targetEntityId,
    capture_path: EXPLICIT_CORRECTION_CAPTURE_PATH,
    source_surface: input.provenance.sourceSurface,
  };

  if (input.provenance.sourceCommand) {
    details.source_command = input.provenance.sourceCommand;
  }

  return details;
}

/** Map explicit correction capture input to a typed runtime semantic entity record. */
export function mapExplicitRuntimeCorrectionToEntityRecord(
  input: ExplicitRuntimeCorrectionCaptureInput,
): ExplicitRuntimeCorrectionMapResult {
  const note = input.note.trim();
  if (note.length === 0) {
    return {
      ok: false,
      reason: "invalid_note",
      message: "Correction note must be a non-empty string.",
    };
  }

  if (input.scope === "project" && !input.projectRef?.trim()) {
    return {
      ok: false,
      reason: "missing_project_ref",
      message: "Project-scoped corrections require project_ref.",
    };
  }

  const projectRef = input.projectRef?.trim();
  const payload: EpisodicFrame = {
    id: input.recordId,
    event_type: "correction",
    summary: note,
    details: buildExplicitCorrectionDetails(input),
    tags: [],
    scope: input.scope,
    ...(projectRef ? { project_ref: projectRef } : {}),
    curation_mode: "personal",
    occurred_at: input.occurredAt,
    recorded_at: input.recordedAt,
    source_signals: [...(input.sourceSignalIds ?? [])],
    related_entities: {},
    evidence_refs: [],
    provenance: {
      transform_id: explicitCorrectionTransformId(input.provenance.sourceSurface),
    },
    confidence: "high",
    source: "user_explicit",
    sensitivity: "normal",
    visibility: visibilityForScope(input.scope),
    pinned: false,
    lifecycle_state: "active",
  };

  return {
    ok: true,
    record: {
      id: input.recordId,
      kind: "episodic-frame",
      scope: input.scope,
      ...(projectRef ? { project_ref: projectRef } : {}),
      observed_at: input.occurredAt,
      payload,
    },
  };
}

/** Derive a stable ISO timestamp from capture inputs when callers omit explicit times. */
export function deterministicCorrectionTimestamp(key: string): string {
  const digest = createHash("sha256").update(key).digest();
  const offsetMs = digest.readUInt32BE(0) % 86_400_000;
  return new Date(Date.parse("2026-01-01T00:00:00.000Z") + offsetMs).toISOString();
}

/** Default typed record id for one explicit correction per target entity. */
export function defaultExplicitCorrectionRecordId(targetEntityId: string): string {
  return `${EXPLICIT_CORRECTION_DEFAULT_RECORD_ID_PREFIX}${targetEntityId}`;
}
