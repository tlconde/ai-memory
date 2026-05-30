import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { parseSkillMd, type ParsedSkillMd } from "./parse-skill-md.js";
import {
  ProcedureFrontmatterSchema,
  safeParseCanonicalProcedure,
  type CanonicalProcedure,
} from "./schema.js";

export interface SkillMdScanEntry {
  skillName: string;
  skillPath: string;
  mtime: string;
}

export interface SkillMdParseResult {
  skillName: string;
  procedure?: CanonicalProcedure;
  validation_error?: string;
}

export type SkillMdMapFn = (
  parsed: ParsedSkillMd,
  options: { ref: string; mtime: string; skillDirName: string }
) => CanonicalProcedure;

/** List skill directories containing `<skillsRoot>/<name>/SKILL.md`. */
export async function listSkillMdFiles(skillsRoot: string): Promise<SkillMdScanEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsRoot);
  } catch {
    return [];
  }

  const results: SkillMdScanEntry[] = [];
  for (const entry of entries) {
    const skillPath = join(skillsRoot, entry, "SKILL.md");
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

/** Parse and map each SKILL.md under a skills root directory. */
export async function scanSkillMdDirectory(
  skillsRoot: string,
  ref: string,
  mapFn: SkillMdMapFn
): Promise<SkillMdParseResult[]> {
  const skills = await listSkillMdFiles(skillsRoot);
  const results: SkillMdParseResult[] = [];

  for (const skill of skills) {
    const raw = await readFile(skill.skillPath, "utf8");
    try {
      const parsed = parseSkillMd(raw);
      const mapped = mapFn(parsed, {
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
