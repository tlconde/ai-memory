#!/usr/bin/env node
/**
 * Update tool reference "Last verified" dates and optionally check llms.txt availability.
 * Run: node scripts/update-tool-refs.mjs
 * Options: --check-llms (fetch llms.txt URLs to verify they're reachable)
 */

import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REF_DIR = join(ROOT, "docs", "reference");
const TOOLS_DIR = join(REF_DIR, "tools");

const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const LLMS_URLS = [
  { tool: "claude-code", url: "https://code.claude.com/docs/llms.txt" },
  { tool: "windsurf", url: "https://docs.codeium.com/llms.txt" },
  { tool: "bolt", url: "https://support.bolt.new/llms.txt" },
];

async function checkLlms() {
  const check = process.argv.includes("--check-llms");
  if (!check) return;

  console.log("Checking llms.txt availability...\n");
  for (const { tool, url } of LLMS_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const ok = res.ok ? "✓" : "✗";
      console.log(`  ${ok} ${tool}: ${res.status} ${url}`);
    } catch (err) {
      console.log(`  ✗ ${tool}: ${err.message}`);
    }
  }
  console.log("");
}

async function updateLastVerified(filePath, date) {
  let content = await readFile(filePath, "utf-8");
  content = content.replace(
    /\*\*Last verified:\*\* \d{4}-\d{2}-\d{2}/,
    `**Last verified:** ${date}`
  );
  await writeFile(filePath, content);
}

async function main() {
  await checkLlms();

  // Update TOOLS_INDEX.md
  const indexPath = join(REF_DIR, "TOOLS_INDEX.md");
  let indexContent = await readFile(indexPath, "utf-8");
  indexContent = indexContent.replace(
    /\*\*Last updated:\*\* \d{4}-\d{2}-\d{2}/,
    `**Last updated:** ${TODAY}`
  );
  await writeFile(indexPath, indexContent);
  console.log(`Updated ${indexPath}`);

  // Update each tool file (exclude _template)
  const { readdir } = await import("fs/promises");
  const files = await readdir(TOOLS_DIR);
  const toolFiles = files.filter(
    (f) => f.endsWith(".md") && f !== "_template.md"
  );

  for (const f of toolFiles) {
    const path = join(TOOLS_DIR, f);
    await updateLastVerified(path, TODAY);
    console.log(`Updated ${f}`);
  }

  console.log(`\nDone. Last verified set to ${TODAY} for ${toolFiles.length} tools.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
