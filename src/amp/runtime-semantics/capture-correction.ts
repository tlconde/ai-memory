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
import { writeRuntimeSemanticEntity } from "./storage-writer.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import type { RuntimeSemanticEntityProvenanceFailureReason } from "./provenance-validation.js";
import type { RuntimeSemanticEntityWriteFailureReason } from "./storage-validation.js";

export type RuntimeSemanticCaptureEntityWriteFailureReason =
  | RuntimeSemanticEntityWriteFailureReason
  | RuntimeSemanticEntityProvenanceFailureReason;

export type RuntimeSemanticCaptureEntityWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: RuntimeSemanticCaptureEntityWriteFailureReason;
      message: string;
    };

export type RuntimeSemanticCaptureEntityWrite = (
  runtime: RuntimeStore,
  record: RuntimeSemanticEntityRecord,
) => RuntimeSemanticCaptureEntityWriteResult;

export type CaptureRuntimeCorrectionFailureReason =
  | ExplicitRuntimeCorrectionMapFailureReason
  | RuntimeSemanticCaptureEntityWriteFailureReason;

export type CaptureRuntimeCorrectionResult =
  | { ok: true; recordId: string }
  | { ok: false; reason: CaptureRuntimeCorrectionFailureReason; message: string };

export interface CaptureRuntimeCorrectionDeps {
  writeEntity?: RuntimeSemanticCaptureEntityWrite;
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
  const writeResult = writeEntity(runtime, mapped.record);
  if (!writeResult.ok) {
    return writeResult;
  }
  return { ok: true, recordId: mapped.record.id };
}

export type {
  ExplicitCorrectionSourceSurface,
  ExplicitRuntimeCorrectionCaptureInput,
  ExplicitRuntimeCorrectionCaptureProvenance,
} from "./capture-correction-mapper.js";
