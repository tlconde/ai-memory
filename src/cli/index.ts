#!/usr/bin/env node
import { Command } from "commander";
import { writeFile, mkdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { DEFAULT_DOCS_SCHEMA_JSON } from "../docs-schema.js";
import { TOOL_ADAPTERS, getMCPJson, MCP_LAUNCHER, MCP_LAUNCHER_PATH, CANONICAL_SKILLS } from "./adapters.js";
import { detectEnvironments, injectCapabilityConfig } from "./environment.js";

// Read version from package.json — single source of truth
const __dirname_cli = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname_cli, "..", "..", "package.json");
const PKG_VERSION: string = existsSync(pkgPath)
  ? JSON.parse(readFileSync(pkgPath, "utf-8")).version
  : "0.0.0";

const KEBAB_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
function validateKebabCase(name: string, label: string): void {
  if (!KEBAB_RE.test(name)) {
    console.error(`Invalid ${label} name: "${name}". Must be kebab-case (e.g. my-${label}).`);
    process.exit(1);
  }
}

const program = new Command();

program
  .name("ai-memory")
  .description("Persistent AI memory for any project.")
  .version(PKG_VERSION);

// ─── init ───────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Scaffold .ai/ in the current project")
  .option("--full", "Full tier: adds governance, evals, and ACP")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .option("--download-model", "Pre-download the hybrid search model (~23MB) for faster first search")
  .action(async (opts) => {
    const targetDir = resolve(opts.dir ?? process.cwd());
    const aiDir = join(targetDir, ".ai");
    const full = opts.full ?? false;

    if (existsSync(aiDir)) {
      const updated = await scaffoldUpdates(aiDir, full);
      if (updated.length > 0) {
        console.log(`\n✓ Added ${updated.length} missing file(s) to existing .ai/`);
      } else if (full) {
        console.log(`✓ .ai/ already has full tier. Nothing to add.`);
      } else {
        console.log(`✓ .ai/ already exists. Use --full to add governance, docs schema, and ACP.`);
      }
      if (opts.downloadModel) {
        console.log(`\nDownloading hybrid search model...`);
        const { warmSearchModel } = await import("../hybrid-search/index.js");
        await warmSearchModel();
        console.log(`✓ Model ready.`);
      }
      process.exit(0);
    }

    console.log(`Initializing ai-memory in ${targetDir}...`);
    await scaffoldAiDir(aiDir, full);

    if (opts.downloadModel) {
      console.log(`\nDownloading hybrid search model (~23MB)...`);
      const { warmSearchModel } = await import("../hybrid-search/index.js");
      await warmSearchModel();
      console.log(`✓ Model ready.`);
    }

    console.log(`\n✓ Done. Next step:`);
    console.log(`  Run /mem-init in your AI tool for guided setup with project-specific recommendations.`);
    console.log(`  Or manually edit .ai/IDENTITY.md and .ai/PROJECT_STATUS.md.`);
    console.log(``);
    console.log(`  Connect your tool:  ai-memory install --to <tool>`);
    console.log(`  Supported tools:    cursor, claude-code, windsurf, cline, copilot`);
  });

async function scaffoldAiDir(aiDir: string, full: boolean): Promise<void> {
  // Core dirs (always)
  const coreDirs = [
    "",
    "memory",
    "agents",
    "skills",
    "toolbox",
    "rules",
    "sessions",
    "sessions/archive",
    "reference",
  ];

  for (const dir of coreDirs) {
    await mkdir(join(aiDir, dir), { recursive: true });
  }

  // Core files
  await writeTemplateFile(aiDir, "IDENTITY.md", DEFAULT_IDENTITY);
  await writeTemplateFile(aiDir, "PROJECT_STATUS.md", DEFAULT_PROJECT_STATUS);
  await writeTemplateFile(aiDir, "memory/decisions.md", DEFAULT_DECISIONS);
  await writeTemplateFile(aiDir, "memory/patterns.md", DEFAULT_PATTERNS);
  await writeTemplateFile(aiDir, "memory/debugging.md", DEFAULT_DEBUGGING);
  await writeTemplateFile(aiDir, "memory/improvements.md", DEFAULT_IMPROVEMENTS);
  await writeTemplateFile(aiDir, "memory/memory-index.md", DEFAULT_MEMORY_INDEX);
  await writeTemplateFile(aiDir, "agents/_base-auditor.md", DEFAULT_BASE_AUDITOR);
  await writeTemplateFile(aiDir, "agents/_template.md", DEFAULT_AGENT_TEMPLATE);
  await writeTemplateFile(aiDir, "sessions/open-items.md", DEFAULT_OPEN_ITEMS);
  await writeTemplateFile(aiDir, "sessions/archive/thread-archive.md", DEFAULT_THREAD_ARCHIVE);
  await writeTemplateFile(aiDir, "reference/PROJECT.md", DEFAULT_PROJECT);

  if (full) {
    await mkdir(join(aiDir, "acp"), { recursive: true });
    await mkdir(join(aiDir, "temp"), { recursive: true });
    await mkdir(join(aiDir, "temp/rule-tests"), { recursive: true });
    await writeTemplateFile(aiDir, "acp/manifest.json", DEFAULT_ACP_MANIFEST);
    await writeTemplateFile(aiDir, "acp/capabilities.md", DEFAULT_ACP_CAPABILITIES);
    await writeTemplateFile(aiDir, "docs-schema.json", DEFAULT_DOCS_SCHEMA_JSON);
    await writeTemplateFile(aiDir, "rules/doc-placement.md", DEFAULT_DOC_PLACEMENT_RULE);
    await writeTemplateFile(aiDir, "agents/docs-manager.md", DEFAULT_DOCS_MANAGER_AGENT);
  }
}

