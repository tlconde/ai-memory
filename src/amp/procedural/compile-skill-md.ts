/**
 * Compile canonical AMP procedures to folder-per-skill SKILL.md artifacts.
 *
 * Falsifiable claim: identical canonical input always yields byte-identical
 * emitted content with stable frontmatter key order and trailing newline.
 */

import yaml from "js-yaml";

import type {
  AmpCompatibility,
  CanonicalProcedure,
  HarnessCompatibility,
  HarnessOverlays,
  ProcedureConflict,
  ProcedureFrontmatter,
  ProcedureProvenance,
} from "./schema.js";

export interface CompiledSkillMd {
  skillName: string;
  relativePath: string;
  content: string;
}

function orderedRecord<T extends Record<string, unknown>>(
  value: T,
  keyOrder: readonly (keyof T)[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keyOrder) {
    if (value[key] !== undefined) {
      result[key as string] = value[key];
    }
  }
  return result;
}

function orderedAmpCompatibility(value: AmpCompatibility): Record<string, unknown> {
  return orderedRecord(value, [
    "min_amp_version",
    "required_frame_kinds",
    "required_profile_slots",
    "required_audiences",
  ]);
}

function orderedHarnessCompatibility(
  value: HarnessCompatibility
): Record<string, unknown> {
  return orderedRecord(value, ["supported_harnesses", "injection_path"]);
}

function orderedCursorOverlay(
  value: NonNullable<HarnessOverlays["cursor"]>
): Record<string, unknown> {
  return orderedRecord(value, ["globs", "alwaysApply"]);
}

function orderedGbrainOverlay(
  value: NonNullable<HarnessOverlays["gbrain"]>
): Record<string, unknown> {
  return orderedRecord(value, ["resolver_priority"]);
}

function orderedHarnessOverlays(value: HarnessOverlays): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (value.cursor !== undefined) {
    result.cursor = orderedCursorOverlay(value.cursor);
  }
  if (value.claude_code !== undefined) {
    result.claude_code = value.claude_code;
  }
  if (value.hermes !== undefined) {
    result.hermes = value.hermes;
  }
  if (value.gbrain !== undefined) {
    result.gbrain = orderedGbrainOverlay(value.gbrain);
  }
  return result;
}

function orderedProvenance(value: ProcedureProvenance): Record<string, unknown> {
  return orderedRecord(value, ["source", "created_at", "updated_at", "author", "notes"]);
}

function orderedConflict(value: ProcedureConflict): Record<string, unknown> {
  return orderedRecord(value, ["with", "reason", "detected_at"]);
}

function orderedFrontmatter(frontmatter: ProcedureFrontmatter): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: frontmatter.name,
    description: frontmatter.description,
    version: frontmatter.version,
    triggers: frontmatter.triggers,
    tools: frontmatter.tools,
    mutating: frontmatter.mutating,
    writes_pages: frontmatter.writes_pages,
    writes_to: frontmatter.writes_to,
    amp_artifact_version: frontmatter.amp_artifact_version,
    scope: frontmatter.scope,
    curation_mode: frontmatter.curation_mode,
    amp_compatibility: orderedAmpCompatibility(frontmatter.amp_compatibility),
    harness_compatibility: orderedHarnessCompatibility(frontmatter.harness_compatibility),
    harness_overlays: orderedHarnessOverlays(frontmatter.harness_overlays),
    extends: frontmatter.extends,
    required_by: frontmatter.required_by,
    conflicts_with: frontmatter.conflicts_with,
  };

  if (frontmatter.provenance !== undefined) {
    result.provenance = orderedProvenance(frontmatter.provenance);
  }

  result.conflicts = frontmatter.conflicts.map(orderedConflict);
  return result;
}

function serializeFrontmatter(frontmatter: ProcedureFrontmatter): string {
  return yaml
    .dump(orderedFrontmatter(frontmatter), {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    })
    .trimEnd();
}

function normalizeBodySeparator(body: string): string {
  if (body.length === 0) {
    return "";
  }
  return body.startsWith("\n") ? body : `\n${body}`;
}

/** Compile a canonical procedure to Claude Code folder-per-skill SKILL.md output. */
export function compileProcedureToSkillMd(procedure: CanonicalProcedure): CompiledSkillMd {
  const skillName = procedure.frontmatter.name;
  const relativePath = `${skillName}/SKILL.md`;
  const frontmatterYaml = serializeFrontmatter(procedure.frontmatter);
  let content = `---\n${frontmatterYaml}\n---${normalizeBodySeparator(procedure.body)}`;

  if (!content.endsWith("\n")) {
    content += "\n";
  }

  return {
    skillName,
    relativePath,
    content,
  };
}
