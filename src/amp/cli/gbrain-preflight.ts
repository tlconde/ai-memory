/**
 * `amp gbrain-preflight` — read-only checks before live gbrain operator testing.
 *
 * Does not mutate gbrain data or run `gbrain init --migrate-only`.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import {
  AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV,
  AMP_LIVE_GBRAIN_TEST_ENV,
  isLiveGbrainTestEnabled,
  isLiveGbrainWriteConfirmed,
} from "./live-gbrain-safety.js";
import {
  AMP_KNOWLEDGE_BACKEND_ENV,
  resolveKnowledgeBackend,
  type AmpKnowledgeBackend,
} from "./knowledge-backend.js";

export type AmpGbrainPreflightFindingLevel = "ok" | "info" | "warning" | "error";

export interface AmpGbrainPreflightFinding {
  level: AmpGbrainPreflightFindingLevel;
  category: string;
  message: string;
}

export interface AmpGbrainPreflightOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  knowledge?: string;
  /** Inject spawn for tests. */
  spawnFn?: typeof spawnSync;
}

export interface AmpGbrainPreflightResult {
  projectRoot: string;
  resolvedBackend: AmpKnowledgeBackend;
  findings: AmpGbrainPreflightFinding[];
  ok: boolean;
}

export type SpawnProbe = Pick<
  SpawnSyncReturns<string>,
  "status" | "stdout" | "stderr"
>;

function finding(
  level: AmpGbrainPreflightFindingLevel,
  category: string,
  message: string
): AmpGbrainPreflightFinding {
  return { level, category, message };
}

function probeCommand(
  spawnFn: typeof spawnSync,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): SpawnProbe {
  return spawnFn(command, args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  }) as SpawnProbe;
}

function hasCommandInPath(
  spawnFn: typeof spawnSync,
  command: string,
  env: NodeJS.ProcessEnv
): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = probeCommand(spawnFn, checker, [command], env);
  return result.status === 0;
}

function appendBackendModeFindings(
  findings: AmpGbrainPreflightFinding[],
  backend: AmpKnowledgeBackend,
  env: NodeJS.ProcessEnv,
  confirmFlag?: boolean
): void {
  findings.push(
    finding("info", "backend-mode", `Resolved knowledge backend: ${backend}.`)
  );

  if (backend === "in-memory" || backend === "fake-gbrain") {
    findings.push(
      finding(
        "ok",
        "backend-mode",
        `${backend} is offline-safe — no live gbrain MCP connection.`
      )
    );
    return;
  }

  const confirmed = isLiveGbrainWriteConfirmed({ confirmLiveGbrainWrite: confirmFlag, env });
  if (confirmed) {
    findings.push(
      finding(
        "warning",
        "live-mutation",
        "Live gbrain write confirmation is ON — consolidate may mutate your gbrain database."
      )
    );
  } else {
    findings.push(
      finding(
        "ok",
        "live-mutation",
        "Live gbrain writes are blocked until you pass --confirm-live-gbrain-write or " +
          `${AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV}=1.`
      )
    );
  }

  findings.push(
    finding(
      "warning",
      "live-mutation",
      "retrieve with --knowledge gbrain connects to live gbrain serve (read-only for AMP, " +
        "PROVISIONAL side effects unknown)."
    )
  );
}

function appendLiveTestFindings(
  findings: AmpGbrainPreflightFinding[],
  env: NodeJS.ProcessEnv
): void {
  if (isLiveGbrainTestEnabled(env)) {
    findings.push(
      finding(
        "warning",
        "live-test",
        `${AMP_LIVE_GBRAIN_TEST_ENV}=1 — integration/gbrain-live.test.ts may mutate gbrain pages.`
      )
    );
  } else {
    findings.push(
      finding(
        "ok",
        "live-test",
        `Live gbrain integration tests disabled (set ${AMP_LIVE_GBRAIN_TEST_ENV}=1 to opt in).`
      )
    );
  }
}

