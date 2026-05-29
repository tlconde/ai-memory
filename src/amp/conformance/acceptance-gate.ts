/**
 * AMP v1 acceptance gate — deterministic, offline proof command.
 *
 * Runs typecheck, build, full test suite, conformance runner, and CLI smoke
 * checks without live gbrain, Hermes, Cursor, Claude Code, or network access.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runDurableLocalLoopAcceptanceStep } from "./acceptance-durable-local-loop.js";
import {
  formatConformanceReport,
  runConformance,
  type ConformanceReport,
} from "./conformance-runner.js";
import { INVARIANT_IDS } from "./invariant-registry.js";

export const AMP_V1_PROVISIONAL_DISCLAIMER = [
  "PROVISIONAL/UNKNOWN (not part of v1 acceptance):",
  "  - live gbrain serve / cloud vendor memory (INV-3 deferred in vertical slice)",
  "  - live harness session checks (Cursor rule picker, Claude skill discovery, hermes -s)",
].join("\n");

export interface AcceptanceStepResult {
  step: string;
  passed: boolean;
  detail?: string;
}

export interface AcceptanceGateReport {
  projectRoot: string;
  steps: AcceptanceStepResult[];
  conformance: ConformanceReport;
  conformanceOutput: string;
  allPassed: boolean;
}

export interface AcceptanceGateOptions {
  projectRoot?: string;
  /** When true, skip typecheck/build/test (for unit tests of evaluation logic). */
  skipBuildSteps?: boolean;
  /** When true, skip durable local loop step (for unit tests of evaluation logic). */
  skipDurableLocalLoopStep?: boolean;
  runConformanceFn?: typeof runConformance;
  runNpmScriptFn?: (cwd: string, script: string) => AcceptanceStepResult;
  runDurableLocalLoopStepFn?: typeof runDurableLocalLoopAcceptanceStep;
}

