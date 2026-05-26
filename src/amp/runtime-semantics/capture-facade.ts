/**
 * Runtime semantic capture facade (RUNTIME-26).
 *
 * Falsifiable claim: future capture/consolidation code persists typed runtime
 * entities only through validated write paths, without importing CLI, projection,
 * or gbrain adapters.
 *
 * Boundary ownership:
 * - capture-correction: explicit correction mapping + validated write.
 * - storage-writer: generic validated typed entity write.
 * - capture-facade (this module): single internal entry point for supported captures.
 */

import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  captureRuntimeCorrection,
  type CaptureRuntimeCorrectionFailureReason,
  type CaptureRuntimeCorrectionResult,
  type ExplicitRuntimeCorrectionCaptureInput,
} from "./capture-correction.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import {
  writeRuntimeSemanticEntity,
  writeRuntimeSemanticEntityWithRecordId,
} from "./storage-writer.js";
import type { CaptureRuntimeCorrectionDeps } from "./capture-correction.js";

export interface RuntimeSemanticCaptureFacadeDeps extends CaptureRuntimeCorrectionDeps {}

export interface RuntimeSemanticCaptureFacade {
  captureExplicitCorrection(
    input: ExplicitRuntimeCorrectionCaptureInput,
  ): CaptureRuntimeCorrectionResult;
  writeValidatedEntity(
    record: RuntimeSemanticEntityRecord,
  ): RuntimeSemanticCaptureWriteResult;
}

export type RuntimeSemanticCaptureWriteResult =
  import("./storage-writer.js").RuntimeSemanticEntityWriteWithIdResult;

export type {
  CaptureRuntimeCorrectionFailureReason,
  CaptureRuntimeCorrectionResult,
  ExplicitRuntimeCorrectionCaptureInput,
};

/** Create a capture facade bound to one {@link RuntimeStore} instance. */
export function createRuntimeSemanticCaptureFacade(
  runtime: RuntimeStore,
  deps: RuntimeSemanticCaptureFacadeDeps = {},
): RuntimeSemanticCaptureFacade {
  const writeEntity = deps.writeEntity ?? writeRuntimeSemanticEntity;

  return {
    captureExplicitCorrection(input) {
      return captureRuntimeCorrection(runtime, input, { writeEntity });
    },
    writeValidatedEntity(record) {
      return writeRuntimeSemanticEntityWithRecordId(runtime, record, writeEntity);
    },
  };
}
