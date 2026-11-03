/**
 * `amp stack setup apply` — explicit local scaffold bootstrap.
 *
 * Falsifiable claim: apply only runs AMP-local setup steps (init, local
 * projection materialization, and agent setup). It never installs GBrain/Hermes
 * or connects to live GBrain.
 */

import { resolve } from "node:path";

import {
  isAmpAgentSetupTarget,
  runAmpAgentSetup,
  type AmpAgentSetupResult,
  type AmpAgentSetupTarget,
} from "./agent-setup.js";
import { runAmpInit, type AmpInitResult } from "./init.js";
import {
  runAmpProjectionRender,
  type AmpProjectionRenderResult,
} from "./projection.js";

export type AmpStackSetupApplyTarget = AmpAgentSetupTarget | "all";

export interface AmpStackSetupApplyOptions {
  projectRoot?: string;
  target?: AmpStackSetupApplyTarget;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

export interface AmpStackSetupApplyResult {
  ok: boolean;
  projectRoot: string;
  target: AmpStackSetupApplyTarget;
  init?: AmpInitResult;
  projection?: AmpProjectionRenderResult;
  agents: AmpAgentSetupResult[];
  changed: boolean;
  error?: string;
}

const ALL_AGENT_TARGETS: readonly AmpAgentSetupTarget[] = [
  "claude-code",
  "cursor",
  "codex",
];

export function isAmpStackSetupApplyTarget(value: string): value is AmpStackSetupApplyTarget {
  return value === "all" || isAmpAgentSetupTarget(value);
}

function resolveAgentTargets(target: AmpStackSetupApplyTarget): readonly AmpAgentSetupTarget[] {
  return target === "all" ? ALL_AGENT_TARGETS : [target];
}

function initChanged(result: AmpInitResult): boolean {
  return (
    result.configCreated ||
    result.runtimeDirCreated ||
    result.localDirCreated ||
    result.gitignoreCreated ||
    result.gitignoreEntriesAdded.length > 0
  );
}

function summarizeApplyError(ctx: {
  projection?: AmpProjectionRenderResult;
  agents: readonly AmpAgentSetupResult[];
}): string | undefined {
  if (!ctx.projection) {
    return undefined;
  }
  if (!ctx.projection.ok) {
    return ctx.projection.error ?? "Projection materialization failed.";
  }

  const failedAgent = ctx.agents.find((agent) => !agent.ok);
  if (failedAgent) {
    return failedAgent.errors[0] ?? `Agent setup failed for ${failedAgent.target}.`;
  }

  return undefined;
}

/** Apply the safe local AMP scaffold setup chain. */
export async function runAmpStackSetupApply(
  options: AmpStackSetupApplyOptions = {}
): Promise<AmpStackSetupApplyResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const target = options.target ?? "all";
  if (!isAmpStackSetupApplyTarget(target)) {
    return {
      ok: false,
      projectRoot,
      target: "all",
      agents: [],
      changed: false,
      error: `Invalid stack setup target: ${String(target)}`,
    };
  }

  const init = await runAmpInit({ projectRoot, env: options.env });
  const projection = await runAmpProjectionRender({
    projectRoot,
    env: options.env,
    platform: options.platform,
    homedir: options.homedir,
    source: "local",
    apply: true,
  });

  const agents: AmpAgentSetupResult[] = [];
  if (projection.ok) {
    for (const agentTarget of resolveAgentTargets(target)) {
      agents.push(
        await runAmpAgentSetup({
          projectRoot,
          target: agentTarget,
          apply: true,
        })
      );
    }
  }

  const error = summarizeApplyError({ projection, agents });
  return {
    ok: error === undefined,
    projectRoot,
    target,
    init,
    projection,
    agents,
    changed:
      initChanged(init) ||
      projection.writes.some((write) => write.wrote) ||
      agents.some((agent) => agent.changed),
    ...(error !== undefined ? { error } : {}),
  };
}

/** JSON payload for `amp stack setup apply --json`. */
export function formatAmpStackSetupApplyJson(result: AmpStackSetupApplyResult): string {
  return JSON.stringify({ ...result, error: result.error ?? null }, null, 2);
}

/** Human-readable stack setup apply report lines. */
export function formatAmpStackSetupApplyReport(result: AmpStackSetupApplyResult): string[] {
  const lines = [
    `AMP stack setup apply - ${result.projectRoot}`,
    "",
    `  target: ${result.target}`,
    `  changed: ${result.changed}`,
    "  liveGbrainTouched: false",
    "  externalInstalls: false",
    "",
    "Steps:",
  ];

  if (result.init) {
    lines.push(`  ${result.init.configCreated ? "WRITE" : "OK"} init: ${result.init.configPath}`);
  } else {
    lines.push("  SKIP init: not run");
  }

  if (result.projection) {
    lines.push(
      `  ${result.projection.ok ? "WRITE" : "ERROR"} projection: ${result.projection.writes.length} planned writes`
    );
  } else {
    lines.push("  SKIP projection: not run");
  }

  for (const agent of result.agents) {
    lines.push(
      `  ${agent.ok ? "WRITE" : "ERROR"} agent ${agent.target}: ${agent.plannedPaths.length} paths`
    );
    for (const warning of agent.warnings) {
      lines.push(`    WARN ${warning}`);
    }
    for (const error of agent.errors) {
      lines.push(`    ERROR ${error}`);
    }
  }

  lines.push("");
  if (result.ok) {
    lines.push("OK Stack setup apply finished.");
  } else {
    lines.push(`ERROR ${result.error ?? "Stack setup apply failed."}`);
  }

  return lines;
}
