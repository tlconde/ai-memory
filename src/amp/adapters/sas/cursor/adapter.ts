/**
 * Cursor surface adapter skeleton with from-amp write guards.
 */

import { join } from "node:path";

import { compileProcedureToCursorMdc, type CanonicalProcedure } from "../../../procedural/index.js";
import { FromAmpWriter } from "../from-amp-writer.js";

export const CURSOR_FROM_AMP_REL = join(".cursor", "rules", "from-amp");

export interface CursorAdapterOptions {
  projectRoot: string;
}

export class CursorAdapter {
  readonly projectRoot: string;
  readonly writer: FromAmpWriter;

  constructor(options: CursorAdapterOptions) {
    this.projectRoot = options.projectRoot;
    this.writer = new FromAmpWriter({
      fromAmpRoot: join(options.projectRoot, CURSOR_FROM_AMP_REL),
    });
  }

  /** Resolve a write target under `.cursor/rules/from-amp/`. */
  resolveWritePath(relativePath: string): string {
    return this.writer.resolveWritePath(relativePath);
  }

  async writeEmittedRule(relativePath: string, content: string): Promise<string> {
    return this.writer.writeRelative([relativePath], content);
  }

  async writeCompiledRule(procedure: CanonicalProcedure): Promise<string> {
    const compiled = compileProcedureToCursorMdc(procedure);
    return this.writeEmittedRule(compiled.filename, compiled.content);
  }
}
