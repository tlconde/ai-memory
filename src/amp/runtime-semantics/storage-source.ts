/**
 * Storage-backed runtime semantic entity source adapter (RUNTIME-08).
 *
 * Falsifiable claim: typed runtime semantic records can be loaded from a
 * read-only storage reader and materialized via materializeRuntimeProjectionFromSource
 * without changing RuntimeStore persistence or capture/consolidation behavior.
 *
 * Boundary ownership:
 * - RuntimeSemanticEntityReader: storage read boundary (records only, no parsing).
 * - RuntimeSemanticStorageEntitySource: RuntimeSemanticEntitySource adapter.
 * - materializeRuntimeProjectionFromSource: parse, validate, and format records.
 */

import type {
  RuntimeSemanticEntityRecord,
  RuntimeSemanticEntitySource,
} from "./projection-source.js";

/** Read-only storage boundary for typed runtime semantic entity records. Sync read only; async deferred to storage wiring. */
export interface RuntimeSemanticEntityReader {
  readEntities(): readonly RuntimeSemanticEntityRecord[];
}

/** Adapts a storage reader into a RuntimeSemanticEntitySource for projection. */
export class RuntimeSemanticStorageEntitySource implements RuntimeSemanticEntitySource {
  constructor(private readonly reader: RuntimeSemanticEntityReader) {}

  listEntities(): readonly RuntimeSemanticEntityRecord[] {
    return this.reader.readEntities();
  }
}
