/**
 * Claude Code surface adapter skeleton with from-amp write guards.
 */

import { join } from "node:path";

import { FromAmpWriter } from "../from-amp-writer.js";
import { compileProcedureToSkillMd } from "../../../procedural/compile-skill-md.js";
import { PathSafetyError } from "../../../path-safety/guard.js";
import type { CanonicalProcedure } from "../../../procedural/schema.js";

export const CLAUDE_FROM_AMP_DIR = "from-amp";

export interface ClaudeCodeAdapterOptions {
  basePath: string;
}

export class ClaudeCodeAdapter {
  readonly basePath: string;
  readonly writer: FromAmpWriter;

  constructor(options: ClaudeCodeAdapterOptions) {
    this.basePath = options.basePath;
    this.writer = new FromAmpWriter({
      fromAmpRoot: join(options.basePath, CLAUDE_FROM_AMP_DIR),
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
}

export { PathSafetyError };
