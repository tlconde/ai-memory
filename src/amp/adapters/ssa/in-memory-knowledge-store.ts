/**
 * In-memory knowledge store adapter for the vertical slice (C2).
 *
 * Falsifiable claim: frames write/read/list with honest capability coverage.
 */

import {
  createSliceCapabilityCoverage,
  type CapabilityCoverage,
} from "../../adapter-contract/capability-coverage.js";
import { frameSchemaMismatch } from "../../core/errors.js";
import type { Frame } from "../../core/frame-schema.js";
import { parseFrame } from "../../core/frame-schema.js";
import {
  matchesKnowledgeListFilter,
  type KnowledgeListFilter,
  type KnowledgeStore,
} from "../../substrate/storage/knowledge-store.js";

export type { KnowledgeListFilter, KnowledgeStore };

export class InMemoryKnowledgeStore implements KnowledgeStore {
  private readonly frames = new Map<string, Frame>();
  private readonly coverage: CapabilityCoverage;

  constructor(coverage: CapabilityCoverage = createSliceCapabilityCoverage()) {
    this.coverage = coverage;
  }

  write(frames: Frame[]): void {
    for (const candidate of frames) {
      const parsed = parseFrame(candidate);
      if (!parsed.success) {
        throw frameSchemaMismatch(parsed.error);
      }
      this.frames.set(parsed.frame.id, parsed.frame);
    }
  }

  read(id: string): Frame | undefined {
    return this.frames.get(id);
  }

  list(filter: KnowledgeListFilter = {}): Frame[] {
    return [...this.frames.values()].filter((frame) => matchesKnowledgeListFilter(frame, filter));
  }

  capabilities(): CapabilityCoverage {
    return structuredClone(this.coverage);
  }
}
