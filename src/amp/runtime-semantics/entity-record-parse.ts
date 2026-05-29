/**
 * Canonical unknown-input parsing for runtime semantic entity records (RUNTIME-17).
 *
 * Falsifiable claim: JSON ingress validates envelope shape, then delegates semantic
 * checks to storage validation without persistence.
 *
 * Boundary ownership:
 * - entity-record-parse (this module): envelope shape + orchestration.
 * - storage-validation: semantic validation gate (kind, scope, payload, alignment).
 * - storage-writer: duplicate-id checks and persistence after validation.
 */

import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import {
  validateRuntimeSemanticEntityForStorage,
  type RuntimeSemanticEntityWriteFailureReason,
} from "./storage-validation.js";

export type RuntimeSemanticEntityRecordParseFailureReason =
  | "invalid_record_shape"
  | RuntimeSemanticEntityWriteFailureReason;

export type RuntimeSemanticEntityRecordParseResult =
  | { ok: true; record: RuntimeSemanticEntityRecord }
  | {
      ok: false;
      reason: RuntimeSemanticEntityRecordParseFailureReason;
      message: string;
      id?: string;
    };

type EnvelopeParseResult =
  | { ok: true; record: RuntimeSemanticEntityRecord }
  | {
      ok: false;
      reason: "invalid_record_shape";
      message: string;
      id?: string;
    };

/** Best-effort record id for batch failure reporting when envelope parse fails early. */
export function runtimeSemanticEntityRecordIdFromUnknown(
  value: unknown,
  index?: number,
): string {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  ) {
    return (value as { id: string }).id;
  }
  return index === undefined ? "unknown" : `record[${index}]`;
}

function parseRuntimeSemanticEntityRecordEnvelope(
  value: unknown,
): EnvelopeParseResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      reason: "invalid_record_shape",
      message: "Record must be a non-null object.",
    };
  }

  const candidate = value as Record<string, unknown>;
  const id = candidate.id;

  if (typeof id !== "string" || id.length === 0) {
    return {
      ok: false,
      reason: "invalid_record_shape",
      message: "Record id must be a non-empty string.",
      ...(typeof id === "string" ? { id } : {}),
    };
  }

  if (typeof candidate.kind !== "string") {
    return {
      ok: false,
      reason: "invalid_record_shape",
      message: "Record kind must be a string.",
      id,
    };
  }

  if (typeof candidate.scope !== "string") {
    return {
      ok: false,
      reason: "invalid_record_shape",
      message: "Record scope must be a string.",
      id,
    };
  }

  if (!("payload" in candidate)) {
    return {
      ok: false,
      reason: "invalid_record_shape",
      message: "Record must include a payload field.",
      id,
    };
  }

  if (candidate.project_ref !== undefined && typeof candidate.project_ref !== "string") {
    return {
      ok: false,
      reason: "invalid_record_shape",
      message: "Record project_ref must be a string when provided.",
      id,
    };
  }

  if (candidate.observed_at !== undefined && typeof candidate.observed_at !== "string") {
    return {
      ok: false,
      reason: "invalid_record_shape",
      message: "Record observed_at must be a string when provided.",
      id,
    };
  }

  if (
    candidate.graduation_status !== undefined &&
    candidate.graduation_status !== "graduated"
  ) {
    return {
      ok: false,
      reason: "invalid_record_shape",
      message: 'Record graduation_status must be "graduated" when provided.',
      id,
    };
  }

  if (candidate.graduated_at !== undefined && typeof candidate.graduated_at !== "string") {
    return {
      ok: false,
      reason: "invalid_record_shape",
      message: "Record graduated_at must be a string when provided.",
      id,
    };
  }

  const record: RuntimeSemanticEntityRecord = {
    id,
    kind: candidate.kind as RuntimeSemanticEntityRecord["kind"],
    scope: candidate.scope as RuntimeSemanticEntityRecord["scope"],
    payload: candidate.payload,
    ...(typeof candidate.project_ref === "string"
      ? { project_ref: candidate.project_ref }
      : {}),
    ...(typeof candidate.observed_at === "string"
      ? { observed_at: candidate.observed_at }
      : {}),
    ...(candidate.graduation_status === "graduated"
      ? { graduation_status: "graduated" as const }
      : {}),
    ...(typeof candidate.graduated_at === "string"
      ? { graduated_at: candidate.graduated_at }
      : {}),
  };

  return { ok: true, record };
}

/** Parse unknown input into a runtime semantic entity record without throwing. */
export function safeParseRuntimeSemanticEntityRecordFromUnknown(
  value: unknown,
): RuntimeSemanticEntityRecordParseResult {
  const envelope = parseRuntimeSemanticEntityRecordEnvelope(value);
  if (!envelope.ok) {
    return envelope;
  }

  const semantic = validateRuntimeSemanticEntityForStorage(envelope.record);
  if (!semantic.ok) {
    return {
      ok: false,
      reason: semantic.reason,
      message: semantic.message,
      id: envelope.record.id,
    };
  }

  return { ok: true, record: envelope.record };
}

/** Parse unknown input into a runtime semantic entity record; throws on failure. */
export function parseRuntimeSemanticEntityRecordFromUnknown(
  value: unknown,
): RuntimeSemanticEntityRecord {
  const result = safeParseRuntimeSemanticEntityRecordFromUnknown(value);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.record;
}
