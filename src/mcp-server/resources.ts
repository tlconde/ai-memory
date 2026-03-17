import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { safeRead, assertPathWithinAiDir } from "../utils/fs.js";
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

export function registerResources(server: Server, aiDir: string): void {
  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = [
      {
        uri: "memory://identity",
        name: "Identity + Project Status",
        description: "IDENTITY.md and PROJECT_STATUS.md — project constraints and current focus",
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
      const projectStatus = await safeRead(join(aiDir, "PROJECT_STATUS.md"));
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: [identity, projectStatus].filter(Boolean).join("\n\n---\n\n"),
          },
        ],
      };
    }

    if (uri === "memory://index") {
      const index = await safeRead(join(aiDir, "memory/memory-index.md"));
      return {
        contents: [{ uri, mimeType: "text/markdown", text: index || "Memory index not yet generated. Run `/mem-compound` to create it." }],
      };
    }

    if (uri === "memory://tails") {
      const tailSpecs = [
        { file: "memory/decisions.md", lines: 40, heading: "## Recent Decisions" },
        { file: "memory/debugging.md", lines: 30, heading: "## Recent Debugging" },
        { file: "memory/patterns.md", lines: 20, heading: "## Recent Patterns" },
        { file: "sessions/archive/thread-archive.md", lines: 200, heading: "## Session Archive (recent)" },
      ];
      const tails = await Promise.all(tailSpecs.map((s) => tail(join(aiDir, s.file), s.lines)));
      const sections = tailSpecs
        .map((s, i) => tails[i] ? `${s.heading}\n\n${tails[i]}` : null)
        .filter(Boolean) as string[];

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
      let relativePath: string;
      try {
        relativePath = decodeURIComponent(uri.slice("memory://file/".length));
      } catch {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid URI encoding: ${uri}`);
      }
      if (relativePath.includes("\0")) {
        throw new McpError(ErrorCode.InvalidRequest, "Path must not contain null bytes.");
      }
      const fullPath = assertPathWithinAiDir(aiDir, relativePath);
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
