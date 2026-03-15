#!/usr/bin/env node
/**
 * Platform-agnostic MCP launcher. Detects OS at runtime and spawns npx correctly.
 * Windows: spawn() cannot run npx.cmd directly — use cmd /c wrapper.
 * macOS/Linux: npx works directly.
 */
const { spawn } = require("child_process");

const isWin = process.platform === "win32";
const args = ["-y", "@radix-ai/ai-memory", "mcp"];

const child = isWin
  ? spawn("cmd", ["/c", "npx", ...args], { stdio: "inherit", env: process.env })
  : spawn("npx", args, { stdio: "inherit", env: process.env });

child.on("error", (err) => {
  console.error("[ai-memory-mcp] spawn failed:", err.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
