/**
 * `amp optimize` — offline skill optimization cron entrypoint (AMP §4.5).
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { discoverAmpConfig } from "../config/discovery.js";
import { AMP_USER_CONFIG_PATH_ENV, projectConfigPath } from "../config/paths.js";
import { createPropagationHarnessWriters, loadProcedureRegistryFromDirectory, defaultProjectProceduresDir } from "./propagate.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { RuntimeStoreSemanticEntityReader } from "../runtime-semantics/storage-source.js";
import {
  listSkillsWithCorpusEntries,
  runOptimizationCycle,
  type RunOptimizationCycleResult,
} from "../substrate/optimization/loop.js";

export interface AmpOptimizeOptions {
  projectRoot?: string;
  dryRun?: boolean;
  verbose?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface AmpOptimizeResult extends RunOptimizationCycleResult {
  projectRoot: string;
  skillsConsidered: string[];
}

/** Run optimization for all skills with correction corpus entries. */
export async function runAmpOptimize(options: AmpOptimizeOptions = {}): Promise<AmpOptimizeResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const configPath = projectConfigPath(projectRoot, { env });

  if (!existsSync(configPath)) {
    return {
      ok: false,
      projectRoot,
      skillsConsidered: [],
      outcomes: [],
      proposedCount: 0,
      acceptedCount: 0,
      silent: false,
      error: `Project AMP config not found at ${configPath}. Run \`amp init\` first.`,
    };
  }

  const discovered = discoverAmpConfig({
    projectRoot,
    env: {
      ...env,
      [AMP_USER_CONFIG_PATH_ENV]:
        env[AMP_USER_CONFIG_PATH_ENV] ?? join(projectRoot, ".amp", "missing-user-config.yaml"),
    },
  });

  const proceduresDir = defaultProjectProceduresDir(projectRoot);
  const registry = await loadProcedureRegistryFromDirectory(proceduresDir);
  const runtimeDbPath = discovered.runtime.dbPath;
  const runtimeRecords =
    runtimeDbPath && existsSync(runtimeDbPath)
      ? new RuntimeStoreSemanticEntityReader(new RuntimeStore({ dbPath: runtimeDbPath })).readEntities()
      : [];

  const skills = listSkillsWithCorpusEntries(runtimeRecords);
  if (skills.length === 0) {
    return {
      ok: true,
      projectRoot,
      skillsConsidered: [],
      outcomes: [],
      proposedCount: 0,
      acceptedCount: 0,
      silent: true,
    };
  }

  const writers = options.dryRun ? undefined : createPropagationHarnessWriters(projectRoot);
  let runtime: RuntimeStore | undefined;
  if (!options.dryRun && runtimeDbPath && existsSync(runtimeDbPath)) {
    runtime = new RuntimeStore({ dbPath: runtimeDbPath });
  }

  try {
    let proposedCount = 0;
    let acceptedCount = 0;
    const outcomes = [];

    for (const skillName of skills) {
      const result = await runOptimizationCycle({
        skillName,
        registry,
        runtime,
        writers,
        runtimeRecords,
        dryRun: options.dryRun ?? false,
        projectRef: discovered.projectRef,
      });
      proposedCount += result.proposedCount;
      acceptedCount += result.acceptedCount;
      outcomes.push(...result.outcomes);
      if (!result.ok) {
        return {
          ...result,
          projectRoot,
          skillsConsidered: skills,
        };
      }
    }

    return {
      ok: true,
      projectRoot,
      skillsConsidered: skills,
      outcomes,
      proposedCount,
      acceptedCount,
      silent: proposedCount === 0,
    };
  } finally {
    runtime?.close();
  }
}

export function formatAmpOptimizeReport(result: AmpOptimizeResult, verbose = false): string[] {
  if (!verbose && result.silent) {
    return [];
  }

  const lines = [`AMP optimize - ${result.projectRoot}`, ""];

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
    return lines;
  }

  lines.push(`  INFO skills considered: ${result.skillsConsidered.length}`);
  lines.push(`  INFO proposed: ${result.proposedCount}; accepted: ${result.acceptedCount}`);

  if (verbose) {
    for (const outcome of result.outcomes) {
      lines.push(
        `  INFO ${outcome.skillName}: proposed=${outcome.proposed} accepted=${outcome.accepted} score=${outcome.finalScore}`
      );
      if (outcome.reject_reason) {
        lines.push(`  WARN reject_reason: ${outcome.reject_reason}`);
      }
    }
  }

  lines.push("");
  lines.push(result.ok ? "OK Optimization finished." : "ERROR Optimization failed.");
  return lines;
}
