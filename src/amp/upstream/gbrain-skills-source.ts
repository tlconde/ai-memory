/**
 * Read-only gbrain skills discovery (AMP §10.4.2).
 *
 * Local-only: reads a user-supplied gbrain `skills/` directory via `--path` or
 * `GBRAIN_SKILLS_DIR`. No network I/O and no writes into the skills tree.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  GBRAIN_UPSTREAM_SOURCE_ID,
  mapGbrainToCanonicalProcedure,
  parseSkillMd,
} from "../procedural/parse-skill-md.js";
import {
  ProcedureFrontmatterSchema,
  safeParseCanonicalProcedure,
  type CanonicalProcedure,
} from "../procedural/schema.js";
import type { GstackListEntry, GstackListResult } from "./gstack-import.js";

export { GBRAIN_UPSTREAM_SOURCE_ID };

export const GBRAIN_SKILLS_DIR_ENV = "GBRAIN_SKILLS_DIR";
export const GBRAIN_PROCEDURAL_SOURCE_ID = "gbrain";

export interface GbrainSkillScanEntry {
  skillName: string;
  skillPath: string;
  mtime: string;
}

export interface GbrainSkillParseResult {
  skillName: string;
  procedure?: CanonicalProcedure;
  validation_error?: string;
}

/** Resolve gbrain skills directory: CLI `--path` > `GBRAIN_SKILLS_DIR` > error. */
export function resolveGbrainSkillsDir(
  pathFlag: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): string {
  const explicit = pathFlag?.trim();
  if (explicit) {
    return explicit;
  }

  const fromEnv = env[GBRAIN_SKILLS_DIR_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  throw new Error(
    "Gbrain skills directory required: pass --path <gbrain-skills-dir> or set " +
      `${GBRAIN_SKILLS_DIR_ENV} (AMP does not guess install locations).`
  );
}

/** List gbrain-shaped skill directories under `<skillsDir>/<name>/SKILL.md`. */
export async function listGbrainSkillFiles(skillsDir: string): Promise<GbrainSkillScanEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return [];
  }

  const results: GbrainSkillScanEntry[] = [];
  for (const entry of entries) {
    const skillPath = join(skillsDir, entry, "SKILL.md");
    try {
      const fileStat = await stat(skillPath);
      if (!fileStat.isFile()) {
        continue;
      }
      results.push({
        skillName: entry,
        skillPath,
        mtime: fileStat.mtime.toISOString(),
      });
    } catch {
      continue;
    }
  }

  results.sort((left, right) => left.skillName.localeCompare(right.skillName));
  return results;
}

/** Parse RESOLVER.md when present (routing table completeness; not required for discovery). */
export async function tryParseGbrainResolver(skillsDir: string): Promise<void> {
  const resolverPath = join(skillsDir, "RESOLVER.md");
  try {
    const fileStat = await stat(resolverPath);
    if (!fileStat.isFile()) {
      return;
    }
    const raw = await readFile(resolverPath, "utf8");
    parseSkillMd(raw);
  } catch {
    // RESOLVER is optional; invalid or missing files do not block discovery.
  }
}

/** Parse and map each gbrain SKILL.md under a skills directory. */
export async function parseGbrainSkillsDir(
  skillsDir: string,
  ref: string
): Promise<GbrainSkillParseResult[]> {
  await tryParseGbrainResolver(skillsDir);
  const skills = await listGbrainSkillFiles(skillsDir);
  const results: GbrainSkillParseResult[] = [];

  for (const skill of skills) {
    const raw = await readFile(skill.skillPath, "utf8");
    try {
      const parsed = parseSkillMd(raw);
      const mapped = mapGbrainToCanonicalProcedure(parsed, {
        ref,
        mtime: skill.mtime,
        skillDirName: skill.skillName,
      });
      const validated = safeParseCanonicalProcedure(mapped);
      if (!validated.success) {
        results.push({
          skillName: skill.skillName,
          validation_error: validated.error,
        });
        continue;
      }
      ProcedureFrontmatterSchema.parse(validated.procedure.frontmatter);
      results.push({ skillName: skill.skillName, procedure: validated.procedure });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ skillName: skill.skillName, validation_error: message });
    }
  }

  return results;
}

export class GbrainSkillsSource {
  readonly id = GBRAIN_UPSTREAM_SOURCE_ID;

  constructor(private readonly skillsDir: string) {}

  async list(ref = "local-gbrain-skills"): Promise<GbrainSkillParseResult[]> {
    return parseGbrainSkillsDir(this.skillsDir, ref);
  }
}

/** Discovery list for `amp procedural list --source gbrain`. */
export async function listGbrainProcedures(options: {
  skillsDir: string;
  ref?: string;
}): Promise<GstackListResult> {
  const parsed = await parseGbrainSkillsDir(
    options.skillsDir,
    options.ref ?? "local-gbrain-skills"
  );
  return {
    entries: parsed.map(
      (entry): GstackListEntry => ({
        name: entry.procedure?.frontmatter.name ?? entry.skillName,
        version: entry.procedure?.frontmatter.version ?? "unknown",
        supported_harnesses:
          entry.procedure?.frontmatter.harness_compatibility.supported_harnesses ?? [],
        validation_error: entry.validation_error,
        frontmatter: entry.procedure?.frontmatter,
      })
    ),
  };
}
