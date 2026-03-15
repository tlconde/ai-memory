import { readFile, writeFile, mkdir, unlink, open } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { execFileSync } from "child_process";
import matter from "gray-matter";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

// Input limits (security)
export const MAX_COMMIT_CONTENT_BYTES = 1024 * 1024; // 1MB
export const MAX_GIT_DIFF_BYTES = 512 * 1024; // 500KB

// Paths that are ALWAYS immutable (structural, not content)
export const ALWAYS_IMMUTABLE = ["toolbox/", "acp/", "rules/"];

// Paths whose immutability is controlled by frontmatter `writable` field
export const FRONTMATTER_CONTROLLED = ["IDENTITY.md", "PROJECT_STATUS.md"];
const WRITABLE_DEFAULTS: Record<string, boolean> = {
  "IDENTITY.md": false,
  "PROJECT_STATUS.md": true,
};

export async function isImmutable(path: string, aiDir: string): Promise<boolean> {
  if (ALWAYS_IMMUTABLE.some((p) => path === p || path.startsWith(p))) {
    return true;
  }
  for (const controlled of FRONTMATTER_CONTROLLED) {
    if (path === controlled) {
      const fullPath = join(aiDir, controlled);
      try {
        const content = await readFile(fullPath, "utf-8");
        const { data } = matter(content);
        if (typeof data.writable === "boolean") return !data.writable;
        return !WRITABLE_DEFAULTS[controlled];
      } catch {
        return !WRITABLE_DEFAULTS[controlled];
      }
    }
  }
  return false;
}

export function getRepoRoot(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function generateSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function sanitizeCommitMessage(msg: string): string {
  return msg
    .replace(/\0/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/["`]/g, "'")
    .slice(0, 2000)
    .trim() || "ai-memory: sync";
}

// Claim system: prevents concurrent writes to the same path
const CLAIM_TTL_MS = 5 * 60 * 1000;

interface Claim {
  session_id: string;
  timestamp: number;
  pid?: number;
}

export async function acquireClaim(aiDir: string, path: string, sessionId: string): Promise<void> {
  const locksDir = join(aiDir, "temp", "locks");
  await mkdir(locksDir, { recursive: true });
  const lockFile = join(locksDir, path.replace(/[/\\]/g, "_") + ".lock");

  if (existsSync(lockFile)) {
    try {
      const existing: Claim = JSON.parse(await readFile(lockFile, "utf-8"));
      const age = Date.now() - existing.timestamp;
      if (age < CLAIM_TTL_MS && existing.session_id !== sessionId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Path "${path}" is claimed by another session (${existing.session_id}, ${Math.round(age / 1000)}s ago). ` +
          `Wait for the claim to expire (${Math.round(CLAIM_TTL_MS / 1000)}s TTL) or close the other session.`
        );
      }
      await unlink(lockFile).catch(() => {});
    } catch (err) {
      if (err instanceof McpError) throw err;
      await unlink(lockFile).catch(() => {});
    }
  }

  const claim: Claim = { session_id: sessionId, timestamp: Date.now(), pid: process.pid };
  const data = JSON.stringify(claim);
  try {
    const fd = await open(lockFile, "wx");
    await fd.writeFile(data);
    await fd.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Path "${path}" was just claimed by another session. Retry shortly.`
      );
    }
    throw err;
  }
}

export async function releaseClaim(aiDir: string, path: string): Promise<void> {
  const lockFile = join(aiDir, "temp", "locks", path.replace(/[/\\]/g, "_") + ".lock");
  try { await unlink(lockFile); } catch { /* already gone */ }
}

// MCP response helper
export type McpResponse = { content: Array<{ type: string; text: string }>; isError?: boolean };

export function textResponse(text: string, isError?: boolean): McpResponse {
  const resp: McpResponse = { content: [{ type: "text", text }] };
  if (isError) resp.isError = true;
  return resp;
}
