/**
 * AMP projection document sources.
 *
 * Falsifiable claim: a ProjectionSource loads four canonical projection
 * documents for dry-run/materialization; placeholder source uses fixture
 * documents only and refuses apply mode.
 */

import { PROJECTION_FILE_KINDS } from "./constants.js";
import { createProjectionDocument, type ProjectionDocument } from "./schema.js";

export interface ProjectionSourceLoadOptions {
  projectRef?: string;
}

export interface ProjectionSource {
  readonly sourceKind: "placeholder" | string;
  readonly supportsApply: boolean;
  loadProjectionDocuments(
    options?: ProjectionSourceLoadOptions
  ): Promise<ProjectionDocument[]> | ProjectionDocument[];
}

export interface PlaceholderProjectionSourceOptions {
  projectRef?: string;
}

/** Placeholder source for dry-run parity — no DB reads, apply mode unsupported. */
export class PlaceholderProjectionSource implements ProjectionSource {
  readonly sourceKind = "placeholder" as const;
  readonly supportsApply = false;

  constructor(private readonly defaults: PlaceholderProjectionSourceOptions = {}) {}

  loadProjectionDocuments(
    options: ProjectionSourceLoadOptions = {}
  ): ProjectionDocument[] {
    const projectRef = options.projectRef ?? this.defaults.projectRef ?? "project";

    return PROJECTION_FILE_KINDS.map((kind) =>
      createProjectionDocument({
        kind,
        ...(kind.startsWith("project_") ? { project_ref: projectRef } : {}),
      })
    );
  }
}

/** Default placeholder source instance for dry-run pipelines. */
export const placeholderProjectionSource = new PlaceholderProjectionSource();