async function writeTemplateFile(aiDir: string, relativePath: string, content: string): Promise<void> {
  const fullPath = join(aiDir, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
  console.log(`  + .ai/${relativePath}`);
}

/** Add only missing files when .ai/ already exists. Never overwrites. Returns paths added. */
async function scaffoldUpdates(aiDir: string, full: boolean): Promise<string[]> {
  const added: string[] = [];

  async function addIfMissing(relativePath: string, content: string): Promise<void> {
    const fullPath = join(aiDir, relativePath);
    if (!existsSync(fullPath)) {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
      console.log(`  + .ai/${relativePath}`);
      added.push(relativePath);
    }
  }

  if (full) {
    await mkdir(join(aiDir, "acp"), { recursive: true });
    await mkdir(join(aiDir, "temp"), { recursive: true });
    await mkdir(join(aiDir, "temp/rule-tests"), { recursive: true });
    await addIfMissing("acp/manifest.json", DEFAULT_ACP_MANIFEST);
    await addIfMissing("acp/capabilities.md", DEFAULT_ACP_CAPABILITIES);
    await addIfMissing("docs-schema.json", DEFAULT_DOCS_SCHEMA_JSON);
    await addIfMissing("rules/doc-placement.md", DEFAULT_DOC_PLACEMENT_RULE);
    await addIfMissing("agents/docs-manager.md", DEFAULT_DOCS_MANAGER_AGENT);
  }

  return added;
}

// ─── install ─────────────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install the ai-memory bootstrap for a specific tool")
  .requiredOption("--to <tool>", `Target tool (${Object.keys(TOOL_ADAPTERS).join(", ")})`)
  .option("--dir <dir>", "Project root (default: current directory)")
  .option("--capability <cap>", "Inject capability config (browser, screen_capture). Repeatable.", (v, acc: string[]) => (acc ?? []).concat(v), [])
  .action(async (opts) => {
    const tool = opts.to.toLowerCase();
    const adapter = TOOL_ADAPTERS[tool];
    if (!adapter) {
      console.error(`Unknown tool: ${tool}`);
      console.error(`Supported: ${Object.keys(TOOL_ADAPTERS).join(", ")}`);
      process.exit(1);
    }

    const projectRoot = resolve(opts.dir ?? process.cwd());
    const aiDir = join(projectRoot, ".ai");

    if (!existsSync(aiDir)) {
      console.log(`.ai/ not found — running init first...`);
      await scaffoldAiDir(aiDir, false);
      console.log(`✓ Scaffolded .ai/\n`);
    }

    const destPath = join(projectRoot, adapter.dest);

    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, adapter.content);
    console.log(`✓ Wrote ${adapter.dest}`);

    // Write extra files (e.g., skill stubs, hooks)
    if (adapter.extraFiles) {
      for (const [relPath, content] of Object.entries(adapter.extraFiles)) {
        const extraPath = join(projectRoot, relPath);
        await mkdir(dirname(extraPath), { recursive: true });
        await writeFile(extraPath, content);
        console.log(`✓ Wrote ${relPath}`);
      }
    }

    // Write canonical skill definitions to .ai/skills/
    for (const [skillName, content] of Object.entries(CANONICAL_SKILLS)) {
      const skillPath = join(projectRoot, ".ai", "skills", skillName, "SKILL.md");
      await mkdir(dirname(skillPath), { recursive: true });
      await writeFile(skillPath, content);
      console.log(`✓ Wrote .ai/skills/${skillName}/SKILL.md (canonical)`);
    }

    if (tool === "claude-code") {
      console.log(`\n  Hooks installed: SessionStart (context injection), PreCompact (state preservation)`);
      console.log(`  Note: Restart Claude Code for hooks to take effect.`);
    }

    if (adapter.mcp) {
      const launcherPath = join(projectRoot, MCP_LAUNCHER_PATH);
      await mkdir(dirname(launcherPath), { recursive: true });
      await writeFile(launcherPath, MCP_LAUNCHER);
      console.log(`✓ Wrote ${MCP_LAUNCHER_PATH}`);

      const mcpRelPath = adapter.mcpPath ?? ".mcp.json";
      const mcpPath = join(projectRoot, mcpRelPath);
      const mcpJson = getMCPJson();
      if (!existsSync(mcpPath)) {
        await mkdir(dirname(mcpPath), { recursive: true });
        await writeFile(mcpPath, mcpJson);
        console.log(`✓ Wrote ${mcpRelPath}`);
      } else {
        console.log(`  ${mcpRelPath} already exists — skipped`);
      }
    }

    // Capability injection: detect environments and inject MCP config for requested capabilities
    const rawCap = opts.capability as string | string[] | undefined;
    const capabilities = Array.isArray(rawCap) ? rawCap : rawCap ? [rawCap] : [];
    if (capabilities.length > 0) {
      const pkgRoot = join(__dirname_cli, "..", "..");
      const envs = detectEnvironments(projectRoot, pkgRoot);
      for (const cap of capabilities) {
        if (cap !== "browser" && cap !== "screen_capture") {
          console.warn(`  [warn] Unknown capability: ${cap}. Skipping.`);
          continue;
        }
        let injected = 0;
        for (const envId of envs) {
          try {
            if (injectCapabilityConfig(projectRoot, envId, cap, pkgRoot)) {
              console.log(`✓ Injected ${cap} config for ${envId}`);
              injected++;
            }
          } catch (e) {
            console.warn(`  [warn] Failed to inject ${cap} for ${envId}: ${(e as Error).message}`);
          }
        }
        if (cap === "screen_capture" && injected === 0 && envs.length > 0) {
          console.warn(`  [warn] screen_capture has no MCP config — it uses platform tools (e.g. Peekaboo). See capability-specs.json.`);
        }
      }
    }

    console.log(`\nDone. Start a new ${opts.to} session and verify:`);
    console.log(`  1. MCP connected: "Call search_memory with query 'test'" (should return results, not an error)`);
    console.log(`  2. Memory loaded:  "What does .ai/IDENTITY.md say about this project?"`);
    console.log(`\nIf search_memory is not available, restart your editor — MCP servers load at startup.`);
  });

