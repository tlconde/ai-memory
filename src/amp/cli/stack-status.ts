/**
 * `amp stack status` — read-only scaffold/control-plane rollup.
 *
 * Falsifiable claim: stack status aggregates AMP, local knowledge, GBrain,
 * Hermes, and agent wiring readiness without mutating local or live backends.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
  runAmpDoctor,
  type AmpDoctorFinding,
  type AmpDoctorOptions,
} from "./doctor.js";
import {
  runAmpGbrainPreflight,
  type AmpGbrainPreflightOptions,
} from "./gbrain-preflight.js";
import type { GbrainPreflightSpawnFn } from "./checks/gbrain-preflight.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";
import { resolveAmpRuntimeCliBootstrap } from "./runtime-cli-bootstrap.js";

export type AmpStackComponentStatus = "ready" | "needs_action" | "blocked" | "info";

export interface AmpStackStatusComponent {
  id: string;
  label: string;
  status: AmpStackComponentStatus;
  summary: string;
  nextAction?: string;
}

export interface AmpStackStatusOptions extends AmpDoctorOptions {
  /** Inject gbrain process probes for tests. */
  gbrainSpawnFn?: GbrainPreflightSpawnFn;
  /** Optional knowledge backend label for gbrain preflight parity. */
  knowledge?: string;
}

export interface AmpStackStatusResult {
  ok: boolean;
  role: "scaffold-control-plane";
  mode: "read-only";
  projectRoot: string;
  components: AmpStackStatusComponent[];
  readyCount: number;
  needsActionCount: number;
  blockedCount: number;
  infoCount: number;
  error?: string;
}

const STATUS_LABEL: Record<AmpStackComponentStatus, string> = {
  ready: "READY",
  needs_action: "NEEDS_ACTION",
  blocked: "BLOCKED",
  info: "INFO",
};

function statusFromFindings(findings: readonly AmpDoctorFinding[]): AmpStackComponentStatus {
  if (findings.some((finding) => finding.level === "error")) {
    return "blocked";
  }
  if (findings.some((finding) => finding.level === "warning")) {
    return "needs_action";
  }
  if (findings.some((finding) => finding.level === "ok")) {
    return "ready";
  }
  return "info";
}

function firstActionableFinding(
  findings: readonly AmpDoctorFinding[]
): AmpDoctorFinding | undefined {
  return (
    findings.find((finding) => finding.level === "error") ??
    findings.find((finding) => finding.level === "warning") ??
    findings.find((finding) => finding.level === "info")
  );
}

function summarizeFindings(
  findings: readonly AmpDoctorFinding[],
  emptySummary: string
): string {
  if (findings.length === 0) {
    return emptySummary;
  }

  const counts = {
    ok: findings.filter((finding) => finding.level === "ok").length,
    info: findings.filter((finding) => finding.level === "info").length,
    warning: findings.filter((finding) => finding.level === "warning").length,
    error: findings.filter((finding) => finding.level === "error").length,
  };

  return `${counts.ok} ok, ${counts.info} info, ${counts.warning} warning, ${counts.error} error`;
}

function componentFromFindings(ctx: {
  id: string;
  label: string;
  findings: readonly AmpDoctorFinding[];
  emptySummary: string;
  fallbackNextAction?: string;
}): AmpStackStatusComponent {
  const actionable = firstActionableFinding(ctx.findings);
  return {
    id: ctx.id,
    label: ctx.label,
    status: statusFromFindings(ctx.findings),
    summary: summarizeFindings(ctx.findings, ctx.emptySummary),
    nextAction: actionable?.message ?? ctx.fallbackNextAction,
  };
}

function countComponents(
  components: readonly AmpStackStatusComponent[],
  status: AmpStackComponentStatus
): number {
  return components.filter((component) => component.status === status).length;
}

