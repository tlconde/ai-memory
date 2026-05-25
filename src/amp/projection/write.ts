/**
 * AMP filesystem projection markdown writer.
 *
 * Falsifiable claim: only the four canonical projection paths are materialized
 * via projectionFilePath() and renderProjectionMarkdown(); dryRun plans writes
 * without touching disk.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ProjectionFileKind } from "./constants.js";
import { projectionFilePath, type PathContext } from "./paths.js";
import { renderProjectionMarkdown } from "./render.js";
import type { ProjectionDocument } from "./schema.js";

export interface WriteProjectionOptions extends PathContext {
  projectRoot?: string;
  dryRun?: boolean;
}

export interface ProjectionWriteResult {
  path: string;
  kind: ProjectionFileKind;
  bytes: number;
  wrote: boolean;
  dryRun: boolean;
}

function requireProjectRoot(kind: ProjectionFileKind, projectRoot: string | undefined): string {
  if (!kind.startsWith("project_")) {
    return "";
  }
  if (!projectRoot) {
    throw new Error(`projectRoot is required for ${kind} writes`);
  }
  return resolve(projectRoot);
}

function resolveWriteTarget(
  document: ProjectionDocument,
  options: WriteProjectionOptions
): { kind: ProjectionFileKind; path: string } {
  const kind = document.metadata.kind;
  const resolvedProjectRoot = requireProjectRoot(kind, options.projectRoot);
  const path = projectionFilePath(kind, {
    ...options,
    ...(resolvedProjectRoot ? { projectRoot: resolvedProjectRoot } : {}),
  });
  return { kind, path };
}

/** Write one projection document to its canonical AMP-managed path. */
export async function writeProjectionFile(
  document: ProjectionDocument,
  options: WriteProjectionOptions = {}
): Promise<ProjectionWriteResult> {
  const { kind, path } = resolveWriteTarget(document, options);
  const content = renderProjectionMarkdown(document);
  const bytes = Buffer.byteLength(content, "utf8");
  const dryRun = options.dryRun === true;

  if (!dryRun) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  return {
    path,
    kind,
    bytes,
    wrote: !dryRun,
    dryRun,
  };
}

/** Write multiple projection documents to their canonical AMP-managed paths. */
export async function writeProjectionFiles(
  documents: readonly ProjectionDocument[],
  options: WriteProjectionOptions = {}
): Promise<ProjectionWriteResult[]> {
  const seenKinds = new Set<ProjectionFileKind>();
  for (const document of documents) {
    const kind = document.metadata.kind;
    if (seenKinds.has(kind)) {
      throw new Error(`duplicate projection write for kind ${kind}`);
    }
    seenKinds.add(kind);
  }

  const results: ProjectionWriteResult[] = [];
  for (const document of documents) {
    results.push(await writeProjectionFile(document, options));
  }
  return results;
}
