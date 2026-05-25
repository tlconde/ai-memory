/**
 * `amp projection render` — plan projection artifact writes via placeholder fixtures.
 *
 * Falsifiable claim: dry-run evaluates budgets and reports canonical paths without
 * DB materialization or disk writes.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { discoverAmpConfig } from "../config/discovery.js";
import { AMP_USER_CONFIG_PATH_ENV, projectConfigPath } from "../config/paths.js";
import {
  PROJECTION_FILE_KINDS,
  createProjectionDocument,
  evaluateProjectionBudget,
  writeProjectionFiles,
  type EvaluateProjectionBudgetResult,
  type ProjectionWriteResult,
} from "../projection/index.js";

export const PROJECTION_MATERIALIZATION_BLOCKED_MESSAGE =
  "projection materialization from DB is not wired until AMP-PROJ-14";

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
  budget: EvaluateProjectionBudgetResult;
  writes: ProjectionWriteResult[];
  ok: boolean;
  error?: string;
}

function emptyBudgetResult(): EvaluateProjectionBudgetResult {
  return {
    success: true,
    files: [],
    combined: {
      combined_cap: 0,
      combined_count: 0,
      hard_cap: 0,
      status: "ok",
    },
  };
}

function buildPlaceholderDocuments(projectRef: string | undefined) {
  return PROJECTION_FILE_KINDS.map((kind) =>
    createProjectionDocument({
      kind,
      ...(kind.startsWith("project_") ? { project_ref: projectRef ?? "project" } : {}),
    })
  );
}

/** Plan or render projection artifacts from placeholder fixtures. */
export async function runAmpProjectionRender(
  options: AmpProjectionRenderOptions = {}
): Promise<AmpProjectionRenderResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const dryRun = options.dryRun === true;

  if (!dryRun) {
    return {
      projectRoot,
      dryRun: false,
      budget: emptyBudgetResult(),
      writes: [],
      ok: false,
      error: PROJECTION_MATERIALIZATION_BLOCKED_MESSAGE,
    };
  }

  const configPath = projectConfigPath(projectRoot, { env });
  if (!existsSync(configPath)) {
    return {
      projectRoot,
      dryRun: true,
      budget: emptyBudgetResult(),
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
      dryRun: true,
      budget: emptyBudgetResult(),
      writes: [],
      ok: false,
      error: `AMP config discovery failed: ${message}`,
    };
  }

  const documents = buildPlaceholderDocuments(projectRef);
  const budget = evaluateProjectionBudget(documents);
  const writes = await writeProjectionFiles(documents, {
    projectRoot,
    dryRun: true,
    env,
    homedir: options.homedir,
  });

  return {
    projectRoot,
    projectRef,
    dryRun: true,
    budget,
    writes,
    ok: budget.success,
  };
}

/** Human-readable projection render report lines for CLI and tests. */
export function formatAmpProjectionRenderReport(result: AmpProjectionRenderResult): string[] {
  const mode = result.dryRun ? "dry-run" : "apply";
  const lines: string[] = [`AMP projection render (${mode}) - ${result.projectRoot}`, ""];

  if (result.error) {
    lines.push(`  ERROR ${result.error}`);
    lines.push("");
    lines.push(
      result.dryRun
        ? "ERROR Projection dry-run did not run."
        : "ERROR Projection materialization is not available yet."
    );
    return lines;
  }

  if (result.projectRef) {
    lines.push(`  project_ref: ${result.projectRef}`);
    lines.push("");
  }

  lines.push("Budget:");
  const { combined, files } = result.budget;
  lines.push(
    `  combined: ${combined.combined_count}/${combined.combined_cap} (${combined.status})`
  );
  for (const file of files) {
    lines.push(`  ${file.kind}: ${file.token_count}/${file.token_target} (${file.status})`);
  }
  lines.push("");

  lines.push("Planned writes:");
  for (const write of result.writes) {
    const tag = write.dryRun ? "dry-run" : "write";
    lines.push(`  ${write.kind} -> ${write.path} (${tag}, ${write.bytes} bytes)`);
  }
  lines.push("");

  if (result.ok) {
    lines.push("OK Projection dry-run finished; no files were written.");
  } else if (!result.budget.success) {
    lines.push(`ERROR ${result.budget.error}`);
  }

  return lines;
}
