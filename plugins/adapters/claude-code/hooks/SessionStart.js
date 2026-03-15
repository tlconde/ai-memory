#!/usr/bin/env node
/**
 * ai-memory — Claude Code SessionStart hook
 *
 * Runs at the start of every Claude Code session.
 * Reads .ai/ context and prints it to stdout for injection into the session.
 *
 * Claude Code passes the hook output as additional context.
 * See: https://docs.claude.com/en/docs/claude-code/plugins#hooks
 */

import { readFile } from "fs";
import { join } from "path";
import { existsSync } from "fs";

const aiDir = join(process.cwd(), ".ai");

async function safeRead(filePath) {
  return new Promise((resolve) => {
    readFile(filePath, "utf-8", (err, data) => resolve(err ? "" : data));
  });
}

async function main() {
  if (!existsSync(aiDir)) {
    // .ai/ not set up — exit silently, don't block the session
    process.exit(0);
  }

  const sections = [];

  const identity = await safeRead(join(aiDir, "IDENTITY.md"));
  if (identity) sections.push(identity.trim());

  const direction = await safeRead(join(aiDir, "DIRECTION.md"));
  if (direction) sections.push(direction.trim());

  const index = await safeRead(join(aiDir, "memory/memory-index.md"));
  if (index && !index.includes("<!-- Index will be generated")) {
    sections.push(`## Memory Index (priority-ranked)\n\n${index.trim()}`);
  }

  if (sections.length === 0) {
    process.exit(0);
  }

  const output = {
    type: "context",
    content: sections.join("\n\n---\n\n"),
  };

  process.stdout.write(JSON.stringify(output));
}

main().catch(() => process.exit(0));
