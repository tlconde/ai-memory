#!/usr/bin/env node
// Grok CLI reads only `systemMessage` from a SessionStart hook, so the index reaches the model as a
// project rule instead: this writes `mem index` to <project>/.grok/rules/ai-memory-index.md.
// Usage: node sync-index.mjs [projectDir]. Exits 0 always; failures go to stderr.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isMain, mem } from '../_shared/emit.mjs';

export const rulesFile = (project) => join(project, '.grok', 'rules', 'ai-memory-index.md');

/** Writes the index as a rule, or removes the rule when the index is empty. */
export function writeRule(project, index) {
  const file = rulesFile(project);
  if (!index.trim()) return rmSync(file, { force: true });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, index.endsWith('\n') ? index : `${index}\n`);
}

if (isMain(import.meta.url)) {
  try {
    const project = resolve(process.argv[2] ?? process.cwd());
    const index = mem(['index'], '', project);
    if (index !== null) writeRule(project, index);
  } catch (e) {
    process.stderr.write(`ai-memory: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
