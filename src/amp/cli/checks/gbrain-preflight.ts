/**
 * Read-only gbrain preflight checks for operator testing.
 *
 * Does not mutate gbrain data or run `gbrain init --migrate-only`.
 * Preflight itself may spawn local read-only process probes (`which`, `gbrain doctor`, etc.).
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import {
  AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV,
  AMP_LIVE_GBRAIN_TEST_ENV,
  isLiveGbrainTestEnabled,
  isLiveGbrainWriteConfirmed,
} from "../../gbrain/live-policy.js";
import type { AmpDoctorFinding } from "../doctor.js";
import {
  AMP_KNOWLEDGE_BACKEND_ENV,
  resolveKnowledgeBackend,
  type AmpKnowledgeBackend,
} from "../knowledge-backend.js";

export type GbrainPreflightSpawnFn = typeof spawnSync;

export interface CollectGbrainPreflightChecksOptions {
  env?: NodeJS.ProcessEnv;
  knowledge?: string;
  confirmLiveGbrainWrite?: boolean;
  spawnFn?: GbrainPreflightSpawnFn;
}

export interface GbrainPreflightChecksResult {
  resolvedBackend: AmpKnowledgeBackend;
  findings: AmpDoctorFinding[];
  ok: boolean;
}

type SpawnProbe = Pick<SpawnSyncReturns<string>, "status" | "stdout" | "stderr">;

function finding(
  level: AmpDoctorFinding["level"],
  category: string,
  message: string
): AmpDoctorFinding {
  return { level, category, message };
}

function probeCommand(
  spawnFn: GbrainPreflightSpawnFn,
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
  spawnFn: GbrainPreflightSpawnFn,
  command: string,
  env: NodeJS.ProcessEnv
): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = probeCommand(spawnFn, checker, [command], env);
  return result.status === 0;
}

function appendGbrainBinaryFindings(
  findings: AmpDoctorFinding[],
  spawnFn: GbrainPreflightSpawnFn,
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
  findings: AmpDoctorFinding[],
  spawnFn: GbrainPreflightSpawnFn,
  env: NodeJS.ProcessEnv
): void {
  if (!hasCommandInPath(spawnFn, "gbrain", env)) {
    findings.push(
      finding("info", "gbrain-migrate", "Skipped gbrain doctor probe — binary not on PATH.")
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

function appendLiveTestFindings(findings: AmpDoctorFinding[], env: NodeJS.ProcessEnv): void {
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

function appendBackendModeFindings(
  findings: AmpDoctorFinding[],
  backend: AmpKnowledgeBackend,
  env: NodeJS.ProcessEnv,
  confirmLiveGbrainWrite?: boolean
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

  const confirmed = isLiveGbrainWriteConfirmed({ confirmLiveGbrainWrite, env });
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
      "live-read",
      "retrieve with --knowledge gbrain connects to live gbrain serve (read-only for AMP, " +
        "PROVISIONAL side effects unknown)."
    )
  );
}

function appendOptInSummary(findings: AmpDoctorFinding[]): void {
  findings.push(
    finding(
      "info",
      "operator-summary",
      "Preflight performs read-only local process probes only (which, gbrain doctor, serve --help)."
    )
  );
  findings.push(
    finding(
      "info",
      "operator-summary",
      "Safe (no live gbrain MCP): npm run amp:acceptance, amp doctor, amp capture, " +
        "amp consolidate --knowledge in-memory|fake-gbrain."
    )
  );
  findings.push(
    finding(
      "info",
      "operator-summary",
      "Live reads (PROVISIONAL): amp retrieve --knowledge gbrain connects to gbrain serve."
    )
  );
  findings.push(
    finding(
      "warning",
      "operator-summary",
      "Live writes require confirmation: amp consolidate --knowledge gbrain " +
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
      "warning",
      "operator-summary",
      "Operator safety requires preflight + write guard together — do not release preflight without write confirmation enforcement."
    )
  );
}

/** Collect read-only gbrain preflight findings. */
export function collectGbrainPreflightChecks(
  options: CollectGbrainPreflightChecksOptions = {}
): GbrainPreflightChecksResult {
  const env = options.env ?? process.env;
  const spawnFn = options.spawnFn ?? spawnSync;

  let resolvedBackend: AmpKnowledgeBackend;
  try {
    resolvedBackend = resolveKnowledgeBackend({
      explicit: options.knowledge,
      env,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      resolvedBackend: "gbrain",
      findings: [finding("error", "backend-mode", message)],
      ok: false,
    };
  }

  const findings: AmpDoctorFinding[] = [];

  appendGbrainBinaryFindings(findings, spawnFn, env);
  appendDoctorMigrateFindings(findings, spawnFn, env);
  appendLiveTestFindings(findings, env);
  appendBackendModeFindings(findings, resolvedBackend, env, options.confirmLiveGbrainWrite);
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
  return { resolvedBackend, findings, ok };
}
