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
 * - provenance-validation: facade-only production gate for traceable writes.
 * - capture-facade (this module): single internal entry point for supported captures.
 */

import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  captureRuntimeCorrection,
  type CaptureRuntimeCorrectionFailureReason,
  type CaptureRuntimeCorrectionResult,
  type ExplicitRuntimeCorrectionCaptureInput,
  type RuntimeSemanticCaptureEntityWrite,
  type RuntimeSemanticCaptureEntityWriteFailureReason,
  type RuntimeSemanticCaptureEntityWriteResult,
  type CaptureRuntimeCorrectionDeps,
} from "./capture-correction.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import { validateRuntimeSemanticEntityWriteProvenance } from "./provenance-validation.js";
import { writeRuntimeSemanticEntity } from "./storage-writer.js";

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
  | { ok: true; recordId: string }
  | {
      ok: false;
      reason: RuntimeSemanticCaptureEntityWriteFailureReason;
      message: string;
    };

export type {
  CaptureRuntimeCorrectionFailureReason,
  CaptureRuntimeCorrectionResult,
  ExplicitRuntimeCorrectionCaptureInput,
  RuntimeSemanticCaptureEntityWriteFailureReason,
};

function writeRuntimeSemanticEntityWithFacadeContract(
  runtime: RuntimeStore,
  record: RuntimeSemanticEntityRecord,
  writeEntity: RuntimeSemanticCaptureEntityWrite,
): RuntimeSemanticCaptureEntityWriteResult {
  const provenanceValidation = validateRuntimeSemanticEntityWriteProvenance(record);
  if (!provenanceValidation.ok) {
    return provenanceValidation;
  }

  return writeEntity(runtime, record);
}

/** Create a capture facade bound to one {@link RuntimeStore} instance. */
export function createRuntimeSemanticCaptureFacade(
  runtime: RuntimeStore,
  deps: RuntimeSemanticCaptureFacadeDeps = {},
): RuntimeSemanticCaptureFacade {
  const writeEntity = deps.writeEntity ?? writeRuntimeSemanticEntity;
  const writeEntityWithFacadeContract = (
    runtime: RuntimeStore,
    record: RuntimeSemanticEntityRecord,
  ): RuntimeSemanticCaptureEntityWriteResult =>
    writeRuntimeSemanticEntityWithFacadeContract(runtime, record, writeEntity);

  return {
    captureExplicitCorrection(input) {
      return captureRuntimeCorrection(runtime, input, {
        writeEntity: writeEntityWithFacadeContract,
      });
    },
    writeValidatedEntity(record) {
      const writeResult = writeEntityWithFacadeContract(runtime, record);
      if (!writeResult.ok) {
        return writeResult;
      }
      return { ok: true, recordId: record.id };
    },
  };
}
