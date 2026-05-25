/**
 * `amp init` — project-local AMP config and safe runtime directories.
 *
 * Falsifiable claim: init creates `.amp/config.yaml` and runtime parent dirs
 * without writing harness from-amp artifacts.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { discoverAmpConfig } from "../config/discovery.js";
import {
  AMP_USER_CONFIG_PATH_ENV,
  PROJECT_CONFIG_DIR,
  PROJECT_CONFIG_REL,
  projectConfigPath,
} from "../config/paths.js";
import { AMP_CONFIG_VERSION } from "../config/schema.js";
import { ensureAmpGitignoreEntries } from "../gitignore/ensure.js";
import { AMP_LOCAL_DIR_REL } from "../gitignore/paths.js";

export const PROJECT_LOCAL_DIR_REL = join(PROJECT_CONFIG_DIR, "local");
export const PROJECT_RUNTIME_DIR_REL = join(PROJECT_CONFIG_DIR, "runtime");
export const DEFAULT_PROJECT_RUNTIME_DB_FILENAME = "runtime.db";

export interface AmpInitOptions {
  projectRoot?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface AmpInitResult {
  projectRoot: string;
  configPath: string;
  configCreated: boolean;
  configSkippedExisting: boolean;
  runtimeDbPath: string;
  runtimeDirCreated: boolean;
  localDirCreated: boolean;
  gitignorePath: string;
  gitignoreCreated: boolean;
  gitignoreEntriesAdded: string[];
  gitignoreEntriesPresent: string[];
}

function deriveProjectRef(projectRoot: string): string {
  const base = basename(resolve(projectRoot));
  return base.length > 0 ? base : "project";
}

/** Default project-local runtime DB path (absolute). */
export function defaultProjectRuntimeDbPath(projectRoot: string): string {
  return join(
    resolve(projectRoot),
    PROJECT_RUNTIME_DIR_REL,
    DEFAULT_PROJECT_RUNTIME_DB_FILENAME
  );
}

function buildDefaultConfigContent(projectRoot: string): string {
  const projectRef = deriveProjectRef(projectRoot);
  const runtimeDbPath = defaultProjectRuntimeDbPath(projectRoot);

  return [
    `amp_config_version: '${AMP_CONFIG_VERSION}'`,
    `project_ref: ${projectRef}`,
    "runtime:",
    `  db_path: ${runtimeDbPath}`,
    "",
  ].join("\n");
}

async function ensureRuntimeDirectory(dbPath: string): Promise<boolean> {
  const runtimeDir = dirname(dbPath);
  const existed = existsSync(runtimeDir);
  await mkdir(runtimeDir, { recursive: true });
  return !existed;
}

async function ensureLocalDirectory(projectRoot: string): Promise<boolean> {
  const localDir = join(resolve(projectRoot), PROJECT_LOCAL_DIR_REL);
  const existed = existsSync(localDir);
  await mkdir(localDir, { recursive: true });
  return !existed;
}

/** Initialize AMP project-local config and runtime directories. */
export async function runAmpInit(options: AmpInitOptions = {}): Promise<AmpInitResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const configPath = projectConfigPath(projectRoot, { env: options.env });
  const configExists = existsSync(configPath);

  let configCreated = false;
  let configSkippedExisting = false;

  if (configExists && !options.force) {
    configSkippedExisting = true;
  } else {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, buildDefaultConfigContent(projectRoot), "utf8");
    configCreated = true;
  }

  const resolved = discoverAmpConfig({
    projectRoot,
    env: {
      ...(options.env ?? process.env),
      [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, ".amp", "missing-user-config.yaml"),
    },
    platform: "linux",
    homedir: () => join(projectRoot, "home"),
  });

  const runtimeDbPath = resolved.runtime.dbPath;
  const runtimeDirCreated = await ensureRuntimeDirectory(runtimeDbPath);
  const localDirCreated = await ensureLocalDirectory(projectRoot);
  const gitignoreResult = await ensureAmpGitignoreEntries(projectRoot);

  return {
    projectRoot,
    configPath,
    configCreated,
    configSkippedExisting,
    runtimeDbPath,
    runtimeDirCreated,
    localDirCreated,
    gitignorePath: gitignoreResult.gitignorePath,
    gitignoreCreated: gitignoreResult.gitignoreCreated,
    gitignoreEntriesAdded: gitignoreResult.entriesAdded,
    gitignoreEntriesPresent: gitignoreResult.entriesPresent,
  };
}

/** Human-readable init output lines for CLI and tests. */
export function formatAmpInitMessages(result: AmpInitResult): string[] {
  const lines: string[] = [`Initializing AMP in ${result.projectRoot}...`];

  if (result.configCreated) {
    lines.push(`  + ${PROJECT_CONFIG_REL}`);
  } else if (result.configSkippedExisting) {
    lines.push(`  ✓ ${PROJECT_CONFIG_REL} already exists (use --force to overwrite).`);
  }

  if (result.runtimeDirCreated) {
    lines.push(`  + ${PROJECT_RUNTIME_DIR_REL}/`);
  } else {
    lines.push(`  ✓ ${PROJECT_RUNTIME_DIR_REL}/ ready.`);
  }

  if (result.localDirCreated) {
    lines.push(`  + ${AMP_LOCAL_DIR_REL}`);
  } else {
    lines.push(`  ✓ ${AMP_LOCAL_DIR_REL} ready.`);
  }

  if (result.gitignoreCreated || result.gitignoreEntriesAdded.length > 0) {
    lines.push("  + .gitignore (AMP local/runtime protection)");
  } else {
    lines.push("  ✓ .gitignore already protects AMP local/runtime paths.");
  }

  lines.push("");
  lines.push("✓ Done. Next step:");
  lines.push("  Run `amp doctor` to verify config, runtime, and adapter readiness.");

  return lines;
}
