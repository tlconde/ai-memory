#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join, resolve, dirname } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { timingSafeEqual } from "crypto";
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

  // Read version from package.json — single source of truth
  const __dirname_mcp = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(__dirname_mcp, "..", "..", "package.json");
  const version = existsSync(pkgPath)
    ? JSON.parse(readFileSync(pkgPath, "utf-8")).version
    : "0.0.0";

  const server = new Server(
    { name: "ai-memory", version },
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

    const authToken = process.env.AI_MEMORY_AUTH_TOKEN;
    const authTokenBuf = authToken ? Buffer.from(authToken) : null;
    const corsOriginsRaw = process.env.AI_MEMORY_CORS_ORIGINS ?? "*";
    const allowedOrigins = corsOriginsRaw === "*" ? null : corsOriginsRaw.split(",").map((o) => o.trim());

    const httpServer = createServer(async (req, res) => {
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

      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (authTokenBuf) {
        const header = req.headers.authorization;
        const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
        const providedBuf = Buffer.from(provided);
        const match = authTokenBuf.length === providedBuf.length &&
          timingSafeEqual(authTokenBuf, providedBuf);
        if (!match) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized. Set Authorization: Bearer <AI_MEMORY_AUTH_TOKEN>." }));
          return;
        }
      }

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

// Only auto-run when executed directly (not when imported by CLI)
// import.meta.url is file:///path/to/index.js; process.argv[1] is /path/to/index.js
if (process.argv[1]) {
  const entryUrl = new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
  if (entryUrl === import.meta.url) {
    main().catch((err: unknown) => {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      process.stderr.write(`[ai-memory] Fatal error: ${msg}\n`);
      process.exit(1);
    });
  }
}
