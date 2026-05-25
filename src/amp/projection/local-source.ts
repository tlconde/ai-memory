/**
 * Offline local projection source backed by RuntimeStore + KnowledgeStore.
 *
 * Falsifiable claim: durable knowledge frames and runtime queue items render
 * into four projection documents without live gbrain or filesystem writes.
 */

import type { KnowledgeStore } from "../substrate/storage/knowledge-store.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { buildProjectionDocuments } from "./build-documents.js";
import type { ProjectionDocument } from "./schema.js";
import type { ProjectionSource, ProjectionSourceLoadOptions } from "./source.js";

export interface LocalProjectionSourceOptions {
  knowledge: KnowledgeStore;
  runtime: RuntimeStore;
  projectRef?: string;
  generatedAt?: string;
}

export type { ProjectionStoreKind } from "./build-documents.js";
export {
  isDurableProjectionFrame,
  resolveProjectionSectionKey,
} from "./build-documents.js";

/** Offline projection source that reads local runtime and knowledge stores. */
export class LocalProjectionSource implements ProjectionSource {
  readonly sourceKind = "local" as const;
  readonly supportsApply = true;

  constructor(private readonly options: LocalProjectionSourceOptions) {}

  loadProjectionDocuments(options: ProjectionSourceLoadOptions = {}): ProjectionDocument[] {
    const projectRef = options.projectRef ?? this.options.projectRef ?? "project";

    return buildProjectionDocuments({
      frames: this.options.knowledge.list(),
      runtimeItems: this.options.runtime.queueList(),
      projectRef,
      generatedAt: this.options.generatedAt,
      revisionPrefix: "local",
    });
  }
}
