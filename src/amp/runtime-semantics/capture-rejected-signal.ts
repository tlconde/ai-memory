/**
 * Rejected runtime capture audit persistence (RUNTIME-06).
 *
 * Falsifiable claim: excluded capture signals persist only as rejected-signal-log
 * audit rows through the validated writer without queue or projection side effects.
 */

import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  evaluateRuntimeCaptureExclusionFilter,
  type RuntimeCaptureAcceptedSignal,
  type RuntimeCaptureExclusionFilterResult,
  type RuntimeCaptureRejectionReasonCode,
  type RuntimeCaptureSignalInput,
} from "./capture-exclusion-filter.js";
import {
  defaultRejectedSignalRecordId,
  mapRejectedRuntimeCaptureToEntityRecord,
  type RuntimeRejectedCaptureInput,
  type RuntimeRejectedCaptureMapFailureReason,
} from "./capture-rejected-signal-mapper.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import {
  type RuntimeSemanticCaptureEntityWrite,
  type RuntimeSemanticCaptureEntityWriteFailureReason,
  type RuntimeSemanticCaptureEntityWriteResult,
} from "./capture-correction.js";
import { writeRuntimeSemanticEntity } from "./storage-writer.js";

export type CaptureRejectedRuntimeSignalFailureReason =
  | RuntimeRejectedCaptureMapFailureReason
  | RuntimeSemanticCaptureEntityWriteFailureReason;

export type CaptureRejectedRuntimeSignalResult =
  | { ok: true; recordId: string }
  | { ok: false; reason: CaptureRejectedRuntimeSignalFailureReason; message: string };

export interface CaptureRejectedRuntimeSignalDeps {
  writeEntity?: RuntimeSemanticCaptureEntityWrite;
}

/** Persist one rejected capture audit row from precomputed audit metadata. */
export function captureRejectedRuntimeSignal(
  runtime: RuntimeStore,
  input: RuntimeRejectedCaptureInput,
  deps: CaptureRejectedRuntimeSignalDeps = {},
): CaptureRejectedRuntimeSignalResult {
  const mapped = mapRejectedRuntimeCaptureToEntityRecord(input);
  if (!mapped.ok) {
    return mapped;
  }

  const writeEntity = deps.writeEntity ?? writeRuntimeSemanticEntity;
  const writeResult = writeEntity(runtime, mapped.record);
  if (!writeResult.ok) {
    return writeResult;
  }

  return { ok: true, recordId: mapped.record.id };
}

export type FilteredRuntimeCaptureResult =
  | { ok: true; accepted: RuntimeCaptureAcceptedSignal }
  | {
      ok: false;
      rejected: true;
      recordId: string;
      reason_code: RuntimeCaptureRejectionReasonCode;
    }
  | {
      ok: false;
      rejected: false;
      reason: CaptureRejectedRuntimeSignalFailureReason;
      message: string;
    };

export interface FilteredRuntimeCaptureInput extends RuntimeCaptureSignalInput {
  recordId?: string;
  rejectedSignalId?: string;
  timestamp: string;
}

export type FilteredRuntimeCaptureDeps = CaptureRejectedRuntimeSignalDeps;

function rejectionIdsFromAudit(
  input: FilteredRuntimeCaptureInput,
  filterResult: Extract<RuntimeCaptureExclusionFilterResult, { ok: false }>,
): { recordId: string; rejectedSignalId: string } {
  const rejectedSignalId =
    input.rejectedSignalId ??
    `capture-reject:${filterResult.rejected.source_hash.slice("sha256:".length, "sha256:".length + 12)}`;
  const recordId = input.recordId ?? defaultRejectedSignalRecordId(rejectedSignalId);
  return { recordId, rejectedSignalId };
}

/**
 * Evaluate capture exclusion and persist a rejected-signal-log audit row when excluded.
 *
 * Narrow writer path only — does not persist accepted signals automatically.
 */
export function filterAndCaptureRejectedRuntimeSignal(
  runtime: RuntimeStore,
  input: FilteredRuntimeCaptureInput,
  deps: FilteredRuntimeCaptureDeps = {},
): FilteredRuntimeCaptureResult {
  const filterResult = evaluateRuntimeCaptureExclusionFilter(input);
  if (filterResult.ok) {
    return { ok: true, accepted: filterResult.accepted };
  }

  const { recordId, rejectedSignalId } = rejectionIdsFromAudit(input, filterResult);
  const captureResult = captureRejectedRuntimeSignal(
    runtime,
    {
      recordId,
      rejectedSignalId,
      timestamp: input.timestamp,
      reasonCode: filterResult.rejected.reason_code,
      sourceSurface: filterResult.rejected.source_surface,
      scope: filterResult.rejected.scope,
      projectRef: filterResult.rejected.project_ref,
      sourceHash: filterResult.rejected.source_hash,
      redactedExcerpt: filterResult.rejected.redacted_excerpt,
    },
    deps,
  );

  if (!captureResult.ok) {
    return {
      ok: false,
      rejected: false,
      reason: captureResult.reason,
      message: captureResult.message,
    };
  }

  return {
    ok: false,
    rejected: true,
    recordId: captureResult.recordId,
    reason_code: filterResult.rejected.reason_code,
  };
}

export type {
  RuntimeCaptureAcceptedSignal,
  RuntimeCaptureExclusionFilterResult,
  RuntimeCaptureExclusionHint,
  RuntimeCaptureRejectionAudit,
  RuntimeCaptureRejectionReasonCode,
  RuntimeCaptureSignalInput,
} from "./capture-exclusion-filter.js";

export type { RuntimeRejectedCaptureInput } from "./capture-rejected-signal-mapper.js";
