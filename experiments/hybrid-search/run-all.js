#!/usr/bin/env node
/**
 * Runs both hybrid search experiments natively (no WSL).
 * Approach A (QMD): BM25 on Windows; full hybrid on Linux/Mac.
 * Approach B (in-house): Transformers.js + keyword + RRF.
 */
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run(cwd, cmd, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit", cwd });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
  });
}

async function main() {
  console.log("=== Hybrid Search Experiment ===\n");

  // Approach A: QMD
  console.log("--- Approach A: QMD ---");
  const qmdDir = join(__dirname, "sandbox-a-qmd");
  await run(qmdDir, "npm", ["install"]);
  await run(qmdDir, "node", ["run-qmd-experiment.mjs"]);
  console.log("");

  // Approach B: In-house
  console.log("--- Approach B: In-house ---");
  const inhouseDir = join(__dirname, "sandbox-b-inhouse");
  await run(inhouseDir, "npm", ["install"]);
  await run(inhouseDir, "node", ["run.js"]);
  console.log("");

  console.log("=== Done. Results ===");
  const { readdirSync } = await import("fs");
  for (const f of readdirSync(join(__dirname, "results")).filter((x) => x.endsWith(".json"))) {
    console.log(" ", f);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
