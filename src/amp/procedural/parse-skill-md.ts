/**
 * Parse SKILL.md frontmatter and map gstack skills to canonical AMP procedures.
 *
 * Intentional spec deviation (§9.9.1): gstack is read from a local checkout
 * (`file://<path>`). Remote git transport is deferred — no HTTP or network I/O.
 */

import yaml from "js-yaml";

import {
  AMP_PROCEDURE_ARTIFACT_VERSION,
  parseCanonicalProcedure,
  type CanonicalProcedure,
  type ProcedureFrontmatter,
} from "./schema.js";

export const GSTACK_UPSTREAM_SOURCE_ID = "gstack-main";

export interface ParsedSkillMd {
  frontmatter: unknown;
  body: string;
}

export interface MapGstackOptions {
  ref: string;
  mtime: string;
  skillDirName: string;
}

/** Split YAML frontmatter fence and markdown body (mirror of compileProcedureToSkillMd). */
export function parseSkillMd(content: string): ParsedSkillMd {
  const trimmed = content.replace(/^\uFEFF/, "");
  if (!trimmed.startsWith("---")) {
    throw new Error("SKILL.md must start with YAML frontmatter fence");
  }

  const closingFence = trimmed.indexOf("\n---", 3);
  if (closingFence === -1) {
    throw new Error("SKILL.md frontmatter closing fence not found");
  }

  const yamlBlock = trimmed.slice(4, closingFence);
  let body = trimmed.slice(closingFence + 4);
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  const frontmatter = yaml.load(yamlBlock);
  return { frontmatter, body };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Map gstack semver to AMP import version space (§9.9.2): `0.<gstack-version>.<patch>`. */
export function gstackImportVersion(rawVersion: string, patch = 0): string {
  const parts = rawVersion
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return `0.0.0.${patch}`;
  }

  return `0.${parts.join(".")}.${patch}`;
}

/** Promote an untouched gstack import (`0.x`) to user-owned semver (`1.x.x`). */
export function promoteGstackImportToUserVersion(version: string): string {
  if (version.startsWith("1.")) {
    return version;
  }
  if (!version.startsWith("0.")) {
    return "1.0.0";
  }

  const suffix = version.slice(2);
  const segments = suffix.split(".").filter((part) => part.length > 0);
  if (segments.length >= 2) {
    return `1.${segments.slice(0, 2).join(".")}`;
  }
  return "1.0.0";
}

/** True when a procedure is an untouched gstack import still in the 0.x version space. */
export function isUntouchedGstackImport(procedure: CanonicalProcedure): boolean {
  const provenance = procedure.frontmatter.provenance;
  return (
    provenance?.source === "import" &&
    provenance.upstream?.source_id === GSTACK_UPSTREAM_SOURCE_ID &&
    procedure.frontmatter.version.startsWith("0.")
  );
}

/** Derive supported harnesses from gstack SKILL.md body content (§9.9.3). */
export function inferSupportedHarnesses(body: string): string[] {
  const harnesses = new Set<string>();

  if (/@codebase\b|@Docs\b|@folder\b|@Web\b/.test(body)) {
    harnesses.add("cursor");
  }

  if (/(?:^|\s)\/[a-z][\w-]*/m.test(body) || /\bClaude Code\b/.test(body)) {
    harnesses.add("claude-code");
  }

  if (harnesses.size === 0) {
    return ["any"];
  }

  return [...harnesses].sort();
}

/** Map parsed gstack SKILL.md to a canonical AMP procedure. */
export function mapGstackToCanonicalProcedure(
  parsed: ParsedSkillMd,
  options: MapGstackOptions
): CanonicalProcedure {
  const raw = asRecord(parsed.frontmatter);
  const name = asString(raw.name, options.skillDirName);
  const description = asString(raw.description, `Imported gstack skill ${name}`);
  const gstackVersion = asString(raw.version, "1.0.0");

  const frontmatter: ProcedureFrontmatter = {
    name,
    description,
    version: gstackImportVersion(gstackVersion),
    triggers: asStringArray(raw.triggers),
    tools: asStringArray(raw.tools),
    mutating: asBoolean(raw.mutating, false),
    writes_pages: asBoolean(raw.writes_pages, false),
    writes_to: asStringArray(raw.writes_to),
    amp_artifact_version: AMP_PROCEDURE_ARTIFACT_VERSION,
    scope: "user",
    curation_mode: "llm_curated",
    amp_compatibility: {
      min_amp_version: "1.0",
      required_frame_kinds: [],
      required_profile_slots: [],
      required_audiences: [],
    },
    harness_compatibility: {
      supported_harnesses: inferSupportedHarnesses(parsed.body),
      injection_path: "filesystem-native",
    },
    harness_overlays: {},
    extends: asStringArray(raw.extends),
    required_by: asStringArray(raw.required_by),
    conflicts_with: asStringArray(raw.conflicts_with),
    provenance: {
      source: "import",
      author: "garrytan",
      notes: "gstack import",
      created_at: options.mtime,
      upstream: {
        source_id: GSTACK_UPSTREAM_SOURCE_ID,
        ref: options.ref,
        fetched_at: options.mtime,
        upstream_synced_at: options.mtime,
      },
    },
    conflicts: [],
  };

  return parseCanonicalProcedure({ frontmatter, body: parsed.body });
}
