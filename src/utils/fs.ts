import { readFile } from "fs/promises";
import { resolve, relative } from "path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/** Read a file safely, returning empty string if not found. */
export async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** Ensures a relative path stays within aiDir. Returns full path. Throws on path traversal. */
export function assertPathWithinAiDir(aiDir: string, relPath: string): string {
  const fullPath = resolve(aiDir, relPath);
  const rel = relative(aiDir, fullPath);
  if (rel.startsWith("..") || rel.startsWith("/") || /\.\.[\\/]/.test(rel)) {
    throw new McpError(ErrorCode.InvalidRequest, "Path traversal not allowed.");
  }
  return fullPath;
}
