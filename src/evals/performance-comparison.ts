/**
 * Performance comparison eval: measures ai-memory adoption signals.
 *
 * These metrics track whether the memory system is being used and maintained,
 * not whether session archive text contains specific keywords.
 *
 * Metrics:
 *   - memory_depth        total entry count across memory files (more = more captured knowledge)
 *   - session_count       total sessions in thread-archive (more = regular usage)
 *   - constraint_coverage % of P0 entries with machine-checkable constraint_pattern
 *   - memory_freshness    days since newest entry was last_updated
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { EvalMetric } from "./types.js";

export async function evalMemoryDepth(aiDir: string): Promise<EvalMetric> {
  const memDir = join(aiDir, "memory");
  if (!existsSync(memDir)) {
    return { name: "memory_depth", value: 0, status: "warn", note: "No memory/ directory" };
  }

  let entryCount = 0;
  const files = await readdir(memDir);
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await readFile(join(memDir, file), "utf-8");
    entryCount += (content.match(/^### \[P[0-2]\]/gm) ?? []).length;
  }

  return {
    name: "memory_depth",
    value: entryCount,
    status: entryCount >= 10 ? "good" : entryCount >= 3 ? "warn" : "bad",
    note: `${entryCount} tagged entries across memory files`,
  };
}

export async function evalSessionCount(aiDir: string): Promise<EvalMetric> {
  const archivePath = join(aiDir, "sessions", "archive", "thread-archive.md");
  if (!existsSync(archivePath)) {
    return { name: "session_count", value: 0, status: "warn", note: "No thread-archive.md" };
  }

  const text = await readFile(archivePath, "utf-8");
  const sessions = (text.match(/^\[20\d\d-\d\d-\d\d\]/gm) ?? []).length;

  return {
    name: "session_count",
    value: sessions,
    status: sessions >= 5 ? "good" : sessions >= 1 ? "warn" : "bad",
    note: `${sessions} session(s) recorded in archive`,
  };
}

export async function evalMemoryFreshness(aiDir: string): Promise<EvalMetric> {
  const memDir = join(aiDir, "memory");
  if (!existsSync(memDir)) {
    return { name: "memory_freshness", value: "n/a", status: "warn", note: "No memory/ directory" };
  }

  let newest = "";
  const files = await readdir(memDir);
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await readFile(join(memDir, file), "utf-8");
    const match = content.match(/last_updated:\s*(\d{4}-\d{2}-\d{2})/);
    if (match && match[1] > newest) newest = match[1];
  }

  if (!newest) {
    return { name: "memory_freshness", value: "n/a", status: "warn", note: "No last_updated dates found" };
  }

  const days = Math.floor((Date.now() - new Date(newest).getTime()) / (1000 * 60 * 60 * 24));
  return {
    name: "memory_freshness",
    value: `${days}d`,
    status: days <= 7 ? "good" : days <= 30 ? "warn" : "bad",
    note: `Last memory update: ${newest}`,
  };
}
