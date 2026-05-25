/**
 * `amp doctor` - inspect config, runtime, specs, paths, and capability gaps.
 *
 * Falsifiable claim: doctor reports actionable findings without requiring live
 * gbrain or Hermes sessions.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CapabilityCoverage } from "../adapter-contract/capability-coverage.js";
import {
  appendHermesDiscoveryFindings,
  HERMES_CONFIG_PATH_ENV,
} from "./checks/hermes-discovery.js";
import { discoverAmpConfig } from "../config/discovery.js";
import {
  AMP_USER_CONFIG_PATH_ENV,
  PROJECT_CONFIG_REL,
  projectConfigPath,
} from "../config/paths.js";
import { tryLoadSasSpecFromFile } from "../sas/loader.js";
import type { ExternalClaim } from "../ssa/claim-label.js";
import { tryLoadSsaSpecFromFile } from "../ssa/loader.js";

export type AmpDoctorFindingLevel = "ok" | "info" | "warning" | "error";

export interface AmpDoctorFinding {
  level: AmpDoctorFindingLevel;
  category: string;
  message: string;
}

export interface AmpDoctorOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** AMP / ai-memory repo root for bundled SSA/SAS spec files. */
  ampRepoRoot?: string;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

export interface AmpDoctorResult {
  projectRoot: string;
  findings: AmpDoctorFinding[];
  /** True when no error-level findings are present. */
  ok: boolean;
}

const SKILLS_FROM_AMP_REL = join("skills", "from-amp");
const CURSOR_RULES_FROM_AMP_REL = join(".cursor", "rules", "from-amp");
const SSA_GBRAIN_REL = join("ssa-files", "gbrain.yaml");
const SAS_HERMES_REL = join("sas-files", "hermes.yaml");

export { HERMES_CONFIG_PATH_ENV };

function finding(
  level: AmpDoctorFindingLevel,
  category: string,
  message: string
): AmpDoctorFinding {
  return { level, category, message };
}

/** Resolve repo root containing bundled SSA/SAS specs. */
export function resolveAmpRepoRoot(explicit?: string): string {
  if (explicit) {
    return resolve(explicit);
  }

  const fromModule = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
  if (existsSync(join(fromModule, SSA_GBRAIN_REL))) {
    return fromModule;
  }

  const cwd = resolve(process.cwd());
  if (existsSync(join(cwd, SSA_GBRAIN_REL))) {
    return cwd;
  }

  return fromModule;
}

function hasCommandInPath(command: string, env: NodeJS.ProcessEnv): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], {
    env,
    stdio: "ignore",
  });
  return result.status === 0;
}

function listUnsupportedCapabilities(coverage: CapabilityCoverage): string[] {
  const gaps: string[] = [];
  for (const [kind, level] of Object.entries(coverage.frame_kinds)) {
    if (level === "unsupported") {
      gaps.push(`frame_kinds.${kind}`);
    }
  }

  const scalarKeys = [
    "curation_mode",
    "vector_search",
    "graph_traversal",
    "transactions",
    "embedding_storage",
    "full_text_search",
    "profile_slots",
    "procedural_registry",
  ] as const;

  for (const key of scalarKeys) {
    if (coverage[key] === "unsupported") {
      gaps.push(key);
    }
  }

  return gaps;
}

function appendProvisionalClaimWarnings(
  findings: AmpDoctorFinding[],
  category: string,
  claims: ExternalClaim[] | undefined
): void {
  if (!claims) return;
  for (const claim of claims) {
    if (claim.label !== "PROVISIONAL") continue;
    findings.push(
      finding(
        "warning",
        category,
        `PROVISIONAL: ${claim.claim}${claim.evidence ? ` (${claim.evidence})` : ""}`
      )
    );
  }
}

