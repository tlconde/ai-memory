/**
 * Minimal `.env.local` parser. No dependency on `dotenv`.
 *
 * Grammar (pragmatic subset):
 *  - blank lines and `#`-prefixed lines are ignored
 *  - `KEY=value`
 *  - `KEY="value with spaces"` — double-quoted value, supports escaped \n and \"
 *  - `KEY='value'` — single-quoted value, literal (no escapes)
 *  - inline `#` after an unquoted value starts a comment
 *
 * The parser only MUTATES `process.env` for keys that are not already set,
 * so shell env overrides the file.
 */
import { readFile } from "fs/promises";

export function parseEnvContent(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let rest = line.slice(eq + 1).trim();
    let value: string;

    if (rest.startsWith('"')) {
      const end = findUnescapedQuote(rest, 1, '"');
      if (end < 0) continue; // malformed; skip
      value = rest
        .slice(1, end)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      if (end < 0) continue;
      value = rest.slice(1, end);
    } else {
      // strip inline comment
      const hash = rest.indexOf(" #");
      if (hash >= 0) rest = rest.slice(0, hash).trim();
      value = rest;
    }
    out[key] = value;
  }
  return out;
}

function findUnescapedQuote(s: string, start: number, quote: string): number {
  for (let i = start; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === quote) return i;
  }
  return -1;
}

/**
 * Load `.env.local` from the given directory (if present) and inject into
 * `process.env` for any keys that are not already set. Missing file = no-op.
 */
export async function loadEnvLocal(dir: string): Promise<void> {
  const path = `${dir}/.env.local`;
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch {
    return;
  }
  const parsed = parseEnvContent(content);
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(
      `Required env var ${name} is not set. Put it in benchmarks/longmemeval/.env.local or export it in your shell.`
    );
  }
  return v;
}
