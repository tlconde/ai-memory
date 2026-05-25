/**
 * Idempotent `.gitignore` maintenance for AMP-managed project-local paths.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  AMP_GITIGNORE_MARKER,
  DEFAULT_AMP_GITIGNORE_LINES,
} from "./paths.js";

export interface EnsureAmpGitignoreOptions {
  /** When false, omit the marker comment above the AMP block. Default true. */
  includeMarker?: boolean;
}

export interface EnsureAmpGitignoreResult {
  projectRoot: string;
  gitignorePath: string;
  gitignoreCreated: boolean;
  entriesAdded: string[];
  entriesPresent: string[];
}

function normalizeGitignoreLine(line: string): string {
  return line.trim();
}

function gitignoreContainsEntry(content: string, entry: string): boolean {
  const normalizedEntry = normalizeGitignoreLine(entry);
  return content
    .split(/\r?\n/)
    .some((line) => normalizeGitignoreLine(line) === normalizedEntry);
}

function buildAmpGitignoreBlock(
  entries: readonly string[],
  options: EnsureAmpGitignoreOptions
): string {
  const lines = entries.map(String);
  if (lines.length === 0) {
    return "";
  }
  if (options.includeMarker !== false) {
    return [AMP_GITIGNORE_MARKER, ...lines].join("\n");
  }
  return lines.join("\n");
}

function appendAmpGitignoreBlock(existingContent: string, block: string): string {
  const trimmed = existingContent.replace(/\s+$/, "");
  if (trimmed.length === 0) {
    return `${block}\n`;
  }
  return `${trimmed}\n\n${block}\n`;
}

/** Ensure AMP-managed paths are present in the project `.gitignore`. */
export async function ensureAmpGitignoreEntries(
  projectRoot: string,
  options: EnsureAmpGitignoreOptions = {}
): Promise<EnsureAmpGitignoreResult> {
  const resolvedRoot = resolve(projectRoot);
  const gitignorePath = join(resolvedRoot, ".gitignore");
  const gitignoreCreated = !existsSync(gitignorePath);

  const existingContent = gitignoreCreated ? "" : await readFile(gitignorePath, "utf8");
  const managedEntries = [...DEFAULT_AMP_GITIGNORE_LINES];

  const entriesPresent = managedEntries.filter((entry) =>
    gitignoreContainsEntry(existingContent, entry)
  );
  const entriesAdded = managedEntries.filter(
    (entry) => !gitignoreContainsEntry(existingContent, entry)
  );

  if (entriesAdded.length > 0) {
    const block = buildAmpGitignoreBlock(entriesAdded, options);
    const nextContent = appendAmpGitignoreBlock(existingContent, block);
    await writeFile(gitignorePath, nextContent, "utf8");
  }

  return {
    projectRoot: resolvedRoot,
    gitignorePath,
    gitignoreCreated,
    entriesAdded,
    entriesPresent,
  };
}