// ─── mcp ────────────────────────────────────────────────────────────────────

program
  .command("mcp")
  .description("Start the MCP server")
  .option("--dir <dir>", "Path to .ai/ directory (default: ./ai)")
  .option("--http", "Use HTTP transport instead of stdio (for cloud agents)")
  .option("--port <port>", "HTTP port (default: 3100)", parseInt)
  .action(async (opts: { dir?: string; http?: boolean; port?: number }) => {
    if (opts.dir) process.env.AI_DIR = resolve(opts.dir);
    const { main } = await import("../mcp-server/index.js");
    await main({ http: opts.http, port: opts.port });
  });

// ─── validate ───────────────────────────────────────────────────────────────

program
  .command("validate")
  .description("Validate all .ai/ files against canonical schema")
  .option("--dir <dir>", "Path to .ai/ directory (default: ./ai)")
  .action(async (opts) => {
    const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
    if (!existsSync(aiDir)) {
      console.error(`No .ai/ directory found at ${aiDir}. Run \`ai-memory init\` first.`);
      process.exit(1);
    }
    const { validateAll } = await import("../formatter/index.js");
    const results = await validateAll(aiDir);
    const errs = results.filter((e) => e.severity !== "warn");
    const warns = results.filter((e) => e.severity === "warn");
    if (warns.length > 0) {
      for (const w of warns) console.warn(`  [warn] ${w.file}: ${w.message}`);
    }
    if (errs.length === 0) {
      console.log("✓ All files valid.");
    } else {
      console.error(`${errs.length} validation error(s):\n`);
      for (const e of errs) console.error(`  ${e.file}: ${e.message}`);
      process.exit(1);
    }
  });

// ─── index ───────────────────────────────────────────────────────────────────

program
  .command("index")
  .description("Regenerate memory-index.md from decisions, patterns, debugging, improvements")
  .option("--dir <dir>", "Path to .ai/ directory (default: ./ai)")
  .action(async (opts) => {
    const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
    if (!existsSync(aiDir)) {
      console.error(`No .ai/ directory found at ${aiDir}. Run \`ai-memory init\` first.`);
      process.exit(1);
    }
    const { generateMemoryIndex } = await import("../formatter/index.js");
    await generateMemoryIndex(aiDir);
    console.log("✓ Regenerated memory-index.md");
  });

// ─── fmt ────────────────────────────────────────────────────────────────────

program
  .command("fmt")
  .description("Auto-format YAML frontmatter on .ai/ files")
  .option("--dir <dir>", "Path to .ai/ directory (default: ./ai)")
  .action(async (opts) => {
    const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
    if (!existsSync(aiDir)) {
      console.error(`No .ai/ directory found at ${aiDir}.`);
      process.exit(1);
    }
    const { formatAll } = await import("../formatter/index.js");
    const count = await formatAll(aiDir);
    console.log(`✓ Formatted ${count} file(s).`);
  });

// ─── eval ────────────────────────────────────────────────────────────────────

const evalCmd = program
  .command("eval")
  .description("Run memory health report (or manage custom evals)")
  .option("--dir <dir>", "Path to .ai/ directory (default: ./ai)")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
    if (!existsSync(aiDir)) {
      console.error(`No .ai/ directory found at ${aiDir}.`);
      process.exit(1);
    }
    const { runEvals } = await import("../evals/index.js");
    const report = await runEvals(aiDir);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printEvalReport(report);
    }
  });

function printEvalReport(report: { metrics?: Array<{ name: string; value: unknown; status: string; note?: string }> }): void {
  console.log("\n── ai-memory eval report ──────────────────────\n");
  const metrics = report.metrics ?? [];
  for (const m of metrics) {
    const icon = m.status === "good" ? "✓" : m.status === "warn" ? "⚠" : "✗";
    console.log(`  ${icon} ${m.name}: ${m.value}${m.note ? `  (${m.note})` : ""}`);
  }
  console.log("");
}

// ─── generate-harness ────────────────────────────────────────────────────────

