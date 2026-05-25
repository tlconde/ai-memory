import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import yaml from "js-yaml";

import type { AmpDoctorFinding } from "../doctor.js";

const SKILLS_FROM_AMP_REL = join("skills", "from-amp");
const PROJECT_SKILLS_REL = join("skills");
const HERMES_CONFIG_REL = join(".hermes", "config.yaml");

/** Override Hermes config path for doctor checks (read-only). */
export const HERMES_CONFIG_PATH_ENV = "HERMES_CONFIG_PATH";

type HermesExternalDirsResult =
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "ok"; externalDirs: string[] };

function finding(
  level: AmpDoctorFinding["level"],
  category: string,
  message: string
): AmpDoctorFinding {
  return { level, category, message };
}

/** Resolve and strip trailing path separators for stable directory comparison. */
export function normalizePathForCompare(path: string): string {
  let normalized = resolve(path);
  while (
    normalized.length > 1 &&
    (normalized.endsWith("/") || normalized.endsWith("\\"))
  ) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function resolveHermesConfigPath(
  env: NodeJS.ProcessEnv,
  homedirFn: () => string
): string {
  const envOverride = env[HERMES_CONFIG_PATH_ENV]?.trim();
  if (envOverride) {
    return resolve(envOverride);
  }

  return join(homedirFn(), HERMES_CONFIG_REL);
}

export function parseHermesExternalDirs(configPath: string): HermesExternalDirsResult {
  if (!existsSync(configPath)) {
    return { status: "missing" };
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = yaml.load(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "invalid", message: "expected YAML mapping at root" };
    }

    const skills = (parsed as Record<string, unknown>).skills;
    if (skills === undefined) {
      return { status: "ok", externalDirs: [] };
    }
    if (typeof skills !== "object" || skills === null || Array.isArray(skills)) {
      return { status: "invalid", message: "skills must be a mapping" };
    }

    const externalDirsRaw = (skills as Record<string, unknown>).external_dirs;
    if (externalDirsRaw === undefined) {
      return { status: "ok", externalDirs: [] };
    }
    if (!Array.isArray(externalDirsRaw)) {
      return { status: "invalid", message: "skills.external_dirs must be a list" };
    }

    const externalDirs: string[] = [];
    for (const entry of externalDirsRaw) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        return {
          status: "invalid",
          message: "skills.external_dirs entries must be non-empty strings",
        };
      }
      externalDirs.push(entry.trim());
    }

    return { status: "ok", externalDirs };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { status: "invalid", message };
  }
}

export function isPathListedInExternalDirs(
  resolvedTarget: string,
  externalDirs: string[]
): boolean {
  const target = normalizePathForCompare(resolvedTarget);
  return externalDirs.some((entry) => normalizePathForCompare(entry) === target);
}

export function appendHermesDiscoveryFindings(
  findings: AmpDoctorFinding[],
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  homedirFn: () => string
): void {
  const configPath = resolveHermesConfigPath(env, homedirFn);
  const projectSkillsDir = resolve(projectRoot, PROJECT_SKILLS_REL);
  const skillsFromAmpExists = existsSync(join(projectRoot, SKILLS_FROM_AMP_REL));
  const parsed = parseHermesExternalDirs(configPath);

  if (parsed.status === "missing") {
    findings.push(
      finding(
        "info",
        "hermes-discovery",
        `Hermes config not found at ${configPath}; cannot verify skills.external_dirs for ${SKILLS_FROM_AMP_REL}/.`
      )
    );
    return;
  }

  if (parsed.status === "invalid") {
    findings.push(
      finding(
        "warning",
        "hermes-discovery",
        `Hermes config at ${configPath} unreadable: ${parsed.message}`
      )
    );
    return;
  }

  if (parsed.externalDirs.length === 0) {
    findings.push(
      finding(
        "info",
        "hermes-discovery",
        `Hermes skills.external_dirs is empty at ${configPath}.`
      )
    );
  } else {
    findings.push(
      finding(
        "ok",
        "hermes-discovery",
        `Hermes skills.external_dirs lists ${parsed.externalDirs.length} director${
          parsed.externalDirs.length === 1 ? "y" : "ies"
        } at ${configPath}.`
      )
    );
  }

  if (isPathListedInExternalDirs(projectSkillsDir, parsed.externalDirs)) {
    findings.push(
      finding(
        "ok",
        "hermes-discovery",
        `Project skills root ${PROJECT_SKILLS_REL}/ is listed in Hermes skills.external_dirs (${projectSkillsDir}).`
      )
    );
    return;
  }

  const level = skillsFromAmpExists ? "warning" : "info";
  findings.push(
    finding(
      level,
      "hermes-discovery",
      `${SKILLS_FROM_AMP_REL}/ is not discoverable by Hermes — add ${projectSkillsDir} to skills.external_dirs in ${configPath}.`
    )
  );
}
