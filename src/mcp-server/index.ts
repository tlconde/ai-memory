#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";

function resolveAiDir(): string {
  // Priority: AI_DIR env var → cwd/.ai
  const fromEnv = process.env.AI_DIR;
  if (fromEnv) return resolve(fromEnv);
  return join(process.cwd(), ".ai");
}

export async function main(options?: { http?: boolean; port?: number }): Promise<void> {
  const aiDir = resolveAiDir();

  if (!existsSync(aiDir)) {
    process.stderr.write(
      `[ai-memory] .ai/ directory not found at: ${aiDir}\n` +
        `Run \`ai-memory init\` in your project to set it up.\n`
    );
    process.exit(1);
  }

  const server = new Server(
    { name: "ai-memory", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } }
  );

  registerResources(server, aiDir);
  registerTools(server, aiDir);

  if (options?.http) {
    // HTTP transport for cloud agents (Cursor cloud, automations)
    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );
    const { createServer } = await import("http");

    const port = options.port ?? 3100;
    const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    const httpServer = createServer(async (req, res) => {
      // CORS for cloud agents
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", aiDir }));
        return;
      }

      // MCP endpoint
      if (req.url === "/mcp" || req.url === "/") {
        await httpTransport.handleRequest(req, res);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    await server.connect(httpTransport);
    httpServer.listen(port, () => {
      process.stderr.write(`[ai-memory] MCP HTTP server started on port ${port}. AI_DIR=${aiDir}\n`);
      process.stderr.write(`[ai-memory] Endpoint: http://localhost:${port}/mcp\n`);
      process.stderr.write(`[ai-memory] Health: http://localhost:${port}/health\n`);
    });
  } else {
    // Default: stdio transport for local IDEs
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`[ai-memory] MCP server started (stdio). AI_DIR=${aiDir}\n`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[ai-memory] Fatal error: ${msg}\n`);
  process.exit(1);
});
