/**
 * Read-only gbrain projection source backed by GbrainKnowledgeAdapter.
 *
 * Falsifiable claim: listFrames + local runtime queue render four projection
 * documents without calling gbrain write/mutate/delete MCP tools.
 */

import type { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { operationError, type ListResult } from "../adapter-contract/operation-results.js";
import type { Frame } from "../core/frame-schema.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { buildProjectionDocuments } from "./build-documents.js";
import { ProjectionSourceLoadError } from "./errors.js";
import { GBRAIN_PROJECTION_READ_FAILED } from "./messages.js";
import type { ProjectionDocument } from "./schema.js";
import type { ProjectionSource, ProjectionSourceLoadOptions } from "./source.js";

export interface GbrainProjectionSourceOptions {
  adapter: GbrainKnowledgeAdapter;
  runtime: RuntimeStore;
  projectRef?: string;
  generatedAt?: string;
}

function formatGbrainListFailure(result: Extract<ListResult<Frame>, { success: false }>): string {
  const ampError = operationError(result);
  if (ampError) {
    return formatGbrainListFailureMessage(ampError.message);
  }
  return formatGbrainListFailureMessage("listFrames failed.");
}

function formatGbrainListFailureMessage(message: string): string {
  return `${GBRAIN_PROJECTION_READ_FAILED} ${message}`;
}

/** Read-only projection source that reads durable frames from gbrain MCP. */
export class GbrainProjectionSource implements ProjectionSource {
  readonly sourceKind = "gbrain" as const;
  readonly supportsApply = true;

  constructor(private readonly options: GbrainProjectionSourceOptions) {}

  async loadProjectionDocuments(
    options: ProjectionSourceLoadOptions = {}
  ): Promise<ProjectionDocument[]> {
    const projectRef = options.projectRef ?? this.options.projectRef ?? "project";
    const listResult = await this.options.adapter.listFrames();

    if (!listResult.success) {
      throw new ProjectionSourceLoadError(formatGbrainListFailure(listResult));
    }

    return buildProjectionDocuments({
      frames: listResult.items,
      runtimeItems: this.options.runtime.queueList(),
      projectRef,
      generatedAt: this.options.generatedAt,
      revisionPrefix: "gbrain",
    });
  }
}
