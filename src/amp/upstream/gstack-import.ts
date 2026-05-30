/**
 * Gstack import, revoke, and list operations (AMP §9.9).
 *
 * Local-first: reads a user-provided gstack checkout directory only.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  PROJECT_CONFIG_DIR,
} from "../config/paths.js";

import {
  GSTACK_UPSTREAM_SOURCE_ID,
  isUntouchedGstackImport,
  promoteGstackImportToUserVersion,
} from "../procedural/parse-skill-md.js";
import type { ProcedureRegistry } from "../procedural/registry.js";
import type { ProceduralListResult } from "../procedural/list-types.js";
import {
  parseCanonicalProcedure,
  safeParseCanonicalProcedure,
  type CanonicalProcedure,
} from "../procedural/schema.js";
import { propagateProcedures } from "../substrate/propagation/service.js";
import type { HarnessWriterRegistry, PropagationResult } from "../substrate/propagation/types.js";
import {
  CURSOR_FROM_AMP_REL,
} from "../adapters/sas/cursor/adapter.js";
import { CLAUDE_FROM_AMP_DIR } from "../adapters/sas/claude-code/adapter.js";
import { HERMES_FROM_AMP_REL } from "../adapters/sas/hermes/adapter.js";
import {
  GstackUpstreamSource,
  parseGstackCheckoutSkills,
  type GstackSkillParseResult,
} from "./gstack-source.js";

export const GSTACK_FROM_AMP_REL_PATHS = [
  CURSOR_FROM_AMP_REL,
  join(".claude", "skills", CLAUDE_FROM_AMP_DIR),
  HERMES_FROM_AMP_REL,
] as const;

export interface GstackValidationFailure {
  skillName: string;
  validation_error: string;
}

export interface GstackImportConflict {
  skillName: string;
  reason: string;
}

export interface GstackImportOptions {
  checkoutDir: string;
  ref: string;
  registry: ProcedureRegistry;
  proceduresDir: string;
  writers: HarnessWriterRegistry;
  syncedAt?: string;
  harnessSnapshot?: HarnessFromAmpSnapshot;
  projectRoot?: string;
}

export interface GstackImportResult {
  ok: boolean;
  imported: string[];
  validationErrors: GstackValidationFailure[];
  conflicts: GstackImportConflict[];
  propagation: PropagationResult;
  error?: string;
}

export interface GstackRevokeOptions {
  registry: ProcedureRegistry;
  proceduresDir: string;
  writers: HarnessWriterRegistry;
  projectRoot: string;
  keepEdited?: boolean;
  harnessSnapshot: HarnessFromAmpSnapshot;
  syncedAt?: string;
}

export interface GstackRevokeResult {
  ok: boolean;
  removed: string[];
  preserved: string[];
  propagation: PropagationResult;
  error?: string;
}

export type { ProceduralListEntry, ProceduralListResult } from "../procedural/list-types.js";

export type HarnessFromAmpSnapshot = Map<string, Buffer>;

const GSTACK_REVOKE_SNAPSHOT_DIR = join(PROJECT_CONFIG_DIR, "local", "gstack-revoke-snapshot");

function detectRegistryConflicts(
  registry: ProcedureRegistry,
  procedure: CanonicalProcedure
): string | undefined {
  const name = procedure.frontmatter.name;
  for (const entry of registry.list()) {
    if (entry.procedure.frontmatter.name === name) {
      return `Procedure already registered: ${name}`;
    }
    const overlaps = entry.procedure.frontmatter.triggers.filter((trigger) =>
      procedure.frontmatter.triggers.includes(trigger)
    );
    if (overlaps.length > 0) {
      return `Trigger overlap with ${entry.procedure.frontmatter.name}: ${overlaps.join(", ")}`;
    }
    if (entry.procedure.frontmatter.conflicts_with.includes(name)) {
      return `Declared conflict with ${entry.procedure.frontmatter.name}`;
    }
    if (procedure.frontmatter.conflicts_with.includes(entry.procedure.frontmatter.name)) {
      return `Declares conflict with ${entry.procedure.frontmatter.name}`;
    }
  }
  return undefined;
}

function snapshotRegistry(registry: ProcedureRegistry): Map<string, CanonicalProcedure> {
  const snapshot = new Map<string, CanonicalProcedure>();
  for (const entry of registry.list()) {
    snapshot.set(entry.procedure.frontmatter.name, structuredClone(entry.procedure));
  }
  return snapshot;
}

function restoreRegistrySnapshot(
  registry: ProcedureRegistry,
  snapshot: Map<string, CanonicalProcedure>
): void {
  for (const name of registry.list().map((entry) => entry.procedure.frontmatter.name)) {
    registry.remove(name);
  }
  for (const procedure of snapshot.values()) {
    registry.register(procedure);
  }
}

async function walkFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolute)));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

/** Persist a harness snapshot for later byte-for-byte revoke restore. */
export async function persistGstackRevokeSnapshot(
  projectRoot: string,
  snapshot: HarnessFromAmpSnapshot
): Promise<string> {
  const root = join(projectRoot, GSTACK_REVOKE_SNAPSHOT_DIR);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const manifest: string[] = [];
  for (const [absolutePath, bytes] of snapshot.entries()) {
    const rel = relative(projectRoot, absolutePath);
    const target = join(root, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    manifest.push(rel);
  }

  manifest.sort();
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

/** Load a persisted harness snapshot for revoke restore. */
export async function loadGstackRevokeSnapshot(
  projectRoot: string
): Promise<HarnessFromAmpSnapshot | undefined> {
  const root = join(projectRoot, GSTACK_REVOKE_SNAPSHOT_DIR);
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) {
    return undefined;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as string[];
  const snapshot: HarnessFromAmpSnapshot = new Map();

  for (const rel of manifest) {
    const absolute = join(projectRoot, rel);
    const stored = join(root, rel);
    if (existsSync(stored)) {
      snapshot.set(absolute, await readFile(stored));
    }
  }

  return snapshot;
}

/** Remove persisted revoke snapshot after successful restore. */
export async function clearGstackRevokeSnapshot(projectRoot: string): Promise<void> {
  await rm(join(projectRoot, GSTACK_REVOKE_SNAPSHOT_DIR), { recursive: true, force: true });
}

/** Capture byte contents of all AMP-managed from-amp harness paths. */
export async function snapshotHarnessFromAmp(projectRoot: string): Promise<HarnessFromAmpSnapshot> {
  const snapshot: HarnessFromAmpSnapshot = new Map();

  for (const relPath of GSTACK_FROM_AMP_REL_PATHS) {
    const root = join(projectRoot, relPath);
    const files = await walkFiles(root);
    for (const file of files) {
      snapshot.set(file, await readFile(file));
    }
  }

  return snapshot;
}

/** Restore from-amp harness paths to a prior snapshot byte-for-byte. */
export async function restoreHarnessFromAmpSnapshot(
  projectRoot: string,
  snapshot: HarnessFromAmpSnapshot
): Promise<void> {
  const managedRoots = GSTACK_FROM_AMP_REL_PATHS.map((relPath) => join(projectRoot, relPath));

  for (const root of managedRoots) {
    const currentFiles = await walkFiles(root);
    for (const file of currentFiles) {
      if (!snapshot.has(file)) {
        await rm(file, { force: true });
      }
    }
  }

  for (const [file, bytes] of snapshot.entries()) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }

  for (const root of managedRoots) {
    await pruneEmptyDirectories(root);
  }
}

async function pruneEmptyDirectories(root: string): Promise<void> {
  if (!existsSync(root)) {
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await pruneEmptyDirectories(join(root, entry.name));
    }
  }

  const remaining = await readdir(root);
  if (remaining.length === 0) {
    await rm(root, { recursive: true, force: true });
  }
}

