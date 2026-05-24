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
