/**
 * Runtime semantic entity storage validation (RUNTIME-15).
 *
 * Falsifiable claim: invalid kind/payload/scope envelopes fail closed before
 * persistence without requiring storage I/O.
 *
 * Boundary ownership:
 * - schema.ts (Zod): payload-internal scope/project_ref symmetry.
 * - record-envelope-alignment: record envelope ↔ parsed payload alignment.
 * - storage-validation (this module): pre-persistence validation gate.
 * - storage-writer: duplicate-id checks and persistence after validation.
 */

import { ScopeKindSchema } from "../core/frame-schema.js";
import {
  isFormatterRegistryKind,
  parseRuntimeEntityAtBoundary,
  type FormatRuntimeEntityProjectionFailureReason,
} from "./formatter-registry.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import {
  extractPayloadScopeMetadata,
  validateRecordPayloadAlignment,
} from "./record-envelope-alignment.js";

export type RuntimeSemanticEntityWriteFailureReason =
  | FormatRuntimeEntityProjectionFailureReason
  | "invalid_scope"
  | "missing_record_project_ref"
  | "record_payload_scope_mismatch"
  | "record_payload_project_ref_mismatch"
  | "duplicate_id";

export type RuntimeSemanticEntityWriteResult =
  | { ok: true }
  | { ok: false; reason: RuntimeSemanticEntityWriteFailureReason; message: string };

/** Validate a typed runtime semantic record before persistence (RUNTIME-14). */
export function validateRuntimeSemanticEntityForStorage(
  record: RuntimeSemanticEntityRecord,
): RuntimeSemanticEntityWriteResult {
  const scopeResult = ScopeKindSchema.safeParse(record.scope);
  if (!scopeResult.success) {
    return {
      ok: false,
      reason: "invalid_scope",
      message: `Invalid record scope: ${record.scope}`,
    };
  }

  if (!isFormatterRegistryKind(record.kind)) {
    return {
      ok: false,
      reason: "unknown_kind",
      message: `Unknown formatter registry kind: ${record.kind}`,
    };
  }

  const parseResult = parseRuntimeEntityAtBoundary(record.kind, record.payload);
  if (!parseResult.success) {
    return {
      ok: false,
      reason: "invalid_input",
      message: parseResult.error,
    };
  }

  const payloadScope = extractPayloadScopeMetadata(record.kind, parseResult.value);
  const alignmentSkip = validateRecordPayloadAlignment(record, payloadScope);
  if (alignmentSkip !== undefined) {
    return {
      ok: false,
      reason: alignmentSkip.reason,
      message: alignmentSkip.message,
    };
  }

  return { ok: true };
}
