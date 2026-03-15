#!/usr/bin/env node
/**
 * Cross-platform runner for hybrid search experiments.
 * On Windows: runs via WSL (fixes sqlite-vec + onnxruntime-node).
 * On Linux/Mac: runs natively.
 */
import { spawn } from "child_process";
import { platform } from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, "run-all.sh");

if (platform() === "win32") {
  // Convert Windows path to WSL path: D:\Dev\... -> /mnt/d/Dev/...
  const wslPath = __dirname.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
  const repoRoot = join(wslPath, "..", "..").replace(/\\/g, "/");
  // Run inline to avoid CRLF issues with run-all.sh on Windows
  const cmd = `
    cd "${repoRoot}" || exit 1
    echo "=== Hybrid Search Experiment ==="
    echo "Repo root: $PWD"
    echo ""
    echo "--- Approach A: QMD ---"
    cd experiments/hybrid-search/sandbox-a-qmd
    [ ! -d node_modules ] && npm install
    node run-qmd-experiment.mjs
    echo ""
    echo "--- Approach B: In-house ---"
    cd "${repoRoot}/experiments/hybrid-search/sandbox-b-inhouse"
    [ ! -d node_modules ] && npm install
    node run.js
    echo ""
    echo "=== Done. Results ==="
    ls -la "${repoRoot}/experiments/hybrid-search/results"/*.json
  `;
  console.log("[run-all] Windows detected. Running via WSL...\n");
  const proc = spawn("wsl", ["bash", "-c", cmd], {
    stdio: "inherit",
    shell: false,
  });
  proc.on("exit", (code) => process.exit(code ?? 0));
} else {
  const proc = spawn("bash", [scriptPath], {
    stdio: "inherit",
    cwd: join(__dirname, "..", ".."),
  });
  proc.on("exit", (code) => process.exit(code ?? 0));
}
