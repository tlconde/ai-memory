/**
 * `amp propagate` — compile registry procedures to verified harness from-amp roots.
 *
 * Falsifiable claim: propagate writes only through existing adapters under
 * from-amp/ roots and reports writes plus unsupported declared targets.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import yaml from "js-yaml";

import { discoverAmpConfig } from "../config/discovery.js";
import {
  AMP_USER_CONFIG_PATH_ENV,
  PROJECT_CONFIG_DIR,
  projectConfigPath,
} from "../config/paths.js";
import { ProcedureRegistry } from "../procedural/registry.js";
import { safeParseCanonicalProcedure } from "../procedural/schema.js";
import {
  propagateProcedures,
} from "../substrate/propagation/service.js";
import {
  VERIFIED_HARNESS_TARGETS,
  type PropagationResult,
  type PropagationHarnessRoots,
  type VerifiedHarnessTarget,
} from "../substrate/propagation/types.js";

export const PROJECT_PROCEDURES_DIR_REL = join(PROJECT_CONFIG_DIR, "procedures");

const VERIFIED_HARNESS_SET = new Set<string>(VERIFIED_HARNESS_TARGETS);

export interface AmpPropagateOptions {
  projectRoot?: string;
  /** Comma-separated or repeated verified harness targets. Defaults to all verified targets. */
  targets?: string | string[];
  registry?: ProcedureRegistry;
  syncedAt?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

export interface AmpPropagateResult {
  projectRoot: string;
  targets: VerifiedHarnessTarget[];
  registryProcedureCount: number;
  proceduresDir: string;
  propagation: PropagationResult;
  /** True when no failed writes or target parse errors occurred. */
  ok: boolean;
  error?: string;
}

/** Default project-local canonical procedure directory (absolute). */
export function defaultProjectProceduresDir(projectRoot: string): string {
  return join(resolve(projectRoot), PROJECT_PROCEDURES_DIR_REL);
}

/** Derive verified harness roots consistent with the v1 fixture project. */
export function derivePropagationHarnessRoots(projectRoot: string): PropagationHarnessRoots {
  const root = resolve(projectRoot);
  return {
    projectRoot: root,
    claudeCodeBasePath: join(root, ".claude", "skills"),
  };
}

export function parseVerifiedHarnessTargets(
  raw: string | string[] | undefined
): VerifiedHarnessTarget[] | { error: string } {
  if (raw === undefined) {
    return [...VERIFIED_HARNESS_TARGETS];
  }

  const tokens = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (tokens.length === 0) {
    return { error: "At least one verified harness target is required." };
  }

  const invalid = tokens.filter((token) => !VERIFIED_HARNESS_SET.has(token));
  if (invalid.length > 0) {
    return {
      error: `Unknown harness target(s): ${invalid.join(", ")}. Verified: ${VERIFIED_HARNESS_TARGETS.join(", ")}.`,
    };
  }

  return tokens as VerifiedHarnessTarget[];
}

async function loadProcedureRegistryFromDirectory(dir: string): Promise<ProcedureRegistry> {
  const registry = new ProcedureRegistry();

  if (!existsSync(dir)) {
    return registry;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".json") && !entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) {
      continue;
    }

    const rawText = await readFile(join(dir, entry.name), "utf8");
    const parsed = entry.name.endsWith(".json") ? JSON.parse(rawText) : yaml.load(rawText);
    const validated = safeParseCanonicalProcedure(parsed);
    if (!validated.success) {
      throw new Error(`Invalid procedure in ${entry.name}: ${validated.error}`);
    }
    registry.register(validated.procedure);
  }

  return registry;
}

