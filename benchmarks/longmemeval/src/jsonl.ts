/**
 * Tiny JSONL reader / writer. One JSON object per line; embedded newlines in
 * string values are preserved via JSON's own `\n` escape (emitted by
 * `JSON.stringify`), so round-trip is safe.
 */
import { appendFile, readFile, writeFile } from "fs/promises";

export function stringifyRow(obj: unknown): string {
  // JSON.stringify already escapes newlines, quotes, etc. inside strings.
  return JSON.stringify(obj);
}

export function parseRow<T = unknown>(line: string): T {
  return JSON.parse(line) as T;
}

export async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  const body = rows.map(stringifyRow).join("\n") + (rows.length ? "\n" : "");
  await writeFile(path, body, "utf-8");
}

export async function appendJsonl(path: string, row: unknown): Promise<void> {
  await appendFile(path, stringifyRow(row) + "\n", "utf-8");
}

export async function readJsonl<T = unknown>(path: string): Promise<T[]> {
  const content = await readFile(path, "utf-8");
  const rows: T[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    rows.push(parseRow<T>(line));
  }
  return rows;
}
