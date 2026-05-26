/**
 * Explicit runtime preference-candidate capture into typed semantic storage.
 *
 * Falsifiable claim: preference candidates persist as runtime-preference-candidate rows
 * via the validated writer without touching the runtime queue or durable promotion.
 */

import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  mapCaptureRuntimePreferenceCandidateToEntityRecord,
  type CaptureRuntimePreferenceCandidateInput,
  type CaptureRuntimePreferenceCandidateMapFailureReason,
} from "./capture-preference-candidate-mapper.js";
import {
  type RuntimeSemanticCaptureEntityWrite,
  type RuntimeSemanticCaptureEntityWriteFailureReason,
  type RuntimeSemanticCaptureEntityWriteResult,
} from "./capture-correction.js";
import { writeRuntimeSemanticEntity } from "./storage-writer.js";

export type CaptureRuntimePreferenceCandidateFailureReason =
  | CaptureRuntimePreferenceCandidateMapFailureReason
  | RuntimeSemanticCaptureEntityWriteFailureReason;

export type CaptureRuntimePreferenceCandidateResult =
  | { ok: true; recordId: string }
  | {
      ok: false;
      reason: CaptureRuntimePreferenceCandidateFailureReason;
      message: string;
    };

export interface CaptureRuntimePreferenceCandidateDeps {
  writeEntity?: RuntimeSemanticCaptureEntityWrite;
}

/** Capture an explicit runtime preference candidate into typed semantic storage. */
export function captureRuntimePreferenceCandidate(
  runtime: RuntimeStore,
  input: CaptureRuntimePreferenceCandidateInput,
  deps: CaptureRuntimePreferenceCandidateDeps = {},
): CaptureRuntimePreferenceCandidateResult {
  const mapped = mapCaptureRuntimePreferenceCandidateToEntityRecord(input);
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

export type { CaptureRuntimePreferenceCandidateInput } from "./capture-preference-candidate-mapper.js";

export type {
  RuntimeSemanticCaptureEntityWrite,
  RuntimeSemanticCaptureEntityWriteFailureReason,
  RuntimeSemanticCaptureEntityWriteResult,
};