/** Propagate canonical registry procedures to selected verified harness targets. */
export async function runAmpPropagate(
  options: AmpPropagateOptions = {}
): Promise<AmpPropagateResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const parsedTargets = parseVerifiedHarnessTargets(options.targets);

  if ("error" in parsedTargets) {
    return {
      projectRoot,
      targets: [],
      registryProcedureCount: 0,
      proceduresDir: defaultProjectProceduresDir(projectRoot),
      propagation: { writes: [], unsupportedTargets: [] },
      ok: false,
      error: parsedTargets.error,
    };
  }

  const configPath = projectConfigPath(projectRoot, { env });
  if (!existsSync(configPath)) {
    return {
      projectRoot,
      targets: parsedTargets,
      registryProcedureCount: 0,
      proceduresDir: defaultProjectProceduresDir(projectRoot),
      propagation: { writes: [], unsupportedTargets: [] },
      ok: false,
      error: `Project AMP config not found at ${configPath}. Run \`amp init\` first.`,
    };
  }

  discoverAmpConfig({
    projectRoot,
    env: {
      ...env,
      [AMP_USER_CONFIG_PATH_ENV]:
        env[AMP_USER_CONFIG_PATH_ENV] ?? join(projectRoot, ".amp", "missing-user-config.yaml"),
    },
    platform: options.platform,
    homedir: options.homedir ?? (() => join(projectRoot, "home")),
  });

  const proceduresDir = defaultProjectProceduresDir(projectRoot);
  const registry =
    options.registry ?? (await loadProcedureRegistryFromDirectory(proceduresDir));
  const propagation = await propagateProcedures({
    registry,
    roots: derivePropagationHarnessRoots(projectRoot),
    targets: parsedTargets,
    syncedAt: options.syncedAt,
  });

  const ok =
    !propagation.writes.some((record) => record.status === "failed");

  return {
    projectRoot,
    targets: parsedTargets,
    registryProcedureCount: registry.list().length,
    proceduresDir,
    propagation,
    ok,
  };
}

/** Human-readable propagate report lines for CLI and tests. */
export function formatAmpPropagateReport(result: AmpPropagateResult): string[] {
  const lines: string[] = [`AMP propagate - ${result.projectRoot}`, ""];

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
    lines.push("");
    lines.push("ERROR Propagation did not run.");
    return lines;
  }

  lines.push(`  INFO targets: ${result.targets.join(", ")}`);
  lines.push(`  INFO registry: ${result.registryProcedureCount} procedure(s) from ${result.proceduresDir}`);

  if (result.registryProcedureCount === 0) {
    lines.push(
      "  WARN No procedures loaded - add canonical procedure files under .amp/procedures/."
    );
  }

  for (const unsupported of result.propagation.unsupportedTargets) {
    lines.push(
      `  WARN [unsupported] ${unsupported.procedureName} -> ${unsupported.harness}: ${unsupported.reason}`
    );
  }

  for (const write of result.propagation.writes) {
    if (write.status === "written") {
      lines.push(
        `  OK [written] ${write.procedureName} -> ${write.harness}: ${write.outputPath}`
      );
      continue;
    }

    if (write.status === "skipped") {
      lines.push(
        `  INFO [skipped] ${write.procedureName} -> ${write.harness}: ${write.message ?? "skipped"}`
      );
      continue;
    }

    lines.push(
      `  ERROR [failed] ${write.procedureName} -> ${write.harness}: ${write.message ?? "failed"}`
    );
  }

  const written = result.propagation.writes.filter(
    (record) => record.status === "written"
  ).length;
  const skipped = result.propagation.writes.filter(
    (record) => record.status === "skipped"
  ).length;
  const failed = result.propagation.writes.filter(
    (record) => record.status === "failed"
  ).length;
  const unsupported = result.propagation.unsupportedTargets.length;

  lines.push("");
  lines.push(
    `Summary: ${written} written, ${skipped} skipped, ${failed} failed, ${unsupported} unsupported declaration(s).`
  );

  if (result.ok) {
    lines.push("OK Propagation finished.");
  } else {
    lines.push("ERROR Propagation finished with failures.");
  }

  return lines;
}
