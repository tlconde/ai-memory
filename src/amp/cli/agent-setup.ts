/**
 * `amp agent setup` — wire materialized projections into local agent surfaces.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  runClaudeCodeProjectSetup,
  runCursorProjectSetup,
  type AgentSetupMode,
  type AgentSetupResult,
  type AgentSetupTarget,
} from "../agent-setup/index.js";
import { projectConfigPath } from "../config/paths.js";

export type AmpAgentSetupTarget = AgentSetupTarget;

export interface AmpAgentSetupOptions {
  projectRoot?: string;
  target: AmpAgentSetupTarget;
  dryRun?: boolean;
  apply?: boolean;
}

export interface AmpAgentSetupResult extends AgentSetupResult {
  projectRoot: string;
}

function resolveMode(options: AmpAgentSetupOptions): AgentSetupMode {
  if (options.apply === true) {
    return "apply";
  }
  return "dry-run";
}

/** Plan or apply local agent-access setup for the requested target. */
export async function runAmpAgentSetup(
  options: AmpAgentSetupOptions
): Promise<AmpAgentSetupResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const mode = resolveMode(options);
  const configPath = projectConfigPath(projectRoot);

  if (!existsSync(configPath)) {
    return {
      projectRoot,
      target: options.target,
      mode,
      plannedPaths: [],
      changed: false,
      ok: false,
      warnings: [],
      errors: [
        `Project AMP config not found at ${configPath}. Run \`ai-memory amp init\` first.`,
      ],
    };
  }

  const setupOptions = { projectRoot, mode };
  const result =
    options.target === "claude-code"
      ? await runClaudeCodeProjectSetup(setupOptions)
      : await runCursorProjectSetup(setupOptions);

  return { projectRoot, ...result };
}

/** Human-readable agent setup report lines. */
export function formatAmpAgentSetupReport(result: AmpAgentSetupResult): string[] {
  const lines: string[] = [
    `AMP agent setup (${result.mode}, target=${result.target}) - ${result.projectRoot}`,
    "",
  ];

  for (const warning of result.warnings) {
    lines.push(`  WARN ${warning}`);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      lines.push(`  ERROR ${error}`);
    }
    lines.push("");
    lines.push("ERROR Agent setup did not complete.");
    return lines;
  }

  lines.push("Planned paths:");
  for (const path of result.plannedPaths) {
    lines.push(`  ${path}`);
  }
  lines.push("");

  if (result.mode === "dry-run") {
    lines.push(
      result.changed
        ? "OK Agent setup dry-run finished; no files were written."
        : "OK Agent setup dry-run finished; no changes needed."
    );
  } else {
    lines.push(
      result.changed
        ? "OK Agent setup finished."
        : "OK Agent setup finished; no changes needed."
    );
  }

  return lines;
}

export function isAmpAgentSetupTarget(value: string): value is AmpAgentSetupTarget {
  return value === "claude-code" || value === "cursor";
}