/** Run AMP doctor checks for the given project. */
export function runAmpDoctor(options: AmpDoctorOptions = {}): AmpDoctorResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const ampRepoRoot = resolveAmpRepoRoot(options.ampRepoRoot);
  const resolveHome = options.homedir ?? (() => join(projectRoot, "home"));
  const findings: AmpDoctorFinding[] = [];

  const configPath = projectConfigPath(projectRoot, { env });
  const configExists = existsSync(configPath);

  if (!configExists) {
    findings.push(
      finding(
        "warning",
        "project-config",
        `${PROJECT_CONFIG_REL} not found - run \`amp init\` in ${projectRoot}.`
      )
    );
  } else {
    findings.push(
      finding("ok", "project-config", `${PROJECT_CONFIG_REL} present at ${configPath}.`)
    );
  }

  try {
    const resolved = discoverAmpConfig({
      projectRoot,
      env: {
        ...env,
        [AMP_USER_CONFIG_PATH_ENV]:
          env[AMP_USER_CONFIG_PATH_ENV] ??
          join(projectRoot, ".amp", "missing-user-config.yaml"),
      },
      platform: options.platform,
      homedir: resolveHome,
    });

    findings.push(
      finding(
        "ok",
        "config-discovery",
        `Runtime db path resolved (${resolved.sources.runtimePathSource}): ${resolved.runtime.dbPath}`
      )
    );

    if (resolved.projectRef) {
      findings.push(
        finding("info", "config-discovery", `project_ref: ${resolved.projectRef}`)
      );
    }

    const runtimeParent = dirname(resolved.runtime.dbPath);
    if (existsSync(runtimeParent)) {
      findings.push(
        finding("ok", "runtime", `Runtime parent directory exists: ${runtimeParent}`)
      );
    } else {
      findings.push(
        finding(
          "info",
          "runtime",
          `Runtime parent directory missing (will be created on init/capture): ${runtimeParent}`
        )
      );
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    findings.push(
      finding(
        "error",
        "config-discovery",
        `AMP config discovery failed: ${message}`
      )
    );
  }

  const ssaPath = join(ampRepoRoot, SSA_GBRAIN_REL);
  const ssaResult = tryLoadSsaSpecFromFile(ssaPath);
  if (ssaResult.success) {
    findings.push(
      finding(
        "ok",
        "ssa-spec",
        `Loaded SSA spec ${ssaResult.spec.id}@${ssaResult.spec.version} from ${ssaPath}.`
      )
    );
    const gaps = listUnsupportedCapabilities(ssaResult.spec.capability_coverage);
    if (gaps.length === 0) {
      findings.push(
        finding("ok", "capability-gaps", "No unsupported capabilities declared in SSA spec.")
      );
    } else {
      findings.push(
        finding(
          "warning",
          "capability-gaps",
          `SSA (${ssaResult.spec.id}) unsupported: ${gaps.join(", ")}`
        )
      );
    }
    appendProvisionalClaimWarnings(findings, "ssa-external-claims", ssaResult.spec.external_claims);
  } else {
    findings.push(
      finding(
        "error",
        "ssa-spec",
        `Failed to load ${SSA_GBRAIN_REL} at ${ssaPath}: ${ssaResult.error}`
      )
    );
  }

  const sasPath = join(ampRepoRoot, SAS_HERMES_REL);
  const sasResult = tryLoadSasSpecFromFile(sasPath);
  if (sasResult.success) {
    findings.push(
      finding(
        "ok",
        "sas-spec",
        `Loaded SAS spec ${sasResult.spec.id}@${sasResult.spec.version} from ${sasPath}.`
      )
    );
    appendProvisionalClaimWarnings(findings, "sas-external-claims", sasResult.spec.external_claims);

  } else {
    findings.push(
      finding(
        "error",
        "sas-spec",
        `Failed to load ${SAS_HERMES_REL} at ${sasPath}: ${sasResult.error}`
      )
    );
  }

  const skillsFromAmp = join(projectRoot, SKILLS_FROM_AMP_REL);
  if (existsSync(skillsFromAmp)) {
    findings.push(finding("ok", "path-roots", `${SKILLS_FROM_AMP_REL}/ exists.`));
  } else {
    findings.push(
      finding(
        "warning",
        "path-roots",
        `${SKILLS_FROM_AMP_REL}/ missing - init does not create harness dirs; run propagate when ready.`
      )
    );
  }

  const cursorFromAmp = join(projectRoot, CURSOR_RULES_FROM_AMP_REL);
  if (existsSync(cursorFromAmp)) {
    findings.push(finding("ok", "path-roots", `${CURSOR_RULES_FROM_AMP_REL}/ exists.`));
  } else {
    findings.push(
      finding(
        "info",
        "path-roots",
        `${CURSOR_RULES_FROM_AMP_REL}/ missing - expected after procedure propagation.`
      )
    );
  }

  appendHermesDiscoveryFindings(findings, projectRoot, env, resolveHome);

  if (hasCommandInPath("gbrain", env)) {
    findings.push(
      finding("ok", "gbrain-binary", "`gbrain` found on PATH (optional for doctor pass).")
    );
  } else {
    findings.push(
      finding(
        "warning",
        "gbrain-binary",
        "`gbrain` not on PATH - SSA transport checks skipped; install gbrain for live substrate ops."
      )
    );
  }

  const ok = !findings.some((f) => f.level === "error");

  return { projectRoot, findings, ok };
}

const LEVEL_PREFIX: Record<AmpDoctorFindingLevel, string> = {
  ok: "OK",
  info: "INFO",
  warning: "WARN",
  error: "ERROR",
};

/** Human-readable doctor report lines for CLI and tests. */
export function formatAmpDoctorReport(result: AmpDoctorResult): string[] {
  const lines: string[] = [`AMP doctor - ${result.projectRoot}`, ""];

  for (const item of result.findings) {
    const prefix = LEVEL_PREFIX[item.level];
    lines.push(`  ${prefix} [${item.category}] ${item.message}`);
  }

  lines.push("");
  if (result.ok) {
    lines.push("OK Doctor finished with no blocking errors.");
  } else {
    lines.push("ERROR Doctor found blocking errors - fix ERROR items before capture/propagate.");
  }

  return lines;
}