function resolveRepoRoot(projectRoot?: string): string {
  if (projectRoot) {
    return resolve(projectRoot);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..");
}

function runNpmScript(cwd: string, script: string): AcceptanceStepResult {
  const result = spawnSync("npm", ["run", script], {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("\n").trim();
  const passed = result.status === 0;
  return {
    step: script,
    passed,
    detail: passed ? undefined : output || `npm run ${script} exited ${result.status ?? 1}`,
  };
}

function skippedConformanceReport(): ConformanceReport {
  return { results: [], allPassed: false };
}

function runCliSmoke(cwd: string, args: string[]): { stdout: string; exitCode: number } {
  const cliEntry = join(cwd, "src/cli/index.ts");
  const result = spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    stdout: [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("\n"),
    exitCode: result.status ?? 1,
  };
}

function runCliSmokeChecks(projectRoot: string): AcceptanceStepResult[] {
  const steps: AcceptanceStepResult[] = [];
  let tempProject = "";

  try {
    const help = runCliSmoke(projectRoot, ["amp", "--help"]);
    steps.push({
      step: "cli: amp --help",
      passed: help.exitCode === 0 && /Agent Memory Protocol/.test(help.stdout),
      detail: help.exitCode === 0 ? undefined : help.stdout,
    });

    const status = runCliSmoke(projectRoot, ["amp", "status"]);
    steps.push({
      step: "cli: amp status",
      passed: status.exitCode === 0 && /AMP CLI shell v/.test(status.stdout),
      detail: status.exitCode === 0 ? undefined : status.stdout,
    });

    tempProject = mkdtempSync(join(tmpdir(), "amp-v1-acceptance-"));
    const init = runCliSmoke(projectRoot, [
      "amp",
      "init",
      "--project-root",
      tempProject,
    ]);
    steps.push({
      step: "cli: amp init",
      passed: init.exitCode === 0 && /config/i.test(init.stdout),
      detail: init.exitCode === 0 ? undefined : init.stdout,
    });

    const doctor = runCliSmoke(projectRoot, [
      "amp",
      "doctor",
      "--project-root",
      tempProject,
    ]);
    steps.push({
      step: "cli: amp doctor",
      passed: doctor.exitCode === 0,
      detail: doctor.exitCode === 0 ? undefined : doctor.stdout,
    });
  } finally {
    if (tempProject) {
      rmSync(tempProject, { recursive: true, force: true });
    }
  }

  return steps;
}

/**
 * Returns true when every step passed and conformance allows only INV-3 deferral.
 */
export function conformanceMeetsAcceptancePolicy(conformance: ConformanceReport): boolean {
  if (!conformance.allPassed) return false;

  const nonPass = conformance.results.filter((r) => r.status !== "pass");
  return (
    nonPass.length === 0 ||
    (nonPass.length === 1 &&
      nonPass[0]!.invariantId === INVARIANT_IDS.INV_3_CLOUD_BOUNDED &&
      nonPass[0]!.status === "deferred")
  );
}

export function evaluateAcceptanceGate(report: AcceptanceGateReport): boolean {
  const stepsOk = report.steps.every((step) => step.passed);
  const conformanceOk = conformanceMeetsAcceptancePolicy(report.conformance);
  return stepsOk && conformanceOk;
}

/*
 * Keep the deferral policy explicit near the gate. If another invariant becomes
 * deferred, the conformance runner can still say PASS while acceptance must fail.
 */
function conformanceStepDetail(
  conformance: ConformanceReport,
  conformanceOutput: string
): string | undefined {
  return conformanceMeetsAcceptancePolicy(conformance)
    ? undefined
    : [
        conformanceOutput,
        "",
        "Acceptance policy allows only the documented INV-3 deferral.",
      ].join("\n");
}

export function formatAcceptanceGateReport(report: AcceptanceGateReport): string {
  const lines: string[] = [
    "=== AMP v1 Acceptance Gate ===",
    `Project root: ${report.projectRoot}`,
    "",
    AMP_V1_PROVISIONAL_DISCLAIMER,
    "",
    "--- Build & test steps ---",
  ];

  for (const step of report.steps) {
    const label = step.passed ? "PASS" : "FAIL";
    lines.push(`${label} ${step.step}`);
    if (step.detail) {
      lines.push(step.detail);
    }
  }

  lines.push("", "--- Conformance ---", report.conformanceOutput, "");

  lines.push(
    report.allPassed
      ? "=== AMP v1 ACCEPTANCE: PASS ==="
      : "=== AMP v1 ACCEPTANCE: FAIL ==="
  );

  return lines.join("\n");
}

export async function runAcceptanceGate(
  options: AcceptanceGateOptions = {}
): Promise<AcceptanceGateReport> {
  const projectRoot = resolveRepoRoot(options.projectRoot);
  const steps: AcceptanceStepResult[] = [];

  if (!options.skipBuildSteps) {
    const runScript = options.runNpmScriptFn ?? runNpmScript;
    for (const script of ["typecheck", "build", "test"] as const) {
      const result = runScript(projectRoot, script);
      steps.push(result);
      if (!result.passed) {
        const conformance = skippedConformanceReport();
        const report: AcceptanceGateReport = {
          projectRoot,
          steps,
          conformance,
          conformanceOutput: "(skipped — prior step failed)",
          allPassed: false,
        };
        return report;
      }
    }
  }

  const conformance = await (options.runConformanceFn ?? runConformance)({ projectRoot });
  const conformanceOutput = formatConformanceReport(conformance);
  steps.push({
    step: "conformance",
    passed: conformanceMeetsAcceptancePolicy(conformance),
    detail: conformanceStepDetail(conformance, conformanceOutput),
  });

  if (conformanceMeetsAcceptancePolicy(conformance)) {
    steps.push(...runCliSmokeChecks(projectRoot));
    if (!options.skipDurableLocalLoopStep) {
      const runLoop =
        options.runDurableLocalLoopStepFn ?? runDurableLocalLoopAcceptanceStep;
      steps.push(await runLoop());
    }
  }

  const report: AcceptanceGateReport = {
    projectRoot,
    steps,
    conformance,
    conformanceOutput,
    allPassed: false,
  };
  report.allPassed = evaluateAcceptanceGate(report);
  return report;
}

/** CLI entry: run gate and exit 0/1. */
export async function mainAcceptanceGate(argv: string[] = process.argv.slice(2)): Promise<number> {
  const projectRootFlag = argv.indexOf("--project-root");
  const projectRoot =
    projectRootFlag >= 0 ? argv[projectRootFlag + 1] : undefined;

  const report = await runAcceptanceGate({ projectRoot });
  process.stdout.write(`${formatAcceptanceGateReport(report)}\n`);
  return report.allPassed ? 0 : 1;
}
