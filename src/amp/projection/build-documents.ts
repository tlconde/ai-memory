/**
 * Shared projection document builder from durable frames and runtime queue items.
 */

import type { Frame, ScopeKind } from "../core/frame-schema.js";
import type { RuntimeQueueItem } from "../substrate/storage/episodic-signal.js";
import {
  materializeRuntimeProjectionFromSource,
  type RuntimeProjectionMaterializationSkip,
  type RuntimeProjectionMaterializedItem,
  type RuntimeSemanticEntitySource,
} from "../runtime-semantics/projection-source.js";
import { PROJECTION_FILE_KINDS } from "./constants.js";
import {
  createEmptyProjectionContentModel,
  estimateProjectionTextTokens,
  renderProjectionContentModel,
  sortProjectionTextBlocks,
  sumSectionTokenEstimate,
  type ProjectionContentModel,
  type ProjectionContentSection,
  type ProjectionContentSectionKey,
  type ProjectionTextBlock,
} from "./content.js";
import { createProjectionDocument, type ProjectionDocument } from "./schema.js";

const PROJECTION_KIND_TO_SECTION: Record<
  (typeof PROJECTION_FILE_KINDS)[number],
  ProjectionContentSectionKey
> = {
  global_projection: "globalProjection",
  global_runtime: "globalRuntime",
  project_projection: "projectProjection",
  project_runtime: "projectRuntime",
};

export type ProjectionStoreKind = "projection" | "runtime";

const TYPED_RUNTIME_SEMANTIC_BLOCK_LABEL = "Typed runtime semantics";

function frameToText(frame: Frame): string {
  return typeof frame.content === "string" ? frame.content : JSON.stringify(frame.content);
}

export function isDurableProjectionFrame(frame: Frame): boolean {
  return frame.kind === "semantic" || frame.kind === "crystal";
}

export function resolveProjectionSectionKey(
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

function maxBlockPriority(section: ProjectionContentSection): number {
  if (section.blocks.length === 0) {
    return -1;
  }
  return Math.max(...section.blocks.map((block) => block.priority));
}

function materializedRuntimeItemToBlock(
  item: RuntimeProjectionMaterializedItem,
  priority: number
): ProjectionTextBlock {
  return {
    id: item.id,
    label: `${TYPED_RUNTIME_SEMANTIC_BLOCK_LABEL} (${item.kind})`,
    priority,
    tokenEstimate: estimateProjectionTextTokens(item.text),
    text: item.text,
  };
}

function appendTypedRuntimeSemanticBlocks(
  model: ProjectionContentModel,
  items: readonly RuntimeProjectionMaterializedItem[]
): void {
  const nextPriorityBySection: Record<
    "globalRuntime" | "projectRuntime",
    number
  > = {
    globalRuntime: maxBlockPriority(model.globalRuntime) + 1,
    projectRuntime: maxBlockPriority(model.projectRuntime) + 1,
  };

  for (const item of items) {
    const priority = nextPriorityBySection[item.section];
    appendBlock(model, item.section, materializedRuntimeItemToBlock(item, priority));
    nextPriorityBySection[item.section] = priority + 1;
  }
}

function appendBlock(
  model: ProjectionContentModel,
  sectionKey: ProjectionContentSectionKey,
  block: ProjectionTextBlock
): void {
  model[sectionKey].blocks.push(block);
}

function computeSourceRevision(
  section: ProjectionContentModel[ProjectionContentSectionKey],
  prefix: string
): string {
  const ids = sortProjectionTextBlocks(section.blocks).map((block) => block.id);
  if (ids.length === 0) {
    return `rev-${prefix}-empty`;
  }
  return `rev-${prefix}-${ids.join("|")}`;
}

export function buildProjectionContentModel(
  frames: readonly Frame[],
  runtimeItems: readonly RuntimeQueueItem[],
  projectRef: string,
  runtimeSemanticItems: readonly RuntimeProjectionMaterializedItem[] = []
): ProjectionContentModel {
  const model = createEmptyProjectionContentModel(projectRef);

  const durableFrames = frames
    .filter(isDurableProjectionFrame)
    .sort((left, right) => left.id.localeCompare(right.id));

  durableFrames.forEach((frame, index) => {
    const sectionKey = frameSectionKey(frame, projectRef);
    if (!sectionKey) {
      return;
    }
    appendBlock(model, sectionKey, frameToBlock(frame, index));
  });

  runtimeItems.forEach((item, index) => {
    const sectionKey = runtimeSectionKey(item, projectRef);
    if (!sectionKey) {
      return;
    }
    appendBlock(model, sectionKey, runtimeItemToBlock(item, index));
  });

  appendTypedRuntimeSemanticBlocks(model, runtimeSemanticItems);

  return model;
}

export interface BuildProjectionDocumentsOptions {
  frames: readonly Frame[];
  runtimeItems: readonly RuntimeQueueItem[];
  projectRef: string;
  generatedAt?: string;
  revisionPrefix: string;
  runtimeSemanticSource?: RuntimeSemanticEntitySource;
}

export interface BuildProjectionDocumentsReport {
  runtimeSemanticSkipped: readonly RuntimeProjectionMaterializationSkip[];
}

export interface BuildProjectionDocumentsResult {
  documents: ProjectionDocument[];
  report: BuildProjectionDocumentsReport;
}

/** Build four canonical projection documents from frames and runtime queue items. */
export function buildProjectionDocumentsWithReport(
  options: BuildProjectionDocumentsOptions
): BuildProjectionDocumentsResult {
  const projectRef = options.projectRef;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const materialization = options.runtimeSemanticSource
    ? materializeRuntimeProjectionFromSource(options.runtimeSemanticSource, { projectRef })
    : { items: [], skipped: [] };
  const model = buildProjectionContentModel(
    options.frames,
    options.runtimeItems,
    projectRef,
    materialization.items
  );
  const bodies = renderProjectionContentModel(model);

  const documents = PROJECTION_FILE_KINDS.map((kind) => {
    const sectionKey = PROJECTION_KIND_TO_SECTION[kind];
    const section = model[sectionKey];
    const tokenCount = sumSectionTokenEstimate(section);

    return createProjectionDocument({
      kind,
      body: bodies[sectionKey],
      generated_at: generatedAt,
      source_revision: computeSourceRevision(section, options.revisionPrefix),
      ...(kind.startsWith("project_") ? { project_ref: projectRef } : {}),
      token_count: tokenCount,
      combined_count: 0,
      status: "ok",
      truncated: false,
    });
  });

  return {
    documents,
    report: {
      runtimeSemanticSkipped: materialization.skipped,
    },
  };
}

/** Build four canonical projection documents from frames and runtime queue items. */
export function buildProjectionDocuments(
  options: BuildProjectionDocumentsOptions
): ProjectionDocument[] {
  return buildProjectionDocumentsWithReport(options).documents;
}
