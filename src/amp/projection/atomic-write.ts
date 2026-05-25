/**
 * AMP filesystem projection atomic markdown writer.
 *
 * Writes via a temp file in the target directory, then renames into place so
 * readers never observe partial content. Budget gating is the caller's
 * responsibility — these writers do not invoke evaluateProjectionBudget.
 */

import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { ProjectionFileKind } from "./constants.js";
import { projectionFilePath } from "./paths.js";
import { renderProjectionMarkdown } from "./render.js";
import type { ProjectionDocument } from "./schema.js";
import type { ProjectionWriteResult, WriteProjectionOptions } from "./write.js";

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

function tempPathFor(targetPath: string): string {
  const suffix = randomBytes(8).toString("hex");
  return join(dirname(targetPath), `.${basename(targetPath)}.${suffix}.tmp`);
}

async function writeContentAtomic(targetPath: string, content: string): Promise<void> {
  const parentDir = dirname(targetPath);
  await mkdir(parentDir, { recursive: true });

  const tempPath = tempPathFor(targetPath);
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Atomically write one projection document to its canonical AMP-managed path. */
export async function writeProjectionFileAtomic(
  document: ProjectionDocument,
  options: WriteProjectionOptions = {}
): Promise<ProjectionWriteResult> {
  const { kind, path } = resolveWriteTarget(document, options);
  const content = renderProjectionMarkdown(document);
  const bytes = Buffer.byteLength(content, "utf8");
  const dryRun = options.dryRun === true;

  if (!dryRun) {
    await writeContentAtomic(path, content);
  }

  return {
    path,
    kind,
    bytes,
    wrote: !dryRun,
    dryRun,
  };
}

/** Atomically write multiple projection documents to their canonical AMP-managed paths. */
export async function writeProjectionFilesAtomic(
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
    results.push(await writeProjectionFileAtomic(document, options));
  }
  return results;
}
