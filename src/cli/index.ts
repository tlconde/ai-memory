#!/usr/bin/env node
import { Command } from "commander";
import { writeFile, mkdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { existsSync } from "fs";

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
  .version("0.1.0");

// ─── init ───────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Scaffold .ai/ in the current project")
  .option("--full", "Full tier: adds governance, evals, and ACP")
  .option("--dir <dir>", "Target directory (default: current directory)")
  .action(async (opts) => {
    const targetDir = resolve(opts.dir ?? process.cwd());
    const aiDir = join(targetDir, ".ai");

    if (existsSync(aiDir)) {
      console.log(`⚠ .ai/ already exists at ${aiDir}`);
      console.log(`  To reinitialize, remove .ai/ first.`);
      process.exit(1);
    }

    console.log(`Initializing ai-memory in ${targetDir}...`);
    await scaffoldAiDir(aiDir, opts.full ?? false);

    console.log(`\n✓ Done. Next steps:`);
    console.log(`  1. Edit .ai/IDENTITY.md — describe this project and its constraints`);
    console.log(`  2. Edit .ai/DIRECTION.md — set the current focus`);
    console.log(`  3. Run \`ai-memory install --to cursor\` or \`--to claude-code\` to connect your tool`);
    if (opts.full) {
      console.log(`  4. Add [P0] entries with constraint_pattern to decisions.md for governance`);
      console.log(`  5. Run \`ai-memory generate-harness\` to compile the rule set`);
    }
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
  await writeTemplateFile(aiDir, "DIRECTION.md", DEFAULT_DIRECTION);
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
  }
}

async function writeTemplateFile(aiDir: string, relativePath: string, content: string): Promise<void> {
  const fullPath = join(aiDir, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
  console.log(`  + .ai/${relativePath}`);
}

// ─── install ─────────────────────────────────────────────────────────────────

import { TOOL_ADAPTERS, MCP_JSON } from "./adapters.js";

program
  .command("install")
  .description("Install the ai-memory bootstrap for a specific tool")
  .requiredOption("--to <tool>", `Target tool (${Object.keys(TOOL_ADAPTERS).join(", ")})`)
  .option("--dir <dir>", "Project root (default: current directory)")
  .action(async (opts) => {
    const tool = opts.to.toLowerCase();
    const adapter = TOOL_ADAPTERS[tool];
    if (!adapter) {
      console.error(`Unknown tool: ${tool}`);
      console.error(`Supported: ${Object.keys(TOOL_ADAPTERS).join(", ")}`);
      process.exit(1);
    }

    const projectRoot = resolve(opts.dir ?? process.cwd());
    const destPath = join(projectRoot, adapter.dest);

    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, adapter.content);
    console.log(`✓ Wrote ${adapter.dest}`);

    // Write extra files (e.g., skill rules for Cursor)
    if (adapter.extraFiles) {
      for (const [relPath, content] of Object.entries(adapter.extraFiles)) {
        const extraPath = join(projectRoot, relPath);
        await mkdir(dirname(extraPath), { recursive: true });
        await writeFile(extraPath, content);
        console.log(`✓ Wrote ${relPath}`);
      }
    }

    if (adapter.mcp) {
      const mcpPath = join(projectRoot, ".mcp.json");
      if (!existsSync(mcpPath)) {
        await writeFile(mcpPath, MCP_JSON);
        console.log(`✓ Wrote .mcp.json`);
      } else {
        console.log(`  .mcp.json already exists — skipped`);
      }
    }

    console.log(`\nDone. Start a new ${opts.to} session and verify with:`);
    console.log(`  "What does .ai/IDENTITY.md say about this project?"`);
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
    const errors = await validateAll(aiDir);
    if (errors.length === 0) {
      console.log("✓ All files valid.");
    } else {
      console.error(`${errors.length} validation error(s):\n`);
      for (const e of errors) console.error(`  ${e.file}: ${e.message}`);
      process.exit(1);
    }
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
    const { readP0Entries, compileHarnessRules, generateRuleTests } = await import("../mcp-server/p0-parser.js");

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
---

# ${name}

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
writable: false
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Identity

You are a senior developer focused on long-term strategy and production readiness.

## What this project is

[Describe the project here — one paragraph]

## Constraints (NEVER without explicit approval)

- Never commit secrets, API keys, or .env files
- Never delete user data without explicit request
- Never deploy to production without explicit request
- Never write full protocols to tool directories — canonical content goes in \`.ai/\`

## Before starting any task

1. Read \`.ai/memory/memory-index.md\`
2. Search \`.ai/memory/\` for relevant bugs, patterns, and decisions
3. Search \`.ai/skills/\` for applicable domain patterns
4. Fetch \`.ai/reference/PROJECT.md\` only when the task requires architecture or data model context
`;

const DEFAULT_DIRECTION = `---
id: direction
type: direction
status: active
writable: true
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Direction

> This file evolves with the project. Both humans and AI update it — AI writes what it learned, humans steer the focus. This is your RALPH loop plan file.

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

**Auto-generated.** Run \`ai-memory fmt\` or \`/mem:compound\` to regenerate.

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

## Open

<!-- Format: - [ ] Brief description (source) -->

## Closed

<!-- Format: - [x] Brief description (resolved: how) -->
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
id: project
type: toolbox
status: active
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Project

**Loaded on demand** — fetched only when a task requires architecture, data models, or integration context.

## Architecture

[Describe the system architecture]

## Tech Stack

[List the key technologies]

## Data Models

[Describe key data structures]

## Integrations

[List external services and APIs]
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
Read memory entries, identity, direction, and session archive.

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
