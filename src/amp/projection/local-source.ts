/**
 * Offline local projection source backed by RuntimeStore + KnowledgeStore.
 *
 * Falsifiable claim: durable knowledge frames and runtime queue items render
 * into four projection documents without live gbrain or filesystem writes.
 */

import type { Frame, ScopeKind } from "../core/frame-schema.js";
import type { KnowledgeStore } from "../substrate/storage/knowledge-store.js";
import type { RuntimeQueueItem } from "../substrate/storage/episodic-signal.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { PROJECTION_FILE_KINDS } from "./constants.js";
import {
  createEmptyProjectionContentModel,
  estimateProjectionTextTokens,
  renderProjectionContentModel,
  sortProjectionTextBlocks,
  sumSectionTokenEstimate,
  type ProjectionContentModel,
  type ProjectionContentSectionKey,
  type ProjectionTextBlock,
} from "./content.js";
import { createProjectionDocument, type ProjectionDocument } from "./schema.js";
import type { ProjectionSource, ProjectionSourceLoadOptions } from "./source.js";

export interface LocalProjectionSourceOptions {
  knowledge: KnowledgeStore;
  runtime: RuntimeStore;
  projectRef?: string;
  generatedAt?: string;
}

const PROJECTION_KIND_TO_SECTION: Record<
  (typeof PROJECTION_FILE_KINDS)[number],
  ProjectionContentSectionKey
> = {
  global_projection: "globalProjection",
  global_runtime: "globalRuntime",
  project_projection: "projectProjection",
  project_runtime: "projectRuntime",
};

function frameToText(frame: Frame): string {
  return typeof frame.content === "string" ? frame.content : JSON.stringify(frame.content);
}

function isDurableProjectionFrame(frame: Frame): boolean {
  return frame.kind === "semantic" || frame.kind === "crystal";
}

export type ProjectionStoreKind = "projection" | "runtime";

function resolveProjectionSectionKey(
  scopeKind: ScopeKind,
  projectRef: string,
  scopeProjectRef: string | undefined,
  storeKind: ProjectionStoreKind
): ProjectionContentSectionKey | undefined {
  if (scopeKind === "project") {
    if (scopeProjectRef !== projectRef) {
      return undefined;
    }
    return storeKind === "projection" ? "projectProjection" : "projectRuntime";
  }
  if (scopeKind === "user" || scopeKind === "universal") {
    return storeKind === "projection" ? "globalProjection" : "globalRuntime";
  }
  return undefined;
}

function frameSectionKey(frame: Frame, projectRef: string): ProjectionContentSectionKey | undefined {
  return resolveProjectionSectionKey(
    frame.scope.kind,
    projectRef,
    frame.scope.project_ref,
    "projection"
  );
}

function runtimeSectionKey(
  item: RuntimeQueueItem,
  projectRef: string
): ProjectionContentSectionKey | undefined {
  const signal = item.payload;
  return resolveProjectionSectionKey(signal.scope, projectRef, signal.projectRef, "runtime");
}

function frameToBlock(frame: Frame, priority: number): ProjectionTextBlock {
  const text = frameToText(frame);
  return {
    id: frame.id,
    label: frame.kind,
    priority,
    tokenEstimate: estimateProjectionTextTokens(text),
    text,
  };
}

function runtimeItemToBlock(item: RuntimeQueueItem, priority: number): ProjectionTextBlock {
  const text = item.payload.content;
  return {
    id: item.id,
    label: item.kind,
    priority,
    tokenEstimate: estimateProjectionTextTokens(text),
    text,
  };
}

function appendBlock(model: ProjectionContentModel, sectionKey: ProjectionContentSectionKey, block: ProjectionTextBlock): void {
  model[sectionKey].blocks.push(block);
}

function computeSourceRevision(section: ProjectionContentModel[ProjectionContentSectionKey]): string {
  const ids = sortProjectionTextBlocks(section.blocks).map((block) => block.id);
  if (ids.length === 0) {
    return "rev-local-empty";
  }
  return `rev-local-${ids.join("|")}`;
}

function buildContentModel(
  knowledge: KnowledgeStore,
  runtime: RuntimeStore,
  projectRef: string
): ProjectionContentModel {
  const model = createEmptyProjectionContentModel(projectRef);

  const durableFrames = knowledge
    .list()
    .filter(isDurableProjectionFrame)
    .sort((left, right) => left.id.localeCompare(right.id));

  durableFrames.forEach((frame, index) => {
    const sectionKey = frameSectionKey(frame, projectRef);
    if (!sectionKey) {
      return;
    }
    appendBlock(model, sectionKey, frameToBlock(frame, index));
  });

  const queued = runtime.queueList();
  queued.forEach((item, index) => {
    const sectionKey = runtimeSectionKey(item, projectRef);
    if (!sectionKey) {
      return;
    }
    appendBlock(model, sectionKey, runtimeItemToBlock(item, index));
  });

  return model;
}

/** Offline projection source that reads local runtime and knowledge stores. */
export class LocalProjectionSource implements ProjectionSource {
  readonly sourceKind = "local" as const;
  readonly supportsApply = true;

  constructor(private readonly options: LocalProjectionSourceOptions) {}

  loadProjectionDocuments(options: ProjectionSourceLoadOptions = {}): ProjectionDocument[] {
    const projectRef = options.projectRef ?? this.options.projectRef ?? "project";
    const generatedAt = this.options.generatedAt ?? new Date().toISOString();
    const model = buildContentModel(this.options.knowledge, this.options.runtime, projectRef);
    const bodies = renderProjectionContentModel(model);

    return PROJECTION_FILE_KINDS.map((kind) => {
      const sectionKey = PROJECTION_KIND_TO_SECTION[kind];
      const section = model[sectionKey];
      const tokenCount = sumSectionTokenEstimate(section);

      return createProjectionDocument({
        kind,
        body: bodies[sectionKey],
        generated_at: generatedAt,
        source_revision: computeSourceRevision(section),
        ...(kind.startsWith("project_") ? { project_ref: projectRef } : {}),
        token_count: tokenCount,
        combined_count: 0,
        status: "ok",
        truncated: false,
      });
    });
  }
}
