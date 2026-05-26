/**
 * Storage-backed runtime semantic entity source adapter (RUNTIME-08).
 *
 * Falsifiable claim: typed runtime semantic records can be loaded from a
 * read-only storage reader and materialized via materializeRuntimeProjectionFromSource
 * without changing capture/consolidation behavior.
 *
 * Boundary ownership:
 * - RuntimeSemanticEntityReader: storage read boundary (records only, no parsing).
 * - RuntimeStoreSemanticEntityReader: production RuntimeStore adapter (RUNTIME-11).
 * - RuntimeSemanticStorageEntitySource: RuntimeSemanticEntitySource adapter.
 * - materializeRuntimeProjectionFromSource: parse, validate, and format records.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import type { RuntimeSemanticEntityRow } from "../substrate/storage/runtime-semantic-entity.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import type {
  RuntimeSemanticEntityRecord,
  RuntimeSemanticEntitySource,
  RuntimeFormatterRegistryKind,
} from "./projection-source.js";

/** Maps storage rows to projection records; materialization validates kind/scope/payload. */
function rowToRuntimeSemanticEntityRecord(
  row: RuntimeSemanticEntityRow
): RuntimeSemanticEntityRecord {
  return {
    id: row.id,
    kind: row.kind as RuntimeFormatterRegistryKind,
    scope: row.scope as ScopeKind,
    ...(row.project_ref ? { project_ref: row.project_ref } : {}),
    payload: row.payload,
    ...(row.observed_at ? { observed_at: row.observed_at } : {}),
  };
}

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
