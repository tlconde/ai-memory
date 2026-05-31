/**
 * `amp stack status` — read-only scaffold/control-plane rollup.
 *
 * Falsifiable claim: stack status aggregates AMP, local knowledge, GBrain,
 * Hermes, and agent wiring readiness without mutating local or live backends.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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

export interface AmpStackMapOptions extends AmpStackStatusOptions {
  /** Optional HTML output path. Omitted returns the map without writing. */
  outputPath?: string;
}

export interface AmpStackMapResult {
  ok: boolean;
  projectRoot: string;
  outputPath?: string;
  wrote: boolean;
  html: string;
  status: AmpStackStatusResult;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function componentTone(status: AmpStackComponentStatus): string {
  switch (status) {
    case "ready":
      return "ready";
    case "needs_action":
      return "needs-action";
    case "blocked":
      return "blocked";
    case "info":
      return "info";
  }
}

/** Render a self-contained visual HTML map for the scaffold/control-plane status. */
export function renderAmpStackMapHtml(status: AmpStackStatusResult): string {
  const componentCards = status.components
    .map((component) => {
      const tone = componentTone(component.status);
      const nextAction = component.nextAction
        ? `<p class="next"><span>Next</span>${escapeHtml(component.nextAction)}</p>`
        : "";
      return `
        <article class="component ${tone}">
          <div class="component-topline">
            <span class="status">${escapeHtml(STATUS_LABEL[component.status])}</span>
            <span class="id">${escapeHtml(component.id)}</span>
          </div>
          <h2>${escapeHtml(component.label)}</h2>
          <p>${escapeHtml(component.summary)}</p>
          ${nextAction}
        </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AMP Stack Map</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17201b;
      --muted: #5d665f;
      --line: #ccd8d0;
      --panel: #ffffff;
      --canvas: #f4f7f2;
      --ready: #1f7a4d;
      --action: #9a6400;
      --blocked: #b3261e;
      --info: #356b9f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--canvas);
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 40px;
    }
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 20px;
      align-items: end;
      padding-bottom: 22px;
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 34px;
      line-height: 1.05;
      letter-spacing: 0;
    }
    .sub {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.5;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(72px, 1fr));
      gap: 8px;
      min-width: 360px;
    }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
    }
    .metric strong {
      display: block;
      font-size: 24px;
      line-height: 1;
    }
    .metric span {
      display: block;
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .map {
      position: relative;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-top: 24px;
    }
    .component {
      min-height: 190px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-top: 5px solid var(--info);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 2px rgba(23, 32, 27, 0.06);
    }
    .component.ready { border-top-color: var(--ready); }
    .component.needs-action { border-top-color: var(--action); }
    .component.blocked { border-top-color: var(--blocked); }
    .component.info { border-top-color: var(--info); }
    .component-topline {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      margin-bottom: 14px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .status {
      font-weight: 700;
    }
    .id {
      overflow-wrap: anywhere;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 19px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }
    .next {
      margin-top: 16px;
      color: var(--ink);
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }
    .next span {
      display: block;
      margin-bottom: 5px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    footer {
      margin-top: 24px;
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 760px) {
      header {
        grid-template-columns: 1fr;
      }
      .summary {
        min-width: 0;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      h1 {
        font-size: 28px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>AMP Stack Map</h1>
        <p class="sub">${escapeHtml(status.role)} / ${escapeHtml(status.mode)}<br>${escapeHtml(status.projectRoot)}</p>
      </div>
      <section class="summary" aria-label="Stack summary">
        <div class="metric"><strong>${status.readyCount}</strong><span>ready</span></div>
        <div class="metric"><strong>${status.needsActionCount}</strong><span>action</span></div>
        <div class="metric"><strong>${status.blockedCount}</strong><span>blocked</span></div>
        <div class="metric"><strong>${status.infoCount}</strong><span>info</span></div>
      </section>
    </header>
    <section class="map" aria-label="AMP scaffold components">
      ${componentCards}
    </section>
    <footer>Generated by amp stack map. This view is read-only and uses the same checks as amp stack status.</footer>
  </main>
</body>
</html>
`;
}

/** Build a read-only stack map, optionally writing the rendered HTML to disk. */
export function runAmpStackMap(options: AmpStackMapOptions = {}): AmpStackMapResult {
  const status = runAmpStackStatus(options);
  const html = renderAmpStackMapHtml(status);
  const outputPath = options.outputPath ? resolve(options.outputPath) : undefined;

  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, html, "utf8");
  }

  return {
    ok: status.ok,
    projectRoot: status.projectRoot,
    outputPath,
    wrote: outputPath !== undefined,
    html,
    status,
    error: status.error,
  };
}

/** JSON payload for `amp stack map --json`. */
export function formatAmpStackMapJson(result: AmpStackMapResult): string {
  return JSON.stringify(
    {
      ok: result.ok,
      projectRoot: result.projectRoot,
      outputPath: result.outputPath ?? null,
      wrote: result.wrote,
      status: result.status,
      error: result.error ?? null,
    },
    null,
    2
  );
}

/** Human-readable stack map report lines. */
export function formatAmpStackMapReport(result: AmpStackMapResult): string[] {
  if (!result.outputPath) {
    return [result.html];
  }

  const lines = [
    `AMP stack map - ${result.projectRoot}`,
    "",
    `  mode: ${result.status.mode}`,
    `  components: ${result.status.components.length}`,
    `  wrote: ${result.wrote}`,
  ];

  if (result.outputPath) {
    lines.push(`  output: ${result.outputPath}`);
  }

  lines.push("");
  if (result.ok) {
    lines.push("OK Stack map generated.");
  } else {
    lines.push(`ERROR ${result.error ?? "Stack map generated with blocking setup checks."}`);
  }

  return lines;
}
