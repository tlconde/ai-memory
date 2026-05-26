/**
 * Explicit correction capture into typed runtime semantic storage (RUNTIME-23).
 *
 * Falsifiable claim: operator corrections persist as episodic-frame entities via
 * writeRuntimeSemanticEntity without touching the runtime queue.
 */

import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  mapExplicitRuntimeCorrectionToEntityRecord,
  type ExplicitRuntimeCorrectionCaptureInput,
  type ExplicitRuntimeCorrectionMapFailureReason,
} from "./capture-correction-mapper.js";
import {
  writeRuntimeSemanticEntity,
  writeRuntimeSemanticEntityWithRecordId,
} from "./storage-writer.js";
import type { RuntimeSemanticEntityWriteFailureReason } from "./storage-validation.js";

export type CaptureRuntimeCorrectionFailureReason =
  | ExplicitRuntimeCorrectionMapFailureReason
  | RuntimeSemanticEntityWriteFailureReason;

export type CaptureRuntimeCorrectionResult =
  | { ok: true; recordId: string }
  | { ok: false; reason: CaptureRuntimeCorrectionFailureReason; message: string };

export interface CaptureRuntimeCorrectionDeps {
  writeEntity?: typeof writeRuntimeSemanticEntity;
}

/** Capture an explicit operator correction into typed runtime semantic storage. */
export function captureRuntimeCorrection(
  runtime: RuntimeStore,
  input: ExplicitRuntimeCorrectionCaptureInput,
  deps: CaptureRuntimeCorrectionDeps = {},
): CaptureRuntimeCorrectionResult {
  const mapped = mapExplicitRuntimeCorrectionToEntityRecord(input);
  if (!mapped.ok) {
    return mapped;
  }

  const writeEntity = deps.writeEntity ?? writeRuntimeSemanticEntity;
  return writeRuntimeSemanticEntityWithRecordId(runtime, mapped.record, writeEntity);
}

export type {
  ExplicitCorrectionSourceSurface,
  ExplicitRuntimeCorrectionCaptureInput,
  ExplicitRuntimeCorrectionCaptureProvenance,
} from "./capture-correction-mapper.js";