/** Persist a single canonical procedure JSON under the project procedures directory. */
export async function saveProcedureToDirectory(
  proceduresDir: string,
  procedure: CanonicalProcedure
): Promise<string> {
  await mkdir(proceduresDir, { recursive: true });
  const outputPath = join(proceduresDir, `${procedure.frontmatter.name}.json`);
  await writeFile(outputPath, `${JSON.stringify(procedure, null, 2)}\n`, "utf8");
  return outputPath;
}

/** Remove a persisted procedure JSON file from the project procedures directory. */
export async function removeProcedureFromDirectory(
  proceduresDir: string,
  name: string
): Promise<void> {
  const target = join(proceduresDir, `${name}.json`);
  if (existsSync(target)) {
    await rm(target, { force: true });
  }
}

function isGstackManagedProcedure(procedure: CanonicalProcedure): boolean {
  const provenance = procedure.frontmatter.provenance;
  return provenance?.source === "import" && provenance.upstream?.source_id === GSTACK_UPSTREAM_SOURCE_ID;
}

/** Import gstack skills from a local checkout into the registry and propagate. */
export async function importGstackFromCheckout(
  options: GstackImportOptions
): Promise<GstackImportResult> {
  const syncedAt = options.syncedAt ?? new Date().toISOString();
  const parsed = await parseGstackCheckoutSkills(options.checkoutDir, options.ref);

  const validationErrors: GstackValidationFailure[] = parsed
    .filter((entry): entry is GstackSkillParseResult & { validation_error: string } =>
      entry.validation_error !== undefined
    )
    .map((entry) => ({
      skillName: entry.skillName,
      validation_error: entry.validation_error,
    }));

  const importCandidates = parsed.filter(
    (entry): entry is GstackSkillParseResult & { procedure: CanonicalProcedure } =>
      entry.procedure !== undefined
  );

  const conflicts: GstackImportConflict[] = [];
  const toRegister: CanonicalProcedure[] = [];

  for (const entry of importCandidates) {
    const conflictReason = detectRegistryConflicts(options.registry, entry.procedure);
    if (conflictReason) {
      conflicts.push({ skillName: entry.skillName, reason: conflictReason });
      continue;
    }
    toRegister.push(entry.procedure);
  }

  const registrySnapshot = snapshotRegistry(options.registry);
  const harnessSnapshot =
    options.harnessSnapshot ??
    (options.projectRoot ? await snapshotHarnessFromAmp(options.projectRoot) : undefined);
  const imported: string[] = [];

  try {
    for (const procedure of toRegister) {
      options.registry.register(procedure);
      await saveProcedureToDirectory(options.proceduresDir, procedure);
      imported.push(procedure.frontmatter.name);
    }

    const propagation = await propagateProcedures({
      registry: options.registry,
      writers: options.writers,
      syncedAt,
    });

    const failed = propagation.writes.some((record) => record.status === "failed");
    if (failed) {
      throw new Error("Propagation failed for one or more harness targets.");
    }

    return {
      ok: conflicts.length === 0,
      imported,
      validationErrors,
      conflicts,
      propagation,
    };
  } catch (error: unknown) {
    restoreRegistrySnapshot(options.registry, registrySnapshot);
    for (const name of imported) {
      await removeProcedureFromDirectory(options.proceduresDir, name);
    }
    if (harnessSnapshot && options.projectRoot) {
      await restoreHarnessFromAmpSnapshot(options.projectRoot, harnessSnapshot);
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      imported: [],
      validationErrors,
      conflicts,
      propagation: { writes: [], unsupportedTargets: [] },
      error: message,
    };
  }
}

