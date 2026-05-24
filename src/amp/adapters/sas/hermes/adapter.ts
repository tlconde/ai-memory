/**
 * Hermes surface adapter with skills/from-amp write guards.
 *
 * Live Hermes session load of AMP-emitted skills is PROVISIONAL/UNKNOWN unless
 * verified via `hermes -s <name>` against a configured skills.external_dirs entry.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { FromAmpWriter } from "../from-amp-writer.js";
import { compileProcedureToSkillMd } from "../../../procedural/compile-skill-md.js";
import { PathSafetyError } from "../../../path-safety/guard.js";
import type { CanonicalProcedure } from "../../../procedural/schema.js";

export const HERMES_FROM_AMP_REL = join("skills", "from-amp");

export interface HermesAdapterOptions {
  projectRoot: string;
}

export interface EmittedSkillEntry {
  skillName: string;
  skillMdPath: string;
}

export class HermesAdapter {
  readonly projectRoot: string;
  readonly writer: FromAmpWriter;

  constructor(options: HermesAdapterOptions) {
    this.projectRoot = options.projectRoot;
    this.writer = new FromAmpWriter({
      fromAmpRoot: join(options.projectRoot, HERMES_FROM_AMP_REL),
    });
  }

  resolveSkillWritePath(skillName: string, filename = "SKILL.md"): string {
    return this.writer.resolveWritePath(skillName, filename);
  }

  async writeEmittedSkill(skillName: string, content: string): Promise<string> {
    return this.writer.writeRelative([skillName, "SKILL.md"], content);
  }

  async writeCompiledProcedure(procedure: CanonicalProcedure): Promise<string> {
    const compiled = compileProcedureToSkillMd(procedure);
    return this.writer.writeRelative(compiled.relativePath.split("/"), compiled.content);
  }

  async readEmittedSkill(skillName: string): Promise<string> {
    const path = this.resolveSkillWritePath(skillName);
    return readFile(path, "utf8");
  }

  async listEmittedSkills(): Promise<EmittedSkillEntry[]> {
    const root = this.writer.fromAmpRoot;
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch (err: unknown) {
      if (isEnoent(err)) {
        return [];
      }
      throw err;
    }

    const skills: EmittedSkillEntry[] = [];
    for (const name of entries.sort()) {
      const skillMdPath = this.resolveSkillWritePath(name);
      try {
        await readFile(skillMdPath, "utf8");
        skills.push({ skillName: name, skillMdPath });
      } catch (err: unknown) {
        if (isEnoent(err)) {
          continue;
        }
        throw err;
      }
    }
    return skills;
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export { PathSafetyError };
