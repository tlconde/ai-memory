/**
 * `amp projection render` — plan projection artifact writes via materialization pipeline.
 *
 * Falsifiable claim: config discovery plus materializeProjections reports canonical
 * paths in dry-run without disk writes; apply requires explicit local source + apply.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import type { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { projectConfigPath } from "../config/paths.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "./knowledge-backend.js";
import { resolveCliProjectContext } from "./cli-context.js";
import {
  createProjectionRenderSource,
  materializeProjectionRenderSource,
  type AmpProjectionSourceKind,
} from "./projection-source.js";
import type { EvaluateProjectionBudgetResult, ProjectionWriteResult } from "../projection/index.js";

export type { AmpProjectionSourceKind };

export interface AmpProjectionRenderOptions {
  projectRoot?: string;
  dryRun?: boolean;
  apply?: boolean;
  source?: AmpProjectionSourceKind;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  /** Inject in-memory knowledge for tests (consolidate + render in one process). */
  knowledgeStore?: InMemoryKnowledgeStore;
  /** Inject gbrain adapter for tests — bypasses live gbrain transport. */
  gbrainAdapter?: GbrainKnowledgeAdapter;
  /** When false, skip gbrain preflight in the projection source factory (tests only). */
  strictGbrainPreflight?: boolean;
}

export interface AmpProjectionRenderResult {
  projectRoot: string;
  projectRef?: string;
  source: AmpProjectionSourceKind;
  dryRun: boolean;
  budget?: EvaluateProjectionBudgetResult;
  writes: ProjectionWriteResult[];
  ok: boolean;
  error?: string;
  blocked?: boolean;
}

function resolveMaterializationMode(options: AmpProjectionRenderOptions): "dry-run" | "apply" {
  if (options.apply === true) {
    return "apply";
  }
  if (options.dryRun === true) {
    return "dry-run";
  }
  return "apply";
}

/** Plan or render projection artifacts through the materialization pipeline. */
export async function runAmpProjectionRender(
  options: AmpProjectionRenderOptions = {}
): Promise<AmpProjectionRenderResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const source = options.source ?? "placeholder";
  const mode = resolveMaterializationMode(options);
  const dryRun = mode === "dry-run";

  const configPath = projectConfigPath(projectRoot, { env });
  if (!existsSync(configPath)) {
    return {
      projectRoot,
      source,
      dryRun,
      writes: [],
      ok: false,
      error: `Project AMP config not found at ${configPath}. Run \`ai-memory amp init\` first.`,
    };
  }

  let projectRef: string | undefined;
  let runtimeDbPath: string;
  try {
    const context = resolveCliProjectContext({
      projectRoot,
      env,
      platform: options.platform,
      homedir: options.homedir,
    });
    projectRef = context.projectRef;
    runtimeDbPath = context.runtimeDbPath;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      projectRoot,
      source,
      dryRun,
      writes: [],
      ok: false,
      error: `AMP config discovery failed: ${message}`,
    };
  }

  const resolvedSource = createProjectionRenderSource({
    sourceKind: source,
    projectRef,
    runtimeDbPath,
    knowledgeStore: options.knowledgeStore,
    gbrainAdapter: options.gbrainAdapter,
    strictGbrainPreflight: options.strictGbrainPreflight,
    env,
  });

  if ("error" in resolvedSource) {
    return {
      projectRoot,
      projectRef,
      source,
      dryRun,
      writes: [],
      ok: false,
      error: resolvedSource.error,
    };
  }

  const plan = await materializeProjectionRenderSource(resolvedSource, {
    projectRoot,
    mode,
    projectRef,
    env,
    homedir: options.homedir,
  });

  return {
    projectRoot: plan.projectRoot,
    projectRef: plan.projectRef,
    source,
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
  const lines: string[] = [
    `AMP projection render (${mode}, source=${result.source}) - ${result.projectRoot}`,
    "",
  ];

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

export { AMP_KNOWLEDGE_BACKEND_ENV };
