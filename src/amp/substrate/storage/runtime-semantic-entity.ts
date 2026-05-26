/**
 * Persisted typed runtime semantic entity row (RUNTIME-13).
 *
 * Storage-layer shape for {@link RuntimeStore} semantic entity table rows.
 * Parsing and projection policy live in runtime-semantics materialization.
 */

export interface RuntimeSemanticEntityRow {
  id: string;
  kind: string;
  scope: string;
  project_ref?: string;
  payload: unknown;
  observed_at?: string;
}
