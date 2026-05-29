/**
 * Upstream changeset persistence on disk.
 *
 * Falsifiable claim: changesets validate before write and round-trip with status metadata.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  defaultUpstreamChangesetsDir,
  type PathContext,
} from "../config/paths.js";
import {
  PersistedUpstreamChangesetSchema,
  UpstreamChangesetSchema,
  type PersistedUpstreamChangeset,
  type UpstreamChangeset,
  type UpstreamChangesetStatus,
} from "./types.js";

function changesetsDir(options: PathContext = {}): string {
  return defaultUpstreamChangesetsDir(options);
}

function changesetFileName(id: string): string {
  return `${id}.json`;
}

/** Format changeset id: `<sourceId>-<YYYYMMDD-HHmmss>`. */
export function formatChangesetId(sourceId: string, detectedAt: Date): string {
  const iso = detectedAt.toISOString();
  const datePart = iso.slice(0, 10).replace(/-/g, "");
  const timePart = iso.slice(11, 19).replace(/:/g, "");
  return `${sourceId}-${datePart}-${timePart}`;
}

/** Write a validated pending changeset to disk. */
export async function writeChangeset(
  changeset: UpstreamChangeset,
  options: PathContext = {}
): Promise<PersistedUpstreamChangeset> {
  const validated = UpstreamChangesetSchema.parse(changeset);
  const persisted = PersistedUpstreamChangesetSchema.parse({
    ...validated,
    status: "pending" as const,
  });
  const dir = changesetsDir(options);
  await mkdir(dir, { recursive: true });
  const path = join(dir, changesetFileName(persisted.id));
  await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

/** Read a changeset by id. */
export async function readChangeset(
  id: string,
  options: PathContext = {}
): Promise<PersistedUpstreamChangeset | undefined> {
  const path = join(changesetsDir(options), changesetFileName(id));
  try {
    const raw = await readFile(path, "utf8");
    return PersistedUpstreamChangesetSchema.parse(JSON.parse(raw));
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

/** List all persisted changesets, optionally filtered by status. */
export async function listChangesets(
  options: PathContext = {},
  status?: UpstreamChangesetStatus
): Promise<PersistedUpstreamChangeset[]> {
  const dir = changesetsDir(options);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const changesets: PersistedUpstreamChangeset[] = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const raw = await readFile(join(dir, file), "utf8");
    const parsed = PersistedUpstreamChangesetSchema.parse(JSON.parse(raw));
    if (status === undefined || parsed.status === status) {
      changesets.push(parsed);
    }
  }

  changesets.sort((left, right) => left.detectedAt.localeCompare(right.detectedAt));
  return changesets;
}

/** Update changeset status on disk. */
export async function updateChangesetStatus(
  id: string,
  status: UpstreamChangesetStatus,
  timestamp: string,
  options: PathContext = {}
): Promise<PersistedUpstreamChangeset> {
  const existing = await readChangeset(id, options);
  if (!existing) {
    throw new Error(`Changeset not found: ${id}`);
  }

  const updated = PersistedUpstreamChangesetSchema.parse({
    ...existing,
    status,
    ...(status === "applied" || status === "partially-applied"
      ? { appliedAt: timestamp }
      : {}),
    ...(status === "dismissed" ? { dismissedAt: timestamp } : {}),
  });

  const path = join(changesetsDir(options), changesetFileName(id));
  await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

/** True when an equivalent ref-pair changeset already exists. */
export async function hasExistingChangesetForRefPair(
  sourceId: string,
  localRef: string,
  upstreamRef: string,
  options: PathContext = {}
): Promise<boolean> {
  const all = await listChangesets(options);
  return all.some(
    (entry) =>
      entry.sourceId === sourceId &&
      entry.ref.local === localRef &&
      entry.ref.upstream === upstreamRef
  );
}

/** Changesets that should surface in runtime projection (pending or partially applied). */
export async function listPendingChangesets(
  options: PathContext = {}
): Promise<PersistedUpstreamChangeset[]> {
  const all = await listChangesets(options);
  return all.filter(
    (entry) => entry.status === "pending" || entry.status === "partially-applied"
  );
}

/** Latest dismissed upstream ref for a source (for re-surface logic). */
export async function latestDismissedUpstreamRef(
  sourceId: string,
  options: PathContext = {}
): Promise<string | undefined> {
  const dismissed = (await listChangesets(options)).filter(
    (entry) => entry.sourceId === sourceId && entry.status === "dismissed"
  );
  if (dismissed.length === 0) {
    return undefined;
  }
  dismissed.sort((left, right) => right.detectedAt.localeCompare(left.detectedAt));
  return dismissed[0]?.ref.upstream;
}
