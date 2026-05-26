/**
 * Storage-backed runtime semantic entity source adapter (RUNTIME-08).
 *
 * Read-path boundary: typed runtime semantic records load from RuntimeStore via
 * {@link RuntimeStoreSemanticEntityReader} and adapt to {@link RuntimeSemanticEntitySource}
 * for downstream projection materialization.
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
