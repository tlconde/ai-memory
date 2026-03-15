import { readFile, readdir, stat } from "fs/promises";
import { join, relative, resolve } from "path";
import { existsSync } from "fs";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// Returns the last N lines of a file, or all lines if fewer than N
async function tail(filePath: string, lines: number): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    const all = content.split("\n");
    return all.slice(-lines).join("\n");
  } catch {
    return "";
  }
}

// Read a file safely, returning empty string if not found
async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

// Recursively list all .md files under a directory
async function listMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listMdFiles(full)));
    } else if (entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

export function registerResources(server: Server, aiDir: string): void {
  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = [
      {
        uri: "memory://identity",
        name: "Identity + Direction",
        description: "IDENTITY.md and DIRECTION.md — project constraints and current focus",
        mimeType: "text/markdown",
      },
      {
        uri: "memory://index",
        name: "Memory Index",
        description: "Priority-ranked index of all active memory entries (~500 tokens)",
        mimeType: "text/markdown",
      },
      {
        uri: "memory://tails",
        name: "Memory Tails",
        description: "Recent entries from decisions, debugging, patterns, and thread-archive",
        mimeType: "text/markdown",
      },
    ];

    // Add harness/active if it exists (Full tier)
    if (existsSync(join(aiDir, "temp/harness.json"))) {
      resources.push({
        uri: "memory://harness/active",
        name: "Active Harness Rules",
        description: "Currently active code constraint rules compiled from [P0] entries",
        mimeType: "application/json",
      });
    }

    // Add evals if report exists
    if (existsSync(join(aiDir, "temp/eval-report.json"))) {
      resources.push({
        uri: "memory://evals",
        name: "Eval Report",
        description: "Latest memory health and governance metrics",
        mimeType: "application/json",
      });
    }

    return { resources };
  });

  // Read a resource by URI
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    if (uri === "memory://identity") {
      const identity = await safeRead(join(aiDir, "IDENTITY.md"));
      const direction = await safeRead(join(aiDir, "DIRECTION.md"));
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: [identity, direction].filter(Boolean).join("\n\n---\n\n"),
          },
        ],
      };
    }

    if (uri === "memory://index") {
      const index = await safeRead(join(aiDir, "memory/memory-index.md"));
      return {
        contents: [{ uri, mimeType: "text/markdown", text: index || "Memory index not yet generated. Run `/mem:compound` to create it." }],
      };
    }

    if (uri === "memory://tails") {
      const sections: string[] = [];

      const decisionsTail = await tail(join(aiDir, "memory/decisions.md"), 40);
      if (decisionsTail) sections.push(`## Recent Decisions\n\n${decisionsTail}`);

      const debuggingTail = await tail(join(aiDir, "memory/debugging.md"), 30);
      if (debuggingTail) sections.push(`## Recent Debugging\n\n${debuggingTail}`);

      const patternsTail = await tail(join(aiDir, "memory/patterns.md"), 20);
      if (patternsTail) sections.push(`## Recent Patterns\n\n${patternsTail}`);

      const archiveTail = await tail(join(aiDir, "sessions/archive/thread-archive.md"), 200);
      if (archiveTail) sections.push(`## Session Archive (recent)\n\n${archiveTail}`);

      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: sections.join("\n\n---\n\n") || "No memory entries yet.",
          },
        ],
      };
    }

    if (uri === "memory://harness/active") {
      const harness = await safeRead(join(aiDir, "temp/harness.json"));
      return {
        contents: [{ uri, mimeType: "application/json", text: harness || "[]" }],
      };
    }

    if (uri === "memory://evals") {
      const report = await safeRead(join(aiDir, "temp/eval-report.json"));
      return {
        contents: [{ uri, mimeType: "application/json", text: report || "{}" }],
      };
    }

    // Dynamic: memory://file/{path}
    if (uri.startsWith("memory://file/")) {
      // L-2: Decode URI BEFORE path traversal check to prevent %2e%2e bypass
      let relativePath: string;
      try {
        relativePath = decodeURIComponent(uri.slice("memory://file/".length));
      } catch {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid URI encoding: ${uri}`);
      }
      // Security: ensure resolved path stays inside aiDir
      const fullPath = resolve(aiDir, relativePath);
      const rel = relative(aiDir, fullPath);
      if (rel.startsWith("..") || rel.startsWith("/") || /\.\.[\\/]/.test(rel)) {
        throw new McpError(ErrorCode.InvalidRequest, `Path traversal not allowed: ${relativePath}`);
      }
      const content = await safeRead(fullPath);
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: content || `File not found: ${relativePath}`,
          },
        ],
      };
    }

    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource URI: ${uri}`);
  });
}
