/**
 * `amp gbrain-preflight` — thin CLI orchestrator for read-only operator checks.
 */

import { spawnSync } from "node:child_process";

import type { AmpDoctorFinding } from "./doctor.js";
import {
  collectGbrainPreflightChecks,
  type GbrainPreflightSpawnFn,
} from "./checks/gbrain-preflight.js";
import type { AmpKnowledgeBackend } from "./knowledge-backend.js";

export type AmpGbrainPreflightFinding = AmpDoctorFinding;

export interface AmpGbrainPreflightOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  knowledge?: string;
  confirmLiveGbrainWrite?: boolean;
  spawnFn?: GbrainPreflightSpawnFn;
}

export interface AmpGbrainPreflightResult {
  projectRoot: string;
  resolvedBackend: AmpKnowledgeBackend;
  findings: AmpGbrainPreflightFinding[];
  ok: boolean;
}

/** Run read-only gbrain preflight checks for operator testing. */
export function runAmpGbrainPreflight(
  options: AmpGbrainPreflightOptions = {}
): AmpGbrainPreflightResult {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checks = collectGbrainPreflightChecks({
    env: options.env,
    knowledge: options.knowledge,
    confirmLiveGbrainWrite: options.confirmLiveGbrainWrite,
    spawnFn: options.spawnFn ?? spawnSync,
  });

  return {
    projectRoot,
    resolvedBackend: checks.resolvedBackend,
    findings: checks.findings,
    ok: checks.ok,
  };
}

const LEVEL_PREFIX: Record<AmpGbrainPreflightFinding["level"], string> = {
  ok: "OK",
  info: "INFO",
  warning: "WARN",
  error: "ERROR",
};

/** Human-readable preflight report lines for CLI and tests. */
export function formatAmpGbrainPreflightReport(result: AmpGbrainPreflightResult): string[] {
  const lines = [
    `AMP gbrain preflight — ${result.projectRoot}`,
    `  backend: ${result.resolvedBackend}`,
    "",
  ];

  for (const item of result.findings) {
    lines.push(`  ${LEVEL_PREFIX[item.level]} [${item.category}] ${item.message}`);
  }

  lines.push("");
  if (result.ok) {
    lines.push("OK Preflight complete — review WARN items before live mutation.");
  } else {
    lines.push("ERROR Preflight found blocking errors.");
  }

  return lines;
}
