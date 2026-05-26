/**
 * Storage-backed runtime semantic entity source adapter (RUNTIME-08).
 *
 * Falsifiable claim: typed runtime semantic records can be loaded from a
 * read-only storage reader and materialized via materializeRuntimeProjectionFromSource
 * without changing RuntimeStore persistence or capture/consolidation behavior.
 *
 * Boundary ownership:
 * - RuntimeSemanticEntityReader: storage read boundary (records only, no parsing).
 * - RuntimeStoreSemanticEntityReader: production RuntimeStore adapter (RUNTIME-11).
 * - RuntimeSemanticStorageEntitySource: RuntimeSemanticEntitySource adapter.
 * - materializeRuntimeProjectionFromSource: parse, validate, and format records.
 */

import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import type {
  RuntimeSemanticEntityRecord,
  RuntimeSemanticEntitySource,
} from "./projection-source.js";

/** Read-only storage boundary for typed runtime semantic entity records. Sync read only; async deferred to storage wiring. */
export interface RuntimeSemanticEntityReader {
  readEntities(): readonly RuntimeSemanticEntityRecord[];
}

/**
 * Production read-only adapter from {@link RuntimeStore} to {@link RuntimeSemanticEntityReader}.
 *
 * Storage seam only — not typed runtime persistence yet. RuntimeStore has no dedicated
 * typed semantic entity table; {@link readEntities} returns `[]` until schema migration
 * and writer APIs land. Raw `runtime_queue` rows are never interpreted as typed entities.
 */
export class RuntimeStoreSemanticEntityReader implements RuntimeSemanticEntityReader {
  constructor(private readonly runtime: RuntimeStore) {}

  readEntities(): readonly RuntimeSemanticEntityRecord[] {
    // Typed semantic entity table not wired yet; runtime is held for future reads only.
    return [];
  }
}

/** Adapts a storage reader into a RuntimeSemanticEntitySource for projection. */
export class RuntimeSemanticStorageEntitySource implements RuntimeSemanticEntitySource {
  constructor(private readonly reader: RuntimeSemanticEntityReader) {}

  listEntities(): readonly RuntimeSemanticEntityRecord[] {
    return this.reader.readEntities();
  }
}
