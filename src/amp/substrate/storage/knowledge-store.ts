/**
 * Knowledge store substrate interface (SSA contract).
 *
 * Falsifiable claim: any SSA backend implements write/read/list with honest
 * capability coverage reporting.
 */

import type { CapabilityCoverage } from "../../adapter-contract/capability-coverage.js";
import type { Frame } from "../../core/frame-schema.js";

export interface KnowledgeStore {
  write(frames: Frame[]): void;
  read(id: string): Frame | undefined;
  list(filter?: KnowledgeListFilter): Frame[];
  capabilities(): CapabilityCoverage;
}

export interface KnowledgeListFilter {
  scopeKind?: Frame["scope"]["kind"];
  projectRef?: string;
  curationMode?: Frame["curation_mode"];
}

export function matchesKnowledgeListFilter(frame: Frame, filter: KnowledgeListFilter): boolean {
  if (filter.scopeKind && frame.scope.kind !== filter.scopeKind) return false;
  if (filter.projectRef && frame.scope.project_ref !== filter.projectRef) return false;
  if (filter.curationMode && frame.curation_mode !== filter.curationMode) return false;
  return true;
}
