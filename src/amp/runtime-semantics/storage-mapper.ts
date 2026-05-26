/**
 * Runtime semantic entity row ↔ record mappers (RUNTIME-15).
 *
 * Shared conversion between storage rows and typed runtime semantic records.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import type { RuntimeSemanticEntityRow } from "../substrate/storage/runtime-semantic-entity.js";
import type {
  RuntimeFormatterRegistryKind,
  RuntimeSemanticEntityRecord,
} from "./entity-record.js";

export function recordToRow(record: RuntimeSemanticEntityRecord): RuntimeSemanticEntityRow {
  return {
    id: record.id,
    kind: record.kind,
    scope: record.scope,
    ...(record.project_ref ? { project_ref: record.project_ref } : {}),
    payload: record.payload,
    ...(record.observed_at ? { observed_at: record.observed_at } : {}),
  };
}

export function rowToRuntimeSemanticEntityRecord(
  row: RuntimeSemanticEntityRow,
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
