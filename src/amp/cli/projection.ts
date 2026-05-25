/**
 * `amp projection render` — plan projection artifact writes via materialization pipeline.
 *
 * Falsifiable claim: config discovery plus materializeProjections reports canonical
 * paths in dry-run without disk writes; apply fails safely when source refuses apply.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { discoverAmpConfig } from "../config/discovery.js";
import { AMP_USER_CONFIG_PATH_ENV, projectConfigPath } from "../config/paths.js";
import {
  materializeProjections,
  PlaceholderProjectionSource,
  type EvaluateProjectionBudgetResult,
  type ProjectionWriteResult,
} from "../projection/index.js";

export interface AmpProjectionRenderOptions {
  projectRoot?: string;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

export interface AmpProjectionRenderResult {
  projectRoot: string;
  projectRef?: string;
  dryRun: boolean;
  budget?: EvaluateProjectionBudgetResult;
  writes: ProjectionWriteResult[];
  ok: boolean;
  error?: string;
  blocked?: boolean;
}

/** Plan or render projection artifacts through the materialization pipeline. */
export async function runAmpProjectionRender(
  options: AmpProjectionRenderOptions = {}
): Promise<AmpProjectionRenderResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const dryRun = options.dryRun === true;
  const mode = dryRun ? "dry-run" : "apply";

  const configPath = projectConfigPath(projectRoot, { env });
  if (!existsSync(configPath)) {
    return {
      projectRoot,
      dryRun,
      writes: [],
      ok: false,
      error: `Project AMP config not found at ${configPath}. Run \`amp init\` first.`,
    };
  }

  let projectRef: string | undefined;
  try {
    const discovered = discoverAmpConfig({
      projectRoot,
      env: {
        ...env,
        [AMP_USER_CONFIG_PATH_ENV]:
          env[AMP_USER_CONFIG_PATH_ENV] ?? join(projectRoot, ".amp", "missing-user-config.yaml"),
      },
      platform: options.platform,
      homedir: options.homedir ?? (() => join(projectRoot, "home")),
    });
    projectRef = discovered.projectRef;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      projectRoot,
      dryRun,
      writes: [],
      ok: false,
      error: `AMP config discovery failed: ${message}`,
    };
  }

  const plan = await materializeProjections(new PlaceholderProjectionSource(), {
    projectRoot,
    mode,
    projectRef,
    env,
    homedir: options.homedir,
  });

  return {
    projectRoot: plan.projectRoot,
    projectRef: plan.projectRef,
    dryRun: plan.dryRun,
    ...(plan.budget !== undefined ? { budget: plan.budget } : {}),
    writes: plan.writes,
    ok: plan.ok,
    ...(plan.error !== undefined ? { error: plan.error } : {}),
    ...(plan.blocked !== undefined ? { blocked: plan.blocked } : {}),
  };
}

/** Human-readable projection render report lines for CLI and tests. */
export function formatAmpProjectionRenderReport(result: AmpProjectionRenderResult): string[] {
  const mode = result.dryRun ? "dry-run" : "apply";
  const lines: string[] = [`AMP projection render (${mode}) - ${result.projectRoot}`, ""];

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
    lines.push("");
    if (result.blocked) {
      lines.push("ERROR Projection materialization is not available yet.");
    } else {
      lines.push(
        result.dryRun
          ? "ERROR Projection dry-run did not run."
          : "ERROR Projection materialization failed."
      );
    }
    return lines;
  }

  if (result.projectRef) {
    lines.push(`  project_ref: ${result.projectRef}`);
    lines.push("");
  }

  if (result.budget) {
    lines.push("Budget:");
    const { combined, files } = result.budget;
    lines.push(
      `  combined: ${combined.combined_count}/${combined.combined_cap} (${combined.status})`
    );
    for (const file of files) {
      lines.push(`  ${file.kind}: ${file.token_count}/${file.token_target} (${file.status})`);
    }
    lines.push("");
  }

  lines.push("Planned writes:");
  for (const write of result.writes) {
    const tag = write.dryRun ? "dry-run" : "write";
    lines.push(`  ${write.kind} -> ${write.path} (${tag}, ${write.bytes} bytes)`);
  }
  lines.push("");

  if (result.ok) {
    lines.push(
      result.dryRun
        ? "OK Projection dry-run finished; no files were written."
        : "OK Projection materialization finished."
    );
  } else if (result.budget && !result.budget.success) {
    lines.push(`ERROR ${result.budget.error}`);
  }

  return lines;
}