/** Revoke gstack-managed procedures and restore harness from-amp paths. */
export async function revokeGstackImports(options: GstackRevokeOptions): Promise<GstackRevokeResult> {
  const syncedAt = options.syncedAt ?? new Date().toISOString();
  const removed: string[] = [];
  const preserved: string[] = [];

  for (const entry of options.registry.list()) {
    const procedure = entry.procedure;
    if (!isGstackManagedProcedure(procedure)) {
      continue;
    }

    if (options.keepEdited && !isUntouchedGstackImport(procedure)) {
      preserved.push(procedure.frontmatter.name);
      continue;
    }

    options.registry.remove(procedure.frontmatter.name);
    await removeProcedureFromDirectory(options.proceduresDir, procedure.frontmatter.name);
    removed.push(procedure.frontmatter.name);
  }

  await restoreHarnessFromAmpSnapshot(options.projectRoot, options.harnessSnapshot);

  const propagation = await propagateProcedures({
    registry: options.registry,
    writers: options.writers,
    syncedAt,
  });

  return { ok: true, removed, preserved, propagation };
}

/** List gstack import candidates or registry entries filtered by upstream source. */
export async function listGstackProcedures(options: {
  checkoutDir?: string;
  ref?: string;
  registry?: ProcedureRegistry;
  sourceFilter?: string;
}): Promise<ProceduralListResult> {
  if (options.checkoutDir) {
    const parsed = await parseGstackCheckoutSkills(
      options.checkoutDir,
      options.ref ?? "local-gstack"
    );
    return {
      entries: parsed.map((entry) => ({
        name: entry.procedure?.frontmatter.name ?? entry.skillName,
        version: entry.procedure?.frontmatter.version ?? "unknown",
        supported_harnesses:
          entry.procedure?.frontmatter.harness_compatibility.supported_harnesses ?? [],
        validation_error: entry.validation_error,
        frontmatter: entry.procedure?.frontmatter,
      })),
    };
  }

  const registry = options.registry;
  if (!registry) {
    return { entries: [] };
  }

  const sourceId = options.sourceFilter ?? GSTACK_UPSTREAM_SOURCE_ID;
  return {
    entries: registry
      .list()
      .filter((entry) => entry.procedure.frontmatter.provenance?.upstream?.source_id === sourceId)
      .map((entry) => ({
        name: entry.procedure.frontmatter.name,
        version: entry.procedure.frontmatter.version,
        supported_harnesses: entry.procedure.frontmatter.harness_compatibility.supported_harnesses,
        frontmatter: entry.procedure.frontmatter,
      })),
  };
}