program
  .command("generate-harness")
  .description("Compile harness.json from current [P0] entries")
  .option("--dir <dir>", "Path to .ai/ directory (default: ./ai)")
  .action(async (opts) => {
    const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
    const { readP0Entries, compileHarnessRules, generateRuleTests } = await import("../governance/p0-parser.js");

    const entries = await readP0Entries(aiDir);
    const rules = compileHarnessRules(entries);
    const tests = generateRuleTests(entries);

    const tempDir = join(aiDir, "temp");
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, "harness.json"), JSON.stringify(rules, null, 2));

    if (tests.length > 0) {
      const testsDir = join(tempDir, "rule-tests");
      await mkdir(testsDir, { recursive: true });
      await writeFile(join(testsDir, "tests.json"), JSON.stringify(tests, null, 2));
    }

    console.log(`✓ ${rules.length} rule(s) compiled from ${entries.length} [P0] entries.`);
    if (tests.length > 0) console.log(`  ${tests.length} rule test(s) written.`);
  });

// ─── prune ──────────────────────────────────────────────────────────────────

program
  .command("prune")
  .description("Review stale or deprecated memory entries")
  .option("--dir <dir>", "Path to .ai/ directory (default: ./ai)")
  .option("--dry-run", "Report candidates without modifying files (default)", true)
  .action(async (opts: { dir?: string; dryRun?: boolean }) => {
    const { readdir, readFile: rf } = await import("fs/promises");
    const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
    const memDir = join(aiDir, "memory");
    if (!existsSync(memDir)) {
      console.error(`No .ai/memory/ directory found at ${memDir}.`);
      process.exit(1);
    }
    const files = await readdir(memDir);
    const candidates: string[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await rf(join(memDir, file), "utf-8");
      const matches = content.match(/### \[P[0-2]\].+\[DEPRECATED\]/g);
      if (matches) {
        candidates.push(`${file}: ${matches.length} deprecated entry/entries`);
      }
    }
    if (candidates.length === 0) {
      console.log("✓ No stale entries found.");
      return;
    }
    console.log(`Found ${candidates.length} file(s) with deprecated entries:\n`);
    for (const c of candidates) console.log(`  • ${c}`);
    if (opts.dryRun !== false) {
      console.log("\nRun with --no-dry-run to archive these entries.");
    }
  });

// ─── validate-docs ───────────────────────────────────────────────────────────

program
  .command("validate-docs")
  .description("Validate documentation file placement and naming against .ai/docs-schema.json")
  .option("--dir <dir>", "Project root (default: current directory)")
  .option("--paths <paths>", "Comma-separated paths to check (default: from git diff --name-only)")
  .action(async (opts: { dir?: string; paths?: string }) => {
    const projectRoot = resolve(opts.dir ?? process.cwd());
    const aiDir = join(projectRoot, ".ai");
    const { loadDocsSchema, validateDocPlacement } = await import("../docs-schema.js");

    const schema = await loadDocsSchema(projectRoot);
    if (!schema) {
      console.log("No .ai/docs-schema.json found. Run `ai-memory init --full` to create one.");
      process.exit(0);
    }

    let paths: string[] = [];
    if (opts.paths) {
      paths = opts.paths.split(",").map((p) => p.trim()).filter(Boolean);
    } else {
      try {
        const { execFileSync } = await import("child_process");
        const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=A"], {
          cwd: projectRoot,
          encoding: "utf-8",
        });
        paths = out.trim().split("\n").filter(Boolean);
      } catch {
        console.log("Not a git repo or no staged files. Use --paths to specify files.");
        process.exit(0);
      }
    }

    const docPaths = paths.filter((p) => p.endsWith(".md") || p.endsWith(".yaml") || p.endsWith(".yml"));
    if (docPaths.length === 0) {
      console.log("✓ No documentation files to validate.");
      process.exit(0);
    }

    let hasErrors = false;
    for (const p of docPaths) {
      const rel = p.replace(/\\/g, "/");
      const result = validateDocPlacement(schema, rel, projectRoot);
      if (!result.valid) {
        hasErrors = true;
        for (const e of result.errors) console.error(`  ${rel}: ${e}`);
      }
    }
    if (hasErrors) {
      console.error("\nFix the above or add to .ai/docs-schema.json. Use SCREAMING_SNAKE_CASE for doc filenames.");
      process.exit(1);
    }
    console.log(`✓ ${docPaths.length} doc file(s) validated.`);
  });

// ─── agent create ────────────────────────────────────────────────────────────

program
  .command("agent")
  .description("Manage agents")
  .addCommand(
    new Command("create")
      .argument("<name>", "Agent name (kebab-case)")
      .description("Scaffold a new agent in .ai/agents/<name>/AGENT.md")
      .option("--dir <dir>", "Path to .ai/ directory")
      .action(async (name: string, opts: { dir?: string }) => {
        validateKebabCase(name, "agent");
        const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
        const agentDir = join(aiDir, "agents", name);
        await mkdir(agentDir, { recursive: true });
        const path = join(agentDir, "AGENT.md");
        if (existsSync(path)) { console.log(`⚠ Already exists: ${path}`); return; }
        await writeFile(path, agentTemplate(name));
        console.log(`✓ Created .ai/agents/${name}/AGENT.md`);
      })
  );

// ─── skill create ────────────────────────────────────────────────────────────

