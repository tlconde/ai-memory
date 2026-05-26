/**
 * Typed runtime semantic entity record contract (RUNTIME-15).
 *
 * Shared envelope types for projection, storage validation, and persistence.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import type { FormatterRegistryKind } from "./formatter-registry.js";

export type RuntimeFormatterRegistryKind = FormatterRegistryKind;

export interface RuntimeSemanticEntityRecord {
  id: string;
  kind: RuntimeFormatterRegistryKind;
  scope: ScopeKind;
  project_ref?: string;
  payload: unknown;
  observed_at?: string;
}

export interface RuntimeSemanticEntitySource {
  listEntities(): readonly RuntimeSemanticEntityRecord[];
}
