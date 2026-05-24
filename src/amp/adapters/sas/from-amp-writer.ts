/**
 * Shared from-amp write helper for surface adapters.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { joinInsideRoot } from "../../path-safety/guard.js";

export interface FromAmpWriterOptions {
  fromAmpRoot: string;
}

export class FromAmpWriter {
  readonly fromAmpRoot: string;

  constructor(options: FromAmpWriterOptions) {
    this.fromAmpRoot = options.fromAmpRoot;
  }

  resolveWritePath(...segments: string[]): string {
    return joinInsideRoot(this.fromAmpRoot, ...segments);
  }

  async writeRelative(segments: string[], content: string): Promise<string> {
    const target = this.resolveWritePath(...segments);
    const parent = join(this.fromAmpRoot, ...segments.slice(0, -1));
    await mkdir(parent, { recursive: true });
    await writeFile(target, content, "utf8");
    return target;
  }
}