/** Run a read-only scaffold/control-plane status rollup. */
export function runAmpStackStatus(
  options: AmpStackStatusOptions = {}
): AmpStackStatusResult {
  const doctor = runAmpDoctor({ ...options, includeDogfoodReady: false });
  const bootstrap = resolveAmpRuntimeCliBootstrap({
    projectRoot: options.projectRoot,
    env: options.env,
    platform: options.platform,
    homedir: options.homedir,
  });
  const gbrain = runAmpGbrainPreflight({
    projectRoot: options.projectRoot,
    env: options.env,
    knowledge: options.knowledge,
    spawnFn: options.gbrainSpawnFn ?? spawnSync,
  } satisfies AmpGbrainPreflightOptions);

  const components: AmpStackStatusComponent[] = [];

  components.push(
    componentFromFindings({
      id: "amp-doctor",
      label: "AMP doctor",
      findings: doctor.findings,
      emptySummary: "No doctor findings.",
      fallbackNextAction: "Run `amp doctor` for detailed checks.",
    })
  );

  if (!bootstrap.ok) {
    components.push({
      id: "local-knowledge",
      label: "Local knowledge",
      status: "blocked",
      summary: bootstrap.error,
      nextAction: "Run `amp init`, then `amp knowledge status`.",
    });
  } else if (existsSync(resolveLocalKnowledgeDbPath(bootstrap.runtimeDbPath))) {
    components.push({
      id: "local-knowledge",
      label: "Local knowledge",
      status: "ready",
      summary: "knowledge.db exists beside runtime.db.",
      nextAction: "Use `amp knowledge status`, `amp knowledge list`, or `amp retrieve` to inspect durable memory.",
    });
  } else {
    components.push({
      id: "local-knowledge",
      label: "Local knowledge",
      status: "needs_action",
      summary: "knowledge.db has not been created yet.",
      nextAction: "Run `amp capture` + `amp consolidate`, or graduate a typed runtime preference.",
    });
  }

  components.push(
    componentFromFindings({
      id: "gbrain",
      label: "GBrain backend",
      findings: gbrain.findings,
      emptySummary: "No gbrain preflight findings.",
      fallbackNextAction: "Run `amp gbrain-preflight` before live GBrain testing.",
    })
  );

  const hermesFindings = doctor.findings.filter(
    (finding) => finding.category === "hermes-discovery"
  );
  components.push(
    componentFromFindings({
      id: "hermes",
      label: "Hermes discovery",
      findings: hermesFindings,
      emptySummary: "Hermes discovery has not reported anything.",
      fallbackNextAction: "Add project skills to Hermes `skills.external_dirs` when using Hermes.",
    })
  );

  const agentFindings = doctor.findings.filter(
    (finding) => finding.category === "agent-setup"
  );
  components.push(
    componentFromFindings({
      id: "agent-wiring",
      label: "Agent wiring",
      findings: agentFindings,
      emptySummary: "Agent setup checks require `amp init` first.",
      fallbackNextAction: "Run `amp agent setup --target claude-code|cursor|codex --dry-run`.",
    })
  );

  const blockedCount = countComponents(components, "blocked");
  const result: AmpStackStatusResult = {
    ok: blockedCount === 0,
    role: "scaffold-control-plane",
    mode: "read-only",
    projectRoot: doctor.projectRoot,
    components,
    readyCount: countComponents(components, "ready"),
    needsActionCount: countComponents(components, "needs_action"),
    blockedCount,
    infoCount: countComponents(components, "info"),
  };

  if (!result.ok) {
    result.error = "Stack status found blocking setup checks.";
  }

  return result;
}

/** Human-readable stack status report lines. */
export function formatAmpStackStatusReport(result: AmpStackStatusResult): string[] {
  const lines = [
    `AMP stack status — ${result.projectRoot}`,
    "",
    "  role: scaffold/control plane around GBrain, Hermes, agents, and local knowledge",
    `  mode: ${result.mode}`,
    `  summary: ${result.readyCount} ready, ${result.needsActionCount} needs action, ${result.blockedCount} blocked, ${result.infoCount} info`,
    "",
    "Components:",
  ];

  for (const component of result.components) {
    lines.push(
      `  ${STATUS_LABEL[component.status]} [${component.id}] ${component.label}: ${component.summary}`
    );
    if (component.nextAction) {
      lines.push(`    next: ${component.nextAction}`);
    }
  }

  lines.push("");
  if (result.ok) {
    lines.push("OK Stack status complete — no blocking setup checks.");
  } else {
    lines.push(`ERROR ${result.error ?? "Stack status found blocking setup checks."}`);
  }

  return lines;
}

/** JSON payload for `amp stack status --json`. */
export function formatAmpStackStatusJson(result: AmpStackStatusResult): string {
  return JSON.stringify({ ...result, error: result.error ?? null }, null, 2);
}