program
  .command("skill")
  .description("Manage skills")
  .addCommand(
    new Command("create")
      .argument("<name>", "Skill name (kebab-case)")
      .description("Scaffold a new skill in .ai/skills/<name>/SKILL.md")
      .option("--dir <dir>", "Path to .ai/ directory")
      .action(async (name: string, opts: { dir?: string }) => {
        validateKebabCase(name, "skill");
        const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
        const skillDir = join(aiDir, "skills", name);
        await mkdir(skillDir, { recursive: true });
        const path = join(skillDir, "SKILL.md");
        if (existsSync(path)) { console.log(`⚠ Already exists: ${path}`); return; }
        await writeFile(path, skillTemplate(name));
        console.log(`✓ Created .ai/skills/${name}/SKILL.md`);
      })
  );

// ─── rule create ────────────────────────────────────────────────────────────

program
  .command("rule")
  .description("Manage rules")
  .addCommand(
    new Command("create")
      .argument("<name>", "Rule name (kebab-case)")
      .description("Scaffold a new rule in .ai/rules/<name>.md")
      .option("--dir <dir>", "Path to .ai/ directory")
      .action(async (name: string, opts: { dir?: string }) => {
        validateKebabCase(name, "rule");
        const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
        await mkdir(join(aiDir, "rules"), { recursive: true });
        const rulePath = join(aiDir, "rules", `${name}.md`);
        if (existsSync(rulePath)) { console.log(`⚠ Already exists: ${rulePath}`); return; }
        await writeFile(rulePath, ruleTemplate(name));
        console.log(`✓ Created .ai/rules/${name}.md`);
      })
  );

// ─── verify ─────────────────────────────────────────────────────────────────

