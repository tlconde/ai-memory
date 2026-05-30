/**
 * `amp procedural` — import, revoke, and list gstack procedural artifacts.
 *
 * Local-first: reads a user-provided gstack checkout directory only (no network).
 */

import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

import { discoverAmpConfig } from "../config/discovery.js";
import {
  AMP_USER_CONFIG_PATH_ENV,
  projectConfigPath,
} from "../config/paths.js";
import { ProcedureRegistry } from "../procedural/registry.js";
import {
  createPropagationHarnessWriters,
  defaultProjectProceduresDir,
  loadProcedureRegistryFromDirectory,
} from "./propagate.js";
import {
  GSTACK_UPSTREAM_SOURCE_ID,
} from "../procedural/parse-skill-md.js";
import {
  importGstackFromCheckout,
  listGstackProcedures,
  loadGstackRevokeSnapshot,
  persistGstackRevokeSnapshot,
  clearGstackRevokeSnapshot,
  revokeGstackImports,
  snapshotHarnessFromAmp,
  type GstackImportResult,
  type GstackListResult,
  type GstackRevokeResult,
} from "../upstream/gstack-import.js";
import {
  GBRAIN_PROCEDURAL_SOURCE_ID,
  listGbrainProcedures,
  resolveGbrainSkillsDir,
} from "../upstream/gbrain-skills-source.js";

export interface AmpProceduralImportGstackOptions {
  checkoutPath: string;
  ref?: string;
  projectRoot?: string;
  registry?: ProcedureRegistry;
  env?: NodeJS.ProcessEnv;
  syncedAt?: string;
}

export interface AmpProceduralRevokeGstackOptions {
  projectRoot?: string;
  keepEdited?: boolean;
  registry?: ProcedureRegistry;
  harnessSnapshot?: Map<string, Buffer>;
  env?: NodeJS.ProcessEnv;
  syncedAt?: string;
}

export interface AmpProceduralListOptions {
  projectRoot?: string;
  source?: string;
  checkoutPath?: string;
  skillsPath?: string;
  ref?: string;
  registry?: ProcedureRegistry;
  env?: NodeJS.ProcessEnv;
}

async function resolveProjectContext(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  registry?: ProcedureRegistry
): Promise<{
  proceduresDir: string;
  registry: ProcedureRegistry;
}> {
  const configPath = projectConfigPath(projectRoot, { env });
  if (!existsSync(configPath)) {
    throw new Error(`Project AMP config not found at ${configPath}. Run \`amp init\` first.`);
  }

  discoverAmpConfig({
    projectRoot,
    env: {
      ...env,
      [AMP_USER_CONFIG_PATH_ENV]:
        env[AMP_USER_CONFIG_PATH_ENV] ?? join(projectRoot, ".amp", "missing-user-config.yaml"),
    },
  });

  const proceduresDir = defaultProjectProceduresDir(projectRoot);
  const resolvedRegistry =
    registry ?? (await loadProcedureRegistryFromDirectory(proceduresDir));

  return { proceduresDir, registry: resolvedRegistry };
}

/** Import gstack skills from a local checkout directory. */
export async function runAmpProceduralImportGstack(
  options: AmpProceduralImportGstackOptions
): Promise<GstackImportResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const checkoutDir = resolve(options.checkoutPath);
  const ref = options.ref ?? "local-gstack";

  if (!existsSync(checkoutDir)) {
    return {
      ok: false,
      imported: [],
      validationErrors: [],
      conflicts: [],
      propagation: { writes: [], unsupportedTargets: [] },
      error: `Gstack checkout not found: ${checkoutDir}`,
    };
  }

  const { proceduresDir, registry } = await resolveProjectContext(
    projectRoot,
    env,
    options.registry
  );

  await persistGstackRevokeSnapshot(projectRoot, await snapshotHarnessFromAmp(projectRoot));

  const harnessBeforeImport = await snapshotHarnessFromAmp(projectRoot);

  return importGstackFromCheckout({
    checkoutDir,
    ref,
    registry,
    proceduresDir,
    writers: createPropagationHarnessWriters(projectRoot),
    syncedAt: options.syncedAt,
    harnessSnapshot: harnessBeforeImport,
    projectRoot,
  });
}

