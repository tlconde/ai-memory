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

    // M-2: Optional auth via env var
    const authToken = process.env.AI_MEMORY_AUTH_TOKEN;
    const authTokenBuf = authToken ? Buffer.from(authToken) : null;
    // M-3: Configurable CORS origins — comma-separated or * (default)
    const corsOriginsRaw = process.env.AI_MEMORY_CORS_ORIGINS ?? "*";
    const allowedOrigins = corsOriginsRaw === "*" ? null : corsOriginsRaw.split(",").map((o) => o.trim());

    const httpServer = createServer(async (req, res) => {
      // M-3: CORS — match request origin against allowed list
      const reqOrigin = req.headers.origin ?? "";
      if (allowedOrigins === null) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      } else if (allowedOrigins.includes(reqOrigin)) {
        res.setHeader("Access-Control-Allow-Origin", reqOrigin);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Refinement 1: Health check BEFORE auth — always public for load balancers
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      // M-2: Enforce auth for all non-health endpoints when token is configured
      if (authTokenBuf) {
        const header = req.headers.authorization;
        const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
        const providedBuf = Buffer.from(provided);
        // Refinement 4: Constant-time comparison to prevent timing attacks
        const match = authTokenBuf.length === providedBuf.length &&
          (await import("crypto")).timingSafeEqual(authTokenBuf, providedBuf);
        if (!match) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized. Set Authorization: Bearer <AI_MEMORY_AUTH_TOKEN>." }));
          return;
        }
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
      process.stderr.write(`[ai-memory] MCP HTTP server started on port ${port}.\n`);
      process.stderr.write(`[ai-memory] Endpoint: http://localhost:${port}/mcp\n`);
      if (authToken) process.stderr.write(`[ai-memory] Auth: Bearer token required\n`);
      if (corsOriginsRaw !== "*") process.stderr.write(`[ai-memory] CORS: ${corsOriginsRaw}\n`);
    });
  } else {
    // Default: stdio transport for local IDEs — silent startup (matches Context7/compound style)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    if (process.env.AI_MEMORY_DEBUG) {
      process.stderr.write(`[ai-memory] MCP server started (stdio). AI_DIR=${aiDir}\n`);
    }
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[ai-memory] Fatal error: ${msg}\n`);
  process.exit(1);
});
