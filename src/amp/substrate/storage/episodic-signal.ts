/**
 * Typed episodic signal queued in the runtime store before consolidation.
 * Maps 1:1 to frame fields after consolidation (C7).
 */

import type { CurationMode, ScopeKind } from "../../core/frame-schema.js";
import type { ProvenanceBlock } from "../../core/frame-schema.js";

export interface EpisodicSignal {
  id: string;
  content: string;
  scope: ScopeKind;
  projectRef?: string;
  source: ProvenanceBlock;
  curationMode?: CurationMode;
}

export interface RuntimeQueueItem {
  id: string;
  kind: "episodic_signal";
  payload: EpisodicSignal;
  enqueued_at: string;
}