/** Revoke gstack-managed procedures and restore harness from-amp snapshot. */
export async function runAmpProceduralRevokeGstack(
  options: AmpProceduralRevokeGstackOptions = {}
): Promise<GstackRevokeResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;

  const { proceduresDir, registry } = await resolveProjectContext(
    projectRoot,
    env,
    options.registry
  );

  const harnessSnapshot =
    options.harnessSnapshot ??
    (await loadGstackRevokeSnapshot(projectRoot)) ??
    (await snapshotHarnessFromAmp(projectRoot));

  const result = await revokeGstackImports({
    registry,
    proceduresDir,
    writers: createPropagationHarnessWriters(projectRoot),
    projectRoot,
    keepEdited: options.keepEdited ?? false,
    harnessSnapshot,
    syncedAt: options.syncedAt,
  });

  if (result.ok && !options.harnessSnapshot) {
    await clearGstackRevokeSnapshot(projectRoot);
  }

  return result;
}

/** List gstack import candidates, gbrain discovery overlay, or registry entries. */
export async function runAmpProceduralList(
  options: AmpProceduralListOptions = {}
): Promise<GstackListResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const source = options.source?.trim();

  if (source === GBRAIN_PROCEDURAL_SOURCE_ID) {
    const skillsDir = resolve(resolveGbrainSkillsDir(options.skillsPath, env));
    return listGbrainProcedures({
      skillsDir,
      ref: options.ref,
    });
  }

  if (options.checkoutPath) {
    return listGstackProcedures({
      checkoutDir: resolve(options.checkoutPath),
      ref: options.ref,
    });
  }

  if (source && source !== GSTACK_UPSTREAM_SOURCE_ID) {
    throw new Error(
      `Unsupported procedural list source: ${source}. Use --source gbrain with --path, or omit for gstack registry.`
    );
  }

  const { registry } = await resolveProjectContext(projectRoot, env, options.registry);
  return listGstackProcedures({
    registry,
    sourceFilter: source ?? GSTACK_UPSTREAM_SOURCE_ID,
  });
}

export function formatAmpProceduralImportReport(result: GstackImportResult): string[] {
  const lines = ["AMP procedural import gstack", ""];

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
  }

  for (const failure of result.validationErrors) {
    lines.push(
      `  WARN [validation_error] ${failure.skillName}: ${failure.validation_error}`
    );
  }

  for (const conflict of result.conflicts) {
    lines.push(`  WARN [conflict] ${conflict.skillName}: ${conflict.reason}`);
  }

  for (const name of result.imported) {
    lines.push(`  OK imported ${name}`);
  }

  const written = result.propagation.writes.filter((record) => record.status === "written").length;
  lines.push("");
  lines.push(`Summary: ${result.imported.length} imported, ${written} propagation write(s).`);
  lines.push(result.ok ? "OK Gstack import finished." : "ERROR Gstack import finished with issues.");
  return lines;
}

export function formatAmpProceduralRevokeReport(result: GstackRevokeResult): string[] {
  const lines = ["AMP procedural revoke gstack", ""];

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
  }

  for (const name of result.removed) {
    lines.push(`  OK removed ${name}`);
  }
  for (const name of result.preserved) {
    lines.push(`  INFO preserved ${name}`);
  }

  lines.push("");
  lines.push(
    `Summary: ${result.removed.length} removed, ${result.preserved.length} preserved.`
  );
  lines.push(result.ok ? "OK Gstack revoke finished." : "ERROR Gstack revoke failed.");
  return lines;
}

export function formatAmpProceduralListReport(result: GstackListResult): string[] {
  const lines = ["AMP procedural list", ""];

  for (const entry of result.entries) {
    if (entry.validation_error) {
      lines.push(
        `  WARN ${entry.name} (${entry.version}) validation_error: ${entry.validation_error}`
      );
      continue;
    }
    lines.push(
      `  INFO ${entry.name} (${entry.version}) harnesses: ${entry.supported_harnesses.join(", ")}`
    );
  }

  lines.push("");
  lines.push(`Summary: ${result.entries.length} entr(y/ies).`);
  return lines;
}

export function formatAmpProceduralListJson(result: GstackListResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
