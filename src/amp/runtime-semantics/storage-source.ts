/**
 * Storage-backed runtime semantic entity source adapter (RUNTIME-08).
 *
 * Falsifiable claim: typed runtime semantic records can be loaded from a
 * read-only storage reader and materialized via materializeRuntimeProjectionFromSource
 * without changing capture/consolidation behavior.
 *
 * Boundary ownership:
 * - RuntimeSemanticEntityReader: storage read boundary (records only, no parsing).
 * - RuntimeStoreSemanticEntityReader: production RuntimeStore read adapter (RUNTIME-11).
 * - RuntimeStoreSemanticEntityWriter: validated write adapter (RUNTIME-14; see storage-writer.ts).
 * - RuntimeSemanticStorageEntitySource: RuntimeSemanticEntitySource adapter.
 * - materializeRuntimeProjectionFromSource: parse, validate, and format records.
 */

import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import type {
  RuntimeSemanticEntityRecord,
  RuntimeSemanticEntitySource,
} from "./entity-record.js";
import { rowToRuntimeSemanticEntityRecord } from "./storage-mapper.js";

/** Read-only storage boundary for typed runtime semantic entity records. Sync read only; async deferred to storage wiring. */
export interface RuntimeSemanticEntityReader {
  readEntities(): readonly RuntimeSemanticEntityRecord[];
}

/**
 * Production read-only adapter from {@link RuntimeStore} to {@link RuntimeSemanticEntityReader}.
 *
 * Reads typed rows from `runtime_semantic_entity` in insertion order. Empty table yields `[]`
 * (queue-only projection output). Raw `runtime_queue` rows are never interpreted here.
 */
export class RuntimeStoreSemanticEntityReader implements RuntimeSemanticEntityReader {
  constructor(private readonly runtime: RuntimeStore) {}

  readEntities(): readonly RuntimeSemanticEntityRecord[] {
    return this.runtime.semanticEntityList().map(rowToRuntimeSemanticEntityRecord);
  }
}

/** Adapts a storage reader into a RuntimeSemanticEntitySource for projection. */
export class RuntimeSemanticStorageEntitySource implements RuntimeSemanticEntitySource {
  constructor(private readonly reader: RuntimeSemanticEntityReader) {}

  listEntities(): readonly RuntimeSemanticEntityRecord[] {
    return this.reader.readEntities();
  }
}
