/**
 * Validated typed runtime semantic entity writer (RUNTIME-14).
 *
 * Falsifiable claim: invalid kind/payload/scope envelopes fail closed before
 * `runtime_semantic_entity` persistence; valid rows round-trip through the default
 * local projection reader path.
 *
 * Boundary ownership:
 * - storage-validation: registry parse + envelope alignment.
 * - RuntimeStoreSemanticEntityWriter: preferred production write path.
 * - RuntimeStore.semanticEntityInsert: low-level append only (call after validation).
 */

import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import { recordToRow } from "./storage-mapper.js";
import {
  validateRuntimeSemanticEntityForStorage,
  type RuntimeSemanticEntityWriteResult,
} from "./storage-validation.js";

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

/** Preferred write boundary for typed runtime semantic entities. */
export class RuntimeStoreSemanticEntityWriter {
  constructor(private readonly runtime: RuntimeStore) {}

  write(record: RuntimeSemanticEntityRecord): RuntimeSemanticEntityWriteResult {
    const validation = validateRuntimeSemanticEntityForStorage(record);
    if (!validation.ok) {
      return validation;
    }

    if (this.runtime.semanticEntityHas(record.id)) {
      return {
        ok: false,
        reason: "duplicate_id",
        message: `Duplicate runtime semantic entity id: ${record.id}`,
      };
    }

    try {
      this.runtime.semanticEntityInsert(recordToRow(record));
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return {
          ok: false,
          reason: "duplicate_id",
          message: `Duplicate runtime semantic entity id: ${record.id}`,
        };
      }
      throw error;
    }
    return { ok: true };
  }
}

/** Write a validated typed runtime semantic entity to {@link RuntimeStore}. */
export function writeRuntimeSemanticEntity(
  runtime: RuntimeStore,
  record: RuntimeSemanticEntityRecord
): RuntimeSemanticEntityWriteResult {
  return new RuntimeStoreSemanticEntityWriter(runtime).write(record);
}