/** Apply a local edit promotion from 0.x gstack import to 1.x user-owned semver. */
export function applyGstackLocalEditPromotion(
  registry: ProcedureRegistry,
  name: string,
  editedBody: string,
  editedAt: string
): CanonicalProcedure {
  const entry = registry.get(name);
  if (!entry) {
    throw new Error(`Procedure not found: ${name}`);
  }

  const promotedVersion = promoteGstackImportToUserVersion(entry.procedure.frontmatter.version);
  const provenance = entry.procedure.frontmatter.provenance ?? {
    source: "import" as const,
    created_at: editedAt,
  };

  const updated = parseCanonicalProcedure({
    ...entry.procedure,
    body: editedBody,
    frontmatter: {
      ...entry.procedure.frontmatter,
      version: promotedVersion,
      provenance: {
        ...provenance,
        source: "import",
        updated_at: editedAt,
      },
    },
  });

  registry.update(name, updated);
  return updated;
}

/** Create a GstackUpstreamSource wired to a registry and local checkout. */
export function createGstackUpstreamSource(options: {
  checkoutDir: string;
  ref: string;
  registry: ProcedureRegistry;
  localRef?: string;
}): GstackUpstreamSource {
  return new GstackUpstreamSource({
    config: {
      url: `file://${options.checkoutDir}`,
      ref: options.ref,
    },
    checkoutDir: options.checkoutDir,
    registry: options.registry,
    localRef: options.localRef,
  });
}

/** Relative path helper for integration tests comparing snapshot keys. */
export function relativeFromAmpPath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath);
}

/** Compare two harness snapshots for byte equality. */
export function harnessSnapshotsEqual(
  left: HarnessFromAmpSnapshot,
  right: HarnessFromAmpSnapshot
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [path, bytes] of left.entries()) {
    const other = right.get(path);
    if (!other || !bytes.equals(other)) {
      return false;
    }
  }
  return true;
}

/** Count propagated from-amp artifacts per harness for procedures declaring support. */
export function countPropagatedHarnessArtifacts(options: {
  harnessRoots: {
    cursorFromAmp: string;
    claudeCodeFromAmp: string;
    hermesFromAmp: string;
  };
  registry: ProcedureRegistry;
}): Record<"cursor" | "claude-code" | "hermes", number> {
  const counts = { cursor: 0, "claude-code": 0, hermes: 0 };

  for (const entry of options.registry.list()) {
    const supported = entry.procedure.frontmatter.harness_compatibility.supported_harnesses;
    const supportsAny = supported.includes("any");

    if (supportsAny || supported.includes("cursor")) {
      counts.cursor += 1;
    }
    if (supportsAny || supported.includes("claude-code")) {
      counts["claude-code"] += 1;
    }
    if (supportsAny || supported.includes("hermes")) {
      counts.hermes += 1;
    }
  }

  return counts;
}

/** Verify on-disk from-amp artifact counts match registry expectations. */
export async function countOnDiskFromAmpArtifacts(harnessRoots: {
  cursorFromAmp: string;
  claudeCodeFromAmp: string;
  hermesFromAmp: string;
}): Promise<Record<"cursor" | "claude-code" | "hermes", number>> {
  const countDirFiles = async (root: string): Promise<number> => {
    const files = await walkFiles(root);
    return files.length;
  };

  return {
    cursor: await countDirFiles(harnessRoots.cursorFromAmp),
    "claude-code": await countDirFiles(harnessRoots.claudeCodeFromAmp),
    hermes: await countDirFiles(harnessRoots.hermesFromAmp),
  };
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}