function appendGbrainBinaryFindings(
  findings: AmpGbrainPreflightFinding[],
  spawnFn: typeof spawnSync,
  env: NodeJS.ProcessEnv
): void {
  if (!hasCommandInPath(spawnFn, "gbrain", env)) {
    findings.push(
      finding(
        "warning",
        "gbrain-binary",
        "`gbrain` not on PATH — live MCP checks skipped. Install gbrain before live testing."
      )
    );
    return;
  }

  findings.push(finding("ok", "gbrain-binary", "`gbrain` found on PATH."));

  const versionProbe = probeCommand(spawnFn, "gbrain", ["--version"], env);
  const versionOutput = [versionProbe.stdout, versionProbe.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (versionProbe.status === 0 && versionOutput) {
    findings.push(finding("info", "gbrain-binary", `Version probe: ${versionOutput.split("\n")[0]}.`));
  } else {
    findings.push(
      finding(
        "info",
        "gbrain-binary",
        "Could not read gbrain version (PROVISIONAL — binary present but --version failed)."
      )
    );
  }

  const serveHelp = probeCommand(spawnFn, "gbrain", ["serve", "--help"], env);
  if (serveHelp.status === 0) {
    findings.push(
      finding("ok", "gbrain-serve", "`gbrain serve` command available (read-only probe).")
    );
  } else {
    findings.push(
      finding(
        "warning",
        "gbrain-serve",
        "`gbrain serve --help` failed — AMP live transport may be unavailable."
      )
    );
  }
}

function appendDoctorMigrateFindings(
  findings: AmpGbrainPreflightFinding[],
  spawnFn: typeof spawnSync,
  env: NodeJS.ProcessEnv
): void {
  if (!hasCommandInPath(spawnFn, "gbrain", env)) {
    findings.push(
      finding(
        "info",
        "gbrain-migrate",
        "Skipped gbrain doctor probe — binary not on PATH."
      )
    );
    return;
  }

  const doctor = probeCommand(spawnFn, "gbrain", ["doctor", "--json"], env);
  const doctorOutput = [doctor.stdout, doctor.stderr].filter(Boolean).join("\n");

  if (doctor.status !== 0 && !doctorOutput.trim()) {
    findings.push(
      finding(
        "warning",
        "gbrain-migrate",
        "gbrain doctor --json failed with no output (UNKNOWN migration state)."
      )
    );
    return;
  }

  const recommendsMigrate =
    /init\s+--migrate-only/i.test(doctorOutput) ||
    /migrate-only/i.test(doctorOutput) ||
    /Schema probe\/migrate failed/i.test(doctorOutput);

  if (recommendsMigrate) {
    findings.push(
      finding(
        "warning",
        "gbrain-migrate",
        "PROVISIONAL: gbrain doctor suggests `gbrain init --migrate-only`. " +
          "Run it manually before live testing — AMP will NOT run migrations for you."
      )
    );
  } else if (doctor.status === 0) {
    findings.push(
      finding("ok", "gbrain-migrate", "gbrain doctor did not recommend migrate-only (PROVISIONAL).")
    );
  } else {
    findings.push(
      finding(
        "warning",
        "gbrain-migrate",
        "gbrain doctor reported warnings (PROVISIONAL) — review output before live testing."
      )
    );
  }
}

function appendOptInSummary(findings: AmpGbrainPreflightFinding[]): void {
  findings.push(
    finding(
      "info",
      "operator-summary",
      "Safe (no live gbrain): npm run amp:acceptance, amp doctor, amp capture, " +
        "amp consolidate --knowledge in-memory|fake-gbrain."
    )
  );
  findings.push(
    finding(
      "info",
      "operator-summary",
      "Live read (PROVISIONAL): amp retrieve --knowledge gbrain connects to gbrain serve."
    )
  );
  findings.push(
    finding(
      "warning",
      "operator-summary",
      "Live write (mutates gbrain pages): amp consolidate --knowledge gbrain " +
        `--confirm-live-gbrain-write or ${AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV}=1.`
    )
  );
  findings.push(
    finding(
      "info",
      "operator-summary",
      `Live integration test: ${AMP_LIVE_GBRAIN_TEST_ENV}=1 npm test -- src/amp/integration/gbrain-live.test.ts.`
    )
  );
  findings.push(
    finding(
      "info",
      "operator-summary",
      "AMP does not migrate legacy AMP slug encodings — new writes use amp/frames/h.{hex} only."
    )
  );
}

/** Run read-only gbrain preflight checks for operator testing. */
export function runAmpGbrainPreflight(
  options: AmpGbrainPreflightOptions = {}
): AmpGbrainPreflightResult {
  const env = options.env ?? process.env;
  const spawnFn = options.spawnFn ?? spawnSync;
  const projectRoot = options.projectRoot ?? process.cwd();

  let resolvedBackend: AmpKnowledgeBackend;
  try {
    resolvedBackend = resolveKnowledgeBackend({
      explicit: options.knowledge,
      env,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      projectRoot,
      resolvedBackend: "gbrain",
      findings: [finding("error", "backend-mode", message)],
      ok: false,
    };
  }

  const findings: AmpGbrainPreflightFinding[] = [];

  appendGbrainBinaryFindings(findings, spawnFn, env);
  appendDoctorMigrateFindings(findings, spawnFn, env);
  appendLiveTestFindings(findings, env);
  appendBackendModeFindings(findings, resolvedBackend, env);
  appendOptInSummary(findings);

  if (env[AMP_KNOWLEDGE_BACKEND_ENV]?.trim()) {
    findings.push(
      finding(
        "info",
        "backend-mode",
        `${AMP_KNOWLEDGE_BACKEND_ENV}=${env[AMP_KNOWLEDGE_BACKEND_ENV]}`
      )
    );
  }

  const ok = !findings.some((item) => item.level === "error");
  return { projectRoot, resolvedBackend, findings, ok };
}

const LEVEL_PREFIX: Record<AmpGbrainPreflightFindingLevel, string> = {
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