program
  .command("verify")
  .description("Verify ai-memory installation: .ai/ structure, bootstrap, MCP config")
  .option("--dir <dir>", "Project root (default: current directory)")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const projectRoot = resolve(opts.dir ?? process.cwd());
    const aiDir = join(projectRoot, ".ai");
    const checks: Array<{ name: string; status: "pass" | "fail" | "warn"; detail: string }> = [];

    // 1. .ai/ exists with core files
    const aiExists = existsSync(aiDir);
    checks.push({ name: ".ai/ directory", status: aiExists ? "pass" : "fail", detail: aiExists ? "Found" : "Missing — run `ai-memory init`" });
    if (aiExists) {
      for (const f of ["IDENTITY.md", "PROJECT_STATUS.md", "memory/memory-index.md"]) {
        const exists = existsSync(join(aiDir, f));
        checks.push({ name: f, status: exists ? "pass" : "fail", detail: exists ? "Found" : "Missing" });
      }
    }

    // 2. MCP launcher + config
    const launcherExists = existsSync(join(projectRoot, ".ai/mcp-launcher.cjs"));
    checks.push({ name: "MCP launcher", status: launcherExists ? "pass" : "fail", detail: launcherExists ? "Found" : "Missing — run `ai-memory install --to <tool>`" });

    const mcpLocations = [".mcp.json", ".cursor/mcp.json"].filter((p) => existsSync(join(projectRoot, p)));
    checks.push({ name: "MCP config", status: mcpLocations.length > 0 ? "pass" : "warn", detail: mcpLocations.length > 0 ? mcpLocations.join(", ") : "None found — MCP tools won't be available" });

    // 3. Bootstrap installed for at least one tool
    const bootstrapMap: Record<string, string> = { "claude-code": "CLAUDE.md", cursor: ".cursor/rules/00-load-ai-memory.mdc", windsurf: ".windsurfrules", cline: ".clinerules", copilot: ".github/copilot-instructions.md" };
    const installed = Object.entries(bootstrapMap).filter(([, p]) => existsSync(join(projectRoot, p))).map(([t]) => t);
    checks.push({ name: "Bootstrap", status: installed.length > 0 ? "pass" : "warn", detail: installed.length > 0 ? `Installed for: ${installed.join(", ")}` : "None — run `ai-memory install --to <tool>`" });

    // 4. Bootstrap has canonical redirect
    if (installed.length > 0) {
      const content = readFileSync(join(projectRoot, bootstrapMap[installed[0]]), "utf-8");
      const hasRedirect = content.includes("canonical memory") || content.includes("not in your tool");
      checks.push({ name: "Canonical memory directive", status: hasRedirect ? "pass" : "warn", detail: hasRedirect ? "Agent told to save to .ai/, not tool-native memory" : "Missing — re-run install to update" });
    }

    // 5. Memory index populated
    const idxPath = join(aiDir, "memory/memory-index.md");
    if (existsSync(idxPath)) {
      const idx = readFileSync(idxPath, "utf-8");
      const populated = idx.includes("[P0]") || idx.includes("[P1]");
      checks.push({ name: "Memory index", status: populated ? "pass" : "warn", detail: populated ? "Has entries" : "Empty — run /mem-compound after a session" });
    }

    // 6. Harness validity
    const harnessPath = join(aiDir, "temp/harness.json");
    if (existsSync(harnessPath)) {
      try {
        const rules = JSON.parse(readFileSync(harnessPath, "utf-8")) as Array<{ id?: string; type?: string; pattern?: string; severity?: string }>;
        if (!Array.isArray(rules)) throw new Error("not an array");
        checks.push({ name: "Harness rules", status: "pass", detail: `${rules.length} rules loaded` });

        // Check rules compile
        let broken = 0;
        for (const rule of rules) {
          if (!rule.id || !rule.type || !rule.pattern || !rule.severity) { broken++; continue; }
          if (rule.type === "regex") {
            try { new RegExp(rule.pattern); } catch { broken++; }
          }
        }
        checks.push({ name: "Rules compile", status: broken === 0 ? "pass" : "fail", detail: broken === 0 ? "All rules valid" : `${broken} rules have errors` });

        // P0 rule coverage
        let p0Count = 0;
        for (const mf of ["memory/decisions.md", "memory/debugging.md"]) {
          const fp = join(aiDir, mf);
          if (existsSync(fp)) { p0Count += (readFileSync(fp, "utf-8").match(/### \[P0\]/g) ?? []).length; }
        }
        const cov = p0Count > 0 ? Math.round((rules.length / p0Count) * 100) : 0;
        checks.push({ name: "P0 rule coverage", status: cov >= 80 ? "pass" : cov >= 50 ? "warn" : "fail", detail: `${rules.length}/${p0Count} P0 entries have enforceable patterns (${cov}%)` });

        // Rule tests
        const testsPath = join(aiDir, "temp/rule-tests/tests.json");
        if (existsSync(testsPath)) {
          try {
            const tests = JSON.parse(readFileSync(testsPath, "utf-8")) as Array<{ rule_id: string }>;
            const testedIds = new Set(tests.map((t) => t.rule_id));
            const untested = rules.filter((r) => r.id && !testedIds.has(r.id));
            checks.push({ name: "Rule test coverage", status: untested.length === 0 ? "pass" : "warn", detail: untested.length === 0 ? `All ${rules.length} rules have tests` : `${untested.length} rules without tests` });
          } catch { checks.push({ name: "Rule tests", status: "warn", detail: "tests.json failed to parse" }); }
        } else {
          checks.push({ name: "Rule tests", status: "warn", detail: "No tests.json — run generate-harness to create" });
        }
      } catch (e) {
        checks.push({ name: "Harness rules", status: "fail", detail: `harness.json parse error: ${(e as Error).message}` });
      }
    } else {
      checks.push({ name: "Harness rules", status: "warn", detail: "No harness.json — run `ai-memory generate-harness` or init --full" });
    }

    // Output
    if (opts.json) {
      const p = checks.filter((c) => c.status === "pass").length;
      console.log(JSON.stringify({ checks, summary: { total: checks.length, passed: p, failed: checks.filter((c) => c.status === "fail").length, warnings: checks.filter((c) => c.status === "warn").length } }, null, 2));
    } else {
      console.log("=== ai-memory verify ===\n");
      for (const c of checks) {
        const icon = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "⚠";
        console.log(`  ${icon} ${c.name}: ${c.detail}`);
      }
      const p = checks.filter((c) => c.status === "pass").length;
      const f = checks.filter((c) => c.status === "fail").length;
      const w = checks.filter((c) => c.status === "warn").length;
      console.log(`\n  ${p} passed, ${f} failed, ${w} warnings`);
      if (f > 0) { console.log("\n  Fix failures, then run `ai-memory verify` again."); process.exit(1); }
    }
  });

// ─── eval add (subcommand of eval) ──────────────────────────────────────────

evalCmd.addCommand(
  new Command("add")
    .argument("<name>", "Eval metric name (kebab-case)")
    .description("Scaffold a custom eval metric")
    .option("--dir <dir>", "Path to .ai/ directory")
    .action(async (name: string, opts: { dir?: string }) => {
      validateKebabCase(name, "eval metric");
      const aiDir = resolve(opts.dir ?? join(process.cwd(), ".ai"));
      const evalsDir = join(aiDir, "temp", "custom-evals");
      await mkdir(evalsDir, { recursive: true });
      const destPath = join(evalsDir, `${name}.ts`);
      if (existsSync(destPath)) { console.log(`⚠ Already exists: ${destPath}`); return; }
      await writeFile(destPath, evalTemplate(name));
      console.log(`✓ Created .ai/temp/custom-evals/${name}.ts`);
    })
);

program.parse(process.argv);

// ─── Scaffold templates ───────────────────────────────────────────────────────

function agentTemplate(name: string): string {
  return `---
name: ${name}
description: Describe what this agent does and when to invoke it.
type: agent
status: active
---

# ${name}

## Role

Describe the agent's role here.

## Methodology

1. Step one
2. Step two
3. Report findings

## Report Format

- **Finding**: Description
- **Recommendation**: What to do about it
`;
}

function skillTemplate(name: string): string {
  return `---
name: ${name}
description: Describe what this skill does and when to use it.
type: skill
status: active
requires:
  capabilities: []
---

# ${name}

Declare capabilities in frontmatter \`requires.capabilities\` — do not reference specific tools. Tool-specific config lives in capability-spec.

## When to use

Describe the trigger conditions.

## Steps

1. Step one
2. Step two

## Output

Describe what the skill produces.
`;
}

function ruleTemplate(name: string): string {
  return `---
name: ${name}
description: Describe what behavior this rule enforces.
type: rule
status: active
writable: false
---

# ${name}

Describe the rule here. Use imperative language.

## Why

Explain why this rule exists.
`;
}

function evalTemplate(name: string): string {
  return `// Custom eval: ${name}
// Implement the metric function below.
// Receives the .ai/ directory path, returns { value, status, note? }.

import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

export async function evaluate(aiDir: string): Promise<{
  name: string;
  value: string | number;
  status: "good" | "warn" | "bad";
  note?: string;
}> {
  // Example: count open items
  // const openItems = await readFile(join(aiDir, "sessions/open-items.md"), "utf-8");
  // const count = (openItems.match(/^- \\[ \\]/gm) ?? []).length;
  return {
    name: "${name}",
    value: 0,
    status: "good",
    note: "Implement this metric",
  };
}
`;
}

// ─── Default file contents ────────────────────────────────────────────────────

const DEFAULT_IDENTITY = `---
id: identity
type: identity
status: active
writable: true
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Identity

You are a senior developer focused on long-term strategy and production readiness. You think beyond the immediate task — anticipating downstream effects, architectural implications, and long-term maintainability. Every decision is deliberate, forward-looking, and grounded in engineering excellence.

## Mindset

- Think about gaps and edge cases before writing code
- Propose solutions that are production-grade, not prototypes
- When diagnosing an issue, consider the full call chain — not just the immediate symptom
- [Add project-specific mindset guidance here]

## Autonomy Level

<!-- Set one of: HIGH_TOUCH, MEDIUM_TOUCH, LOW_TOUCH -->
level: HIGH_TOUCH

### HIGH_TOUCH (default)
**ASK before:** architectural changes, scope changes, trade-offs, ambiguous requirements, irreversible actions.
**DO NOT ask for:** permission to search/read, executing decided approach, gathering info.
**Long-running agents:** checkpoint at phase transitions.

### MEDIUM_TOUCH
**ASK before:** irreversible actions, breaking changes, security-sensitive changes.
**Proceed autonomously with:** refactors, test additions, dependency updates, documentation.
**Checkpoint:** only on scope changes.

### LOW_TOUCH
**ASK before:** production deployments, data deletion, security rule changes.
**Proceed autonomously with:** everything else.
**Checkpoint:** only on errors or blockers.

## Constraints (NEVER without explicit approval)

- Never commit secrets, API keys, or .env files
- Never delete user data without explicit request
- Never deploy to production without explicit request
- Never write full protocols to tool directories — canonical content goes in \`.ai/\`, stubs in tool dirs
- [Add project-specific constraints here]

## Permissions (ASK before doing)

- Creating new files (prefer editing existing)
- Adding dependencies
- [Add project-specific permissions here]

## Before Starting Any Task

1. Read \`.ai/memory/memory-index.md\`
2. Search \`.ai/memory/\` for bugs, patterns, decisions relevant to the task
3. Search \`.ai/skills/\` for applicable domain patterns
4. Fetch \`.ai/reference/PROJECT.md\` only when task requires architecture, data models, or integrations

## Inference Discipline

1. **State inferences explicitly**: "I'm inferring X because Y"
2. **Check memory for conflicts**: Search \`.ai/memory/\` before acting on inference
3. **Surface uncertainty**: If confidence < 90%, say so and ask
4. **Never reduce scope silently**: All content is tool-agnostic by default

After completing any non-trivial task, self-verify: Did I answer what was asked, or what I assumed was asked?

## Authority (when sources conflict)

PROJECT.md > memory files > code > inference.

## When Confused

Tell the user. Fix the code, not the documentation.
`;

const DEFAULT_PROJECT_STATUS = `---
id: project-status
type: project-status
status: active
writable: true
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Project Status

> This file evolves with the project. Both humans and AI update it — AI writes what it learned, humans steer the focus. This is your RALPH loop status file.

## Current Focus

[What is actively being worked on]

## Open Questions

[Things not yet decided]

## What's Working

[Patterns and approaches worth repeating]

## What to Try Next

[Directions to explore in upcoming sessions]
`;

const DEFAULT_DECISIONS = `---
id: memory-decisions
type: decision
layout: multi-entry
status: active
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Decisions

**Format:** Tag each entry \`[P0]\`, \`[P1]\`, or \`[P2]\`. Include context, decision, rationale, tradeoffs.
Optional: \`**Supersedes:**\`, \`**Superseded by:**\`, \`**Links to:**\` for linked entries.

For \`[P0]\` entries, add a \`constraint_pattern\` block if the rule can be expressed as a code check.

---

<!-- Add entries below. -->
`;

const DEFAULT_PATTERNS = `---
id: memory-patterns
type: pattern
layout: multi-entry
status: active
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Patterns

**Format:** Tag each entry \`[P0]\`, \`[P1]\`, or \`[P2]\`. Include pattern and anti-pattern.
Optional: \`**Links to:**\` for related entries.

---

<!-- Add entries below. -->
`;

const DEFAULT_DEBUGGING = `---
id: memory-debugging
type: debugging
layout: multi-entry
status: active
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Debugging

**Format:** Tag each entry \`[P0]\`, \`[P1]\`, or \`[P2]\`. Include symptom, root cause, fix, and how to prevent recurrence.

---

<!-- Add entries below. -->
`;

const DEFAULT_IMPROVEMENTS = `---
id: memory-improvements
type: decision
layout: multi-entry
status: active
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Improvements

Incremental improvements discovered over time.

---

<!-- Add entries below. -->
`;

const DEFAULT_MEMORY_INDEX = `---
id: memory-index
type: index
status: active
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Memory Index

**Auto-generated.** Run \`ai-memory index\` or \`/mem-compound\` to regenerate.

---

<!-- Index will be generated here. -->
`;

const DEFAULT_BASE_AUDITOR = `---
name: _base-auditor
description: Shared audit methodology. All auditor agents inherit these principles.
type: agent
status: active
writable: false
---

# Base Auditor Protocol

## Core Principles

- Verify before asserting
- Cite evidence (file path, line number, log excerpt)
- Prioritize by impact: CRITICAL > HIGH > MEDIUM > LOW

## Initial Steps

1. Read scope and methodology from the specific agent file
2. Gather context (relevant files, configs, rules)
3. Execute checks per methodology

## Report Format

- **CRITICAL:** Issues that break the build or violate [P0] constraints
- **HIGH:** Issues likely to cause bugs or inconsistencies
- **MEDIUM:** Improvements worth making
- **LOW:** Minor suggestions

## Closing Steps

- Summarize findings
- Recommend remediation order
- Flag any blockers
`;

const DEFAULT_AGENT_TEMPLATE = `---
name: _template
description: Template for creating new agents. Copy and rename.
type: agent
status: experimental
---

# Agent Name

## Role

Describe what this agent does.

## When to invoke

Describe the trigger.

## Methodology

1. Step one
2. Step two

## Report Format

Describe what the agent produces.
`;

const DEFAULT_OPEN_ITEMS = `---
id: open-items
type: decision
status: active
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Open Items

**Task format:** Items may be broad or categorical. Work done must be broken down into atomic tasks that fit RALPH loops and avoid conflicts when agents work in parallel.

## Open

<!-- Format: \`- [ ] Brief description (source: doc path or BACKLOG)\` -->

## Closed

<!-- Format: \`- [x] Brief description (resolved: how)\` -->
`;

const DEFAULT_THREAD_ARCHIVE = `---
id: thread-archive
type: decision
status: active
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Thread Archive

Curated history of past session decisions. One line per session.

---

<!-- Format: [YYYY-MM-DD] Brief description of what was done and decided. -->
`;

const DEFAULT_PROJECT = `---
id: project-reference
type: reference
status: active
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Project Reference

**Full project reference for AI agents. Fetch this file when the task requires architecture, data models, integrations, or development setup.**

Load this file only when the task requires full project context. Prefer \`memory-index.md\` for session start.

---

## Project Overview

[What this project is, who it's for, what problem it solves]

## Tech Stack

- **Language:** [e.g., TypeScript, Python, Go]
- **Framework:** [e.g., React, FastAPI, none]
- **Build:** [e.g., Vite, webpack, tsc, cargo]
- **CI:** [e.g., GitHub Actions, GitLab CI, none]
- **Key dependencies:** [Top 5-8 from manifest file]

## Architecture

[High-level structure — e.g., "Monorepo with packages/ for shared libs", "Single Express API with PostgreSQL"]

## Data Models

[Schema files, ORM models, key types. Remove this section if not applicable.]

## Integrations

[External services — e.g., "Stripe (payments)", "SendGrid (email)", "PostgreSQL (primary DB)". Remove if not applicable.]

## Development Setup

[How to run the project locally — from README, Makefile, docker-compose, .env.example]
`;

const DEFAULT_ACP_MANIFEST = JSON.stringify({
  name: "ai-memory-agent",
  description: "Persistent project memory with governance enforcement",
  version: "0.1.0",
  capabilities: [
    "memory.read",
    "memory.write",
    "memory.search",
    "memory.validate",
    "compound.run",
  ],
  transport: {
    type: "mcp",
    mode: "stdio",
    command: "npx @radix-ai/ai-memory mcp",
  },
}, null, 2);

const DEFAULT_ACP_CAPABILITIES = `---
id: acp-capabilities
type: toolbox
status: active
writable: false
---

# ACP Capabilities

Human-readable description of this agent's capabilities for ACP orchestrators.

## memory.read
Read memory entries, identity, project status, and session archive.

## memory.write
Write new memory entries via \`commit_memory\`. Immutable paths are enforced.

## memory.search
Keyword and semantic search across all \`.ai/\` memory files.

## memory.validate
Validate proposed code changes against [P0] constraint rules (\`validate_context\`).
Validate memory entries against canonical schema (\`validate_schema\`).

## compound.run
Execute the full compound loop: capture → conflict check → governance gate → index.
`;

const DEFAULT_DOC_PLACEMENT_RULE = `---
id: doc-placement
type: rule
status: active
---

# Doc placement

When creating or moving documentation files under \`docs/\` or \`.ai/\` (excluding \`.ai/memory/\`):

1. **Before writing:** Call \`get_doc_path\` with the doc type and optional slug. Do not infer paths.
2. **After writing:** Call \`validate_doc_placement\` for the path(s). Fix any errors before committing.
3. **Doc types:** Use \`list_doc_types\` to see available types and patterns. Filenames use SCREAMING_SNAKE_CASE by default.
`;

const DEFAULT_DOCS_MANAGER_AGENT = `---
id: docs-manager
type: agent
status: active
---

# Docs Manager

You manage project documentation structure and schema. Use when migrating docs, creating schemas, or auditing doc placement.

## When to run

- Migrating existing docs to schema-driven paths
- Creating or updating \`.ai/docs-schema.json\`
- Auditing doc placement across the repo

## Tools

- \`list_doc_types\` — see current schema
- \`get_doc_path\` — resolve canonical path for a doc type
- \`validate_doc_placement\` — check paths against schema

## Methodology

1. Load schema via \`list_doc_types\`
2. For each doc to migrate: \`get_doc_path\` → move/update → \`validate_doc_placement\`
3. Update \`.ai/docs-schema.json\` if new doc types are needed
`;
