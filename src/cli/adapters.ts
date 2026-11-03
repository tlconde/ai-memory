/**
 * Tool adapter definitions for `ai-memory install --to <tool>`.
 * Extracted from index.ts for maintainability.
 */

export const BOOTSTRAP_INSTRUCTION = `## ai-memory — Project Memory

This project has persistent AI memory in \`.ai/\`.

- **IDENTITY.md** — project constraints and behavioral rules
- **PROJECT_STATUS.md** — current focus, open questions, what to try next (writable)
- **memory/** — decisions, patterns, debugging history
- **context/** — small repo navigation pack: where to search, invariants, acceptance checks
- **skills/** — domain-specific patterns and session protocols

Use \`search_memory\` (MCP) to find relevant context before starting a task.
Use \`commit_memory\` to write new entries — never edit memory files directly.
If MCP is not connected, read \`.ai/memory/memory-index.md\` for a summary and write to \`.ai/memory/\` files directly.

\`.ai/\` is the canonical memory for this project. Save all project learnings here, not in your tool's built-in memory (e.g. ~/.claude/, Cursor memory, etc.). Tool-native memory is for user preferences only.
If \`.ai/temp/import/latest-request.md\` exists, read it and reconcile durable learnings from the listed tool-native memories/chats into \`.ai/memory/\`.

Immutable paths (do not write): IDENTITY.md, toolbox/, acp/, rules/.

At the end of a meaningful session, run /mem-compound to capture learnings.
For repo navigation drift after code changes, run /mem-context or \`ai-memory context verify\`.
`;

/**
 * Platform-agnostic MCP launcher. Detects OS at runtime and spawns correctly.
 * - In ai-memory repo: run local dist directly (avoids npx entirely).
 * - Windows: npx.cmd fails under spawn; npx-cli.js via node works.
 * - macOS/Linux/BSD: npx works directly.
 */
export const MCP_LAUNCHER = `#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const platform = process.platform;
const opts = { stdio: "inherit", env: process.env };

// Prefer local build when in ai-memory repo (avoids npx on Windows)
const cwd = process.cwd();
const localCli = path.join(cwd, "dist", "cli", "index.js");
const localMcp = path.join(cwd, "dist", "mcp-server", "index.js");

let child;
if (fs.existsSync(localCli)) {
  child = spawn("node", [localCli, "mcp"], opts);
} else if (fs.existsSync(localMcp)) {
  child = spawn("node", [localMcp], opts);
} else if (platform === "win32") {
  const nodeDir = path.dirname(process.execPath);
  const npxCli = path.join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js");
  if (fs.existsSync(npxCli)) {
    child = spawn("node", [npxCli, "@radix-ai/ai-memory", "mcp"], opts);
  } else {
    child = spawn("cmd", ["/c", "npx", "@radix-ai/ai-memory", "mcp"], { ...opts, windowsHide: true });
  }
} else {
  child = spawn("npx", ["@radix-ai/ai-memory", "mcp"], opts);
}

child.on("error", (err) => {
  console.error("[ai-memory-mcp] spawn failed:", err.message);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
`;

/** MCP config path for the launcher (relative to project root). */
export const MCP_LAUNCHER_PATH = ".ai/mcp-launcher.cjs";

/** Single MCP config for all platforms. Uses launcher that detects OS at runtime. */
export function getMCPJson(): string {
  return JSON.stringify(
    {
      mcpServers: {
        "ai-memory": {
          type: "stdio",
          command: "node",
          args: [MCP_LAUNCHER_PATH],
          env: { AI_DIR: "${workspaceFolder}/.ai" },
        },
        context7: {
          type: "http",
          url: "https://mcp.context7.com/mcp",
          headers: { "x-api-key": "${CONTEXT7_API_KEY:-}" },
        },
      },
    },
    null,
    2
  );
}

// ─── Canonical skills (written to .ai/skills/) ─────────────────────────────

function skillStub(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nCanonical definition: \`.ai/skills/${name}/SKILL.md\`\n\nRead the canonical file for full instructions.\n`;
}

const SKILL_STUBS: Array<[string, string]> = [
  ["mem-compound", "Captures session learnings into persistent memory."],
  ["mem-session-close", "Quick session close for sessions with no major learnings."],
  ["mem-validate", "Validate memory entries and code changes against governance rules."],
  ["mem-init", "Initialize ai-memory in a new project."],
  ["mem-context", "Create and maintain the small .ai/context navigation pack."],
  ["browser", "Browser automation (screenshots, navigate, interact)."],
  ["screen-capture", "Desktop/app window screenshot for vision analysis."],
  ["desktop-automation", "Desktop UI automation — mouse, keyboard, OCR. For desktop applications, Electron apps."],
  ["mem-auto-review", "Automated PR review using ai-memory governance rules."],
];

/** Generate skill stub files for a given tool-specific skills directory */
function skillStubsForDir(dir: string): Record<string, string> {
  const stubs: Record<string, string> = {};
  for (const [name, desc] of SKILL_STUBS) {
    stubs[`${dir}/${name}/SKILL.md`] = skillStub(name, desc);
  }
  return stubs;
}

/** Full skill content — written to .ai/skills/<name>/SKILL.md by install */
export const CANONICAL_SKILLS: Record<string, string> = {
  "mem-compound": `---
id: mem-compound
name: mem-compound
description: Captures session learnings into persistent memory. Use after a bug fix, pattern discovery, corrected approach, or at the end of any meaningful session.
type: skill
status: active
---

# mem-compound — Capture Session Learnings

## When to use
- A bug had a non-obvious root cause
- A reusable pattern emerged
- An approach was corrected mid-session
- The session produced architectural decisions
- End of any session worth preserving

## Instructions

### 1. Scan the session
Review conversation, code changes, errors. Identify:
- Bugs with non-obvious causes → write to \`debugging.md\` via \`commit_memory\`
- Reusable patterns → write to \`patterns.md\` via \`commit_memory\`
- Decisions made → write to \`decisions.md\` via \`commit_memory\`
- Improvements → write to \`improvements.md\` via \`commit_memory\`

### 2. Conflict check
Before writing: call \`search_memory\` for each topic. If contradictions found, mark old entry \`[DEPRECATED]\`.

### 3. Update PROJECT_STATUS.md
Update with learnings: move completed items to "What's Working", add new open questions, update "What to Try Next".

### 4. Archive
Call \`publish_result\` with summary, outcome, and learnings.
Update \`sessions/open-items.md\`: close resolved items, add new ones.

### 5. Governance gate (if harness.json exists)
Call \`generate_harness\`, then \`validate_context\` with git diff.

### 6. Sync (ephemeral environments only)
If in worktree/cloud agent: call \`sync_memory\` to git commit .ai/ changes.

### 7. Report
Summarize: entries written, items opened/closed, gate result.
`,
  "mem-session-close": `---
id: mem-session-close
name: mem-session-close
description: Quick session close for sessions with no major learnings. Archives and updates open items.
type: skill
status: active
---

# mem-session-close — Quick Session Close

## When to use
- Session was exploratory or mechanical
- Short session, no new decisions or patterns
- Want to close cleanly without the full compound loop

## Instructions

1. Call \`publish_result\` with a brief summary and outcome
2. Update \`sessions/open-items.md\`: close resolved items, add new ones
3. If in ephemeral environment: call \`sync_memory\`
4. Report: "Session closed. [N] items updated."
`,
  "mem-validate": `---
id: mem-validate
name: mem-validate
description: Validate memory entries and code changes against governance rules. Use before risky changes.
type: skill
status: active
---

# mem-validate — Governance Validation

## When to use
- Before committing a risky change
- After adding [P0] entries with constraint_pattern
- To verify memory schema compliance

## Instructions

1. Call \`generate_harness\` to refresh rules from current [P0] entries
2. Call \`validate_context\` with the current git diff
3. Call \`validate_schema\` on any new memory entries
4. Report violations and recommendations
`,
  "mem-init": `---
id: mem-init
name: mem-init
description: Guided setup wizard for ai-memory. Scans the codebase and walks the user through configuring each file with project-specific recommendations. Every step is skippable.
type: skill
status: active
disable-model-invocation: true
---

# mem-init — Guided Setup Wizard

## When to use
First time setting up ai-memory, or re-run to refresh recommendations.

**Quick setup (skip wizard):** Run \`npx @radix-ai/ai-memory init\` and edit files manually.

## Steps
1. **Scaffold** — Run \`npx @radix-ai/ai-memory init\` (or \`--full\`), then \`install --to <tool>\`. Skip if \`.ai/\` exists.
2. **Codebase scan** — Read: manifest (package.json etc.), README, directory listing, CI config, build config, git log, existing MCPs, existing rules files, existing docs. Summarize internally.
3. **Guide IDENTITY.md** — Propose a Role based on detected tech stack. Explain each section (Role, Mindset, Autonomy Level, Constraints, Permissions). Suggest project-specific constraints from scan. Ask autonomy level preference (HIGH/MEDIUM/LOW TOUCH). User edits the file. Skippable.
4. **Guide reference/PROJECT.md** — Present scan findings as suggestions for: Project Overview, Tech Stack, Architecture, Data Models, Integrations, Dev Setup. User edits the file. Skippable.
5. **Guide PROJECT_STATUS.md** — Suggest Current Focus from git log, Open Questions from scan gaps, What's Working from observed patterns. User edits. Skippable.
6. **Knowledge audit** — Report existing docs (ARCHITECTURE.md, CONTRIBUTING.md, CHANGELOG.md, .env.example, TODO comments, existing MCPs/rules). Suggest what to import into .ai/memory/. If AGENTS.md, CLAUDE.md, .cursorrules, or copilot-instructions.md exist, propose migrating their content to .ai/ canonical files (behavioral → IDENTITY.md, project info → PROJECT.md, workflows → skills) and replacing the original with a stub. Do not import or migrate automatically.
7. **Recommendations** — Suggest relevant features: CI detected → mem-auto-review, multiple contributors → Full tier, no tests → testing-strategy pattern, monorepo → per-package skills.
8. **Validate** — Run \`npx @radix-ai/ai-memory validate\`. Print summary of what was done, remaining placeholders, and next steps.
`,
  "mem-context": `---
id: mem-context
name: mem-context
description: Create and maintain the small .ai/context navigation pack. Use after repo structure changes, when a session discovers better search boundaries, or when context verify warns.
type: skill
status: active
---

# mem-context — Maintain Repo Navigation Context

## When to use

- First setup of the checked-in context pack
- Code changes altered entrypoints, risky paths, invariants, or search boundaries
- A hook asks you to reconcile session learnings into .ai/context
- \`ai-memory context verify\` reports stale or missing context

## Instructions

### 1. Ensure the pack exists

If \`.ai/context/\` is missing, run:

\`\`\`bash
ai-memory context init
\`\`\`

### 2. Read before editing

Read these files:

1. \`.ai/context/START_HERE.md\`
2. \`.ai/context/CODE_MAP.md\`
3. \`.ai/context/INVARIANTS.md\`
4. \`.ai/context/search-scope.json\`

Also read \`.ai/temp/pre-compact-dump.json\` if it exists. Preserve the user's latest intent from that dump when reconciling after compaction.

### 3. Draft first

Write scratch notes to \`.ai/temp/context/drafts/\` when the update is not obvious. Promote only concise, evidence-backed changes into \`.ai/context/\`.

### 4. Update only what changed

- \`CODE_MAP.md\` for new or moved important paths
- \`INVARIANTS.md\` for rules verified against the repo
- \`search-scope.json\` for task-specific search boundaries and verification shortcuts
- \`acceptance.md\` for quick checks proving the pack points to the right files

Do not store external library documentation here. Use Context7 for current third-party docs.

### 5. Verify

Run:

\`\`\`bash
ai-memory context verify
\`\`\`

Fix failures before reporting done. Warnings may remain if you explain why.
`,
  browser: `---
id: browser
name: browser
description: Use browser automation (screenshots, navigate, interact). Requires browser MCP.
type: skill
status: active
requires:
  capabilities: [browser]
  permission: read   # read | edit | write — only request what the task needs
---

# browser — Browser Automation Skill

## When to use

- Take screenshots of web pages
- Navigate, fill forms, click elements
- Verify visual changes or UI state

## Setup

Ensure browser capability is enabled for your environment. See \`.ai/reference/capability-specs.json\` or run \`ai-memory install --capability browser\` when available.

## Usage patterns

- **Failures** → write to \`debugging.md\` via \`commit_memory\` with symptom, screenshot path, root cause
- **Screenshots** → reference path in memory entries; include URL and viewport
- **Visual regression** → \`search_memory\` for known changes; create debugging entry if unexpected
`,
  "screen-capture": `---
id: screen-capture
name: screen-capture
description: Capture desktop or app window for vision analysis. Platform-dependent (e.g. Peekaboo on macOS).
type: skill
status: active
requires:
  capabilities: [screen_capture]
---

# screen-capture — Desktop/App Screenshot Skill

## When to use

- Read another app's screen (e.g. IDE, browser window)
- Capture for vision analysis or handoff
- Save to \`.ai/temp/\` for cross-tool handoff

## Setup

See \`.ai/reference/capability-specs.json\` for platform-specific install (e.g. Peekaboo on macOS). Manual fallback: screenshot to \`.ai/temp/screen.png\`.

## Usage

- Capture → save to \`.ai/temp/\` → agent reads via file or \`get_memory\`
- Handoff: write path to \`.ai/temp/request-for-*.md\` for another agent
`,
  "desktop-automation": `---
id: desktop-automation
name: desktop-automation
description: Desktop UI automation — mouse, keyboard, OCR. For any desktop application, Electron apps, legacy software. Requires desktop_automation capability.
type: skill
status: active
requires:
  capabilities: [desktop_automation]
---

# desktop-automation — Desktop UI Automation Skill

## When to use

- Type into any desktop application or Electron apps
- Automate legacy desktop apps without APIs
- UI testing, data entry, accessibility tools

## Permissions

Declare the minimal permission needed for the task (see capability-specs.json):
- **read** — Observe, screenshot, OCR only
- **edit** — Click, type, navigate (no destructive actions)
- **write** — Full control (submit, delete, etc.)

Only request the permission the task requires.

## Setup

Run \`ai-memory install --capability desktop_automation\` or see \`.ai/reference/capability-specs.json\` for tool-specific config.

## Usage

- Use mouse/keyboard tools for interaction; OCR for reading screen content
- Save captures to \`.ai/temp/\` for handoff
`,
  "mem-auto-review": `---
id: mem-auto-review
name: mem-auto-review
description: Automated PR review using ai-memory governance rules. For Cursor automations, Bugbot, CI pipelines. No user interaction required.
type: skill
status: active
---

# mem-auto-review — Automated PR Review

## When to use
- PR creation (Bugbot, Cursor automation, GitHub webhook)
- CI pipeline step
- Any automated code review context

This skill requires NO user interaction. It runs autonomously.

## Instructions

### 1. Get the diff
Run \`git diff origin/main...HEAD\` to get all changes in the PR.

### 2. Search memory for context
Call \`search_memory\` with keywords from the changed files. Check for relevant decisions, patterns, and known bugs.

### 3. Validate governance
Call \`generate_harness\` to refresh rules, then \`validate_context\` with the diff.

### 4. Produce review
Generate a structured report: governance result, memory context, suggestions.

### 5. Record result
Call \`publish_result\` with summary and outcome.

### 6. Sync
Call \`sync_memory\` to persist any new learnings.
`,
};

// ─── Claude Code hooks ──────────────────────────────────────────────────────

export const SESSION_START_HOOK = `#!/usr/bin/env node
/**
 * ai-memory — Claude Code SessionStart hook
 * Injects minimal .ai/ context at session start (lazy loading).
 * Full context available via search_memory MCP tool.
 */
const { readFileSync, existsSync } = require("fs");
const { join } = require("path");

const aiDir = process.env.AI_DIR || join(process.cwd(), ".ai");

function safeRead(filePath, maxLines) {
  try {
    const content = readFileSync(filePath, "utf-8");
    if (maxLines) return content.split("\\n").slice(0, maxLines).join("\\n");
    return content;
  } catch { return ""; }
}

if (!existsSync(aiDir)) process.exit(0);

const sections = [];

const identity = safeRead(join(aiDir, "IDENTITY.md"));
if (identity) sections.push(identity.trim());

const status = safeRead(join(aiDir, "PROJECT_STATUS.md"));
if (status) sections.push(status.trim());

const index = safeRead(join(aiDir, "memory/memory-index.md"));
if (index && !index.includes("<!-- Index will be generated")) {
  sections.push("## Memory Index (priority-ranked)\\n\\n" + index.trim());
}

const contextStart = safeRead(join(aiDir, "context/START_HERE.md"), 80);
const contextMap = safeRead(join(aiDir, "context/CODE_MAP.md"), 120);
if (contextStart || contextMap) {
  sections.push("## Repo Navigation Context\\n\\n" + [contextStart, contextMap].filter(Boolean).join("\\n\\n---\\n\\n"));
}

if (sections.length === 0) process.exit(0);

process.stdout.write(JSON.stringify({
  type: "context",
  content: sections.join("\\n\\n---\\n\\n"),
}));
`;

// Pre-compact hook as a separate script to avoid escaping issues in JSON
export const PRE_COMPACT_HOOK = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const aiDir = process.env.AI_DIR || path.join(process.cwd(), ".ai");
if (!fs.existsSync(aiDir)) process.exit(0);
const tempDir = path.join(aiDir, "temp");
fs.mkdirSync(tempDir, { recursive: true });
const dump = { timestamp: new Date().toISOString(), event: "pre-compact" };
for (const f of ["PROJECT_STATUS.md", "memory/memory-index.md", "sessions/open-items.md"]) {
  const fp = path.join(aiDir, f);
  if (fs.existsSync(fp)) dump[f] = fs.readFileSync(fp, "utf-8").slice(0, 2000);
}
for (const f of ["context/START_HERE.md", "context/CODE_MAP.md", "context/INVARIANTS.md"]) {
  const fp = path.join(aiDir, f);
  if (fs.existsSync(fp)) dump[f] = fs.readFileSync(fp, "utf-8").slice(0, 1600);
}
dump.instructions = [
  "After compaction, preserve the user's latest intent before continuing.",
  "Read this dump, then reconcile meaningful learnings into .ai/memory and repo navigation drift into .ai/context.",
  "Use commit_memory for durable memory entries when MCP is available.",
].join(" ");
fs.writeFileSync(path.join(tempDir, "pre-compact-dump.json"), JSON.stringify(dump, null, 2));
`;

export const POST_COMPACT_HOOK = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const aiDir = process.env.AI_DIR || path.join(process.cwd(), ".ai");
if (!fs.existsSync(aiDir)) process.exit(0);
const tempDir = path.join(aiDir, "temp");
fs.mkdirSync(tempDir, { recursive: true });
const reminder = [
  "# Post-Compact Reminder",
  "",
  "Read .ai/temp/pre-compact-dump.json if it exists.",
  "Restore the user's latest intent before continuing.",
  "Reconcile meaningful learnings into .ai/memory and concise verified repo navigation drift into .ai/context.",
  "If .ai/temp/import/latest-request.md exists, process it before adding new durable memory.",
  "",
  "Created: " + new Date().toISOString(),
  "",
].join("\\n");
fs.writeFileSync(path.join(tempDir, "post-compact-reminder.md"), reminder);
`;

export const AI_MEMORY_IMPORT_HOOK = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");

const agent = process.argv[2] || process.env.AI_MEMORY_AGENT || "generic";
const projectRoot = process.cwd().endsWith(path.sep + ".cursor") ? path.resolve(process.cwd(), "..") : process.cwd();
const aiDir = process.env.AI_DIR || path.join(projectRoot, ".ai");
if (!fs.existsSync(aiDir)) process.exit(0);

function nowIso() {
  return new Date().toISOString();
}

function expand(input) {
  const vars = input.replace(/\\$\\{([A-Z0-9_]+)(:-([^}]*))?\\}/gi, (_m, key, _fallbackPart, fallback) => process.env[key] || fallback || "");
  if (vars === "~") return os.homedir();
  return vars.replace(/^~(?=\\/|\\\\)/, os.homedir());
}

function defaultConfig() {
  return {
    version: 1,
    generated_at: nowIso(),
    sources: [
      { id: "claude-project-memory", tool: "claude", kind: "file", path: "CLAUDE.md", enabled: true, description: "Project CLAUDE.md instructions." },
      { id: "claude-project-rules", tool: "claude", kind: "directory", path: ".claude/rules", enabled: true, description: "Project Claude rules." },
      { id: "claude-auto-memory", tool: "claude", kind: "directory", path: "\${CLAUDE_CODE_AUTO_MEMORY_DIR:-~/.claude/projects/<project>/memory}", enabled: false, description: "Claude auto memory; configure the project-specific path first." },
      { id: "cursor-project-rules", tool: "cursor", kind: "directory", path: ".cursor/rules", enabled: true, description: "Cursor project rules." },
      { id: "cursor-legacy-rules", tool: "cursor", kind: "file", path: ".cursorrules", enabled: true, description: "Legacy Cursor rules." },
      { id: "cursor-chat-exports", tool: "cursor", kind: "directory", path: ".ai/temp/import/cursor-chat-exports", enabled: false, description: "Optional user-provided Cursor chat exports." },
      { id: "codex-project-agents", tool: "codex", kind: "file", path: "AGENTS.md", enabled: true, description: "Project AGENTS.md instructions." },
      { id: "codex-memories", tool: "codex", kind: "directory", path: "\${CODEX_HOME:-~/.codex}/memories", enabled: true, description: "Codex memory files under CODEX_HOME." },
      { id: "codex-history", tool: "codex", kind: "file", path: "\${CODEX_HOME:-~/.codex}/history.jsonl", enabled: false, description: "Codex prompt history when persistence is enabled." }
    ]
  };
}

const configPath = path.join(aiDir, "import-sources.json");
let config = defaultConfig();
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {}
} else {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

const present = [];
const pending = [];
for (const source of config.sources || []) {
  if (!source.enabled) {
    pending.push("- " + source.id + ": disabled (" + source.path + ")");
    continue;
  }
  const expanded = expand(source.path);
  const resolved = expanded.includes("<") || expanded.includes(">") ? expanded : path.resolve(projectRoot, expanded);
  if (resolved.includes("<") || resolved.includes(">")) {
    pending.push("- " + source.id + ": configure path (" + source.path + ")");
    continue;
  }
  if (!fs.existsSync(resolved)) {
    pending.push("- " + source.id + ": missing (" + source.path + ")");
    continue;
  }
  const stat = fs.statSync(resolved);
  const ok = source.kind === "glob" || (source.kind === "file" && stat.isFile()) || (source.kind === "directory" && stat.isDirectory());
  if (ok) present.push("- " + source.id + " (" + source.tool + ", " + source.kind + "): " + resolved);
  else pending.push("- " + source.id + ": expected " + source.kind + " (" + source.path + ")");
}

const importDir = path.join(aiDir, "temp", "import");
const requestDir = path.join(importDir, "requests");
fs.mkdirSync(requestDir, { recursive: true });
fs.mkdirSync(path.join(importDir, "reports"), { recursive: true });
fs.mkdirSync(path.join(importDir, "cursor-chat-exports"), { recursive: true });

const request = [
  "# ai-memory Import Request",
  "",
  "Active agent: " + agent,
  "Created: " + nowIso(),
  "",
  "Read the enabled source files below and distill only durable project learnings into .ai memory.",
  "",
  "## Sources To Inspect",
  "",
  present.length ? present.join("\\n") : "- No enabled sources are currently present.",
  "",
  "## Sources Not Ready",
  "",
  pending.length ? pending.join("\\n") : "- None.",
  "",
  "## Instructions For The Agent",
  "",
  "1. Read only the listed present sources. If you need another source, ask the user or add it to .ai/import-sources.json first.",
  "2. Extract durable project facts, decisions, debugging lessons, workflows, and user intent that should survive across tools.",
  "3. Do not bulk-copy raw chat text, secrets, credentials, personal data, or one-off transient chatter.",
  "4. Before writing, inspect .ai/memory/memory-index.md and the relevant .ai/memory/*.md file to avoid duplicates and contradictions.",
  "5. Prefer commit_memory/search_memory when the MCP server is available. If MCP is unavailable, edit the relevant .ai/memory file directly.",
  "6. Update .ai/PROJECT_STATUS.md and .ai/sessions/open-items.md only when the sources reveal current intent or unresolved work.",
  "7. Write a short completion report under .ai/temp/import/reports/ with sources read, memory files changed, and anything skipped.",
  "",
  "This request is intentionally a handoff prompt: the hook creates work for a coding agent, and the agent performs the semantic judgment.",
  ""
].join("\\n");

const filename = nowIso().replace(/[:.]/g, "-") + "-" + agent + ".md";
fs.writeFileSync(path.join(requestDir, filename), request);
fs.writeFileSync(path.join(importDir, "latest-request.md"), request);
`;

export const CLAUDE_HOOKS_CONFIG = JSON.stringify({
  hooks: {
    SessionStart: [{
      hooks: [{
        type: "command",
        command: "node .claude/hooks/SessionStart.js",
        timeout: 10000,
      }],
    }],
    PreCompact: [{
      hooks: [{
        type: "command",
        command: "node .claude/hooks/PreCompact.js",
        timeout: 10000,
      }],
    }],
    PostCompact: [{
      hooks: [{
        type: "command",
        command: "node .claude/hooks/PostCompact.js",
        timeout: 10000,
      }],
    }],
    Stop: [{
      hooks: [
        {
          type: "command",
          command: "node .ai/hooks/import-request.cjs claude",
          timeout: 10000,
        },
        {
          type: "prompt",
          prompt: "The session is ending. Read the recent conversation, .ai/memory/memory-index.md, .ai/PROJECT_STATUS.md, .ai/context if present, and .ai/temp/import/latest-request.md if it exists. If meaningful work happened, update durable .ai/memory via commit_memory, update PROJECT_STATUS.md/open-items, and update .ai/context only for verified repo navigation drift. If the import request lists tool-native memories/chats, distill only durable project learnings and do not bulk-copy raw chat text. Preserve user intent and do not invent learnings. Context: $ARGUMENTS",
          model: "claude-sonnet",
          timeout: 120,
        },
      ],
    }],
  },
}, null, 2);

export const CURSOR_HOOKS_CONFIG = JSON.stringify({
  version: 1,
  hooks: {
    stop: [
      {
        command: "node ../.ai/hooks/import-request.cjs cursor",
      },
    ],
  },
}, null, 2);

export const CODEX_HOOKS_CONFIG = JSON.stringify({
  Stop: [
    {
      hooks: [
        {
          type: "command",
          command: "node .ai/hooks/import-request.cjs codex",
          timeout: 10000,
        },
      ],
    },
  ],
  PostCompact: [
    {
      hooks: [
        {
          type: "command",
          command: "node .ai/hooks/import-request.cjs codex",
          timeout: 10000,
        },
      ],
    },
  ],
}, null, 2);

// ─── Adapter definitions ───────────────────────────────────────────────────

export interface ToolAdapter {
  dest: string;
  content: string;
  mcp: boolean;
  /** MCP config path (default: .mcp.json). Cursor uses .cursor/mcp.json */
  mcpPath?: string;
  /** Additional files to write (path relative to project root → content) */
  extraFiles?: Record<string, string>;
  /** Message to show after install (tool-specific notes) */
  postInstallNote?: string;
}

export const TOOL_ADAPTERS: Record<string, ToolAdapter> = {
  cursor: {
    dest: ".cursor/rules/00-load-ai-memory.mdc",
    content: `---\ndescription: Load ai-memory project context at session start\nalwaysApply: true\n---\n\n${BOOTSTRAP_INSTRUCTION}`,
    mcp: true,
    mcpPath: ".cursor/mcp.json",
    extraFiles: {
      ...skillStubsForDir(".cursor/skills"),
      ".cursor/hooks.json": CURSOR_HOOKS_CONFIG,
      ".ai/hooks/import-request.cjs": AI_MEMORY_IMPORT_HOOK,
    },
  },
  codex: {
    dest: "AGENTS.md",
    content: BOOTSTRAP_INSTRUCTION,
    mcp: false,
    postInstallNote: "Codex hooks installed in .codex/hooks.json. Trust the project .codex layer for local hooks to load.",
    extraFiles: {
      ...skillStubsForDir(".codex/skills"),
      ".codex/hooks.json": CODEX_HOOKS_CONFIG,
      ".ai/hooks/import-request.cjs": AI_MEMORY_IMPORT_HOOK,
    },
  },
  antigravity: {
    dest: ".agents/rules/00-load-ai-memory.md",
    content: BOOTSTRAP_INSTRUCTION,
    mcp: false, // Antigravity MCP is global-only (~/.gemini/antigravity/mcp_config.json)
    extraFiles: {
      ...skillStubsForDir(".agents/skills"),
    },
  },
  // windsurf: {
  //   dest: ".windsurfrules",
  //   content: BOOTSTRAP_INSTRUCTION,
  //   mcp: true,
  // },
  // cline: {
  //   dest: ".clinerules",
  //   content: BOOTSTRAP_INSTRUCTION,
  //   mcp: true,
  // },
  copilot: {
    dest: ".github/copilot-instructions.md",
    content: `# Copilot Instructions\n\n${BOOTSTRAP_INSTRUCTION}\n\n> Note: GitHub Copilot does not support MCP. Skills must be run by pasting content from \`.ai/skills/\`.\n`,
    mcp: false,
  },
  "claude-code": {
    dest: "CLAUDE.md",
    content: `# Claude Code — Project Memory\n\n${BOOTSTRAP_INSTRUCTION}`,
    mcp: true,
    postInstallNote: "Hooks installed: SessionStart, PreCompact/PostCompact, Stop import request\n  Note: Restart Claude Code for hooks to take effect.",
    extraFiles: {
      ...skillStubsForDir(".claude/skills"),
      ".claude/hooks/SessionStart.js": SESSION_START_HOOK,
      ".claude/hooks/PreCompact.js": PRE_COMPACT_HOOK,
      ".claude/hooks/PostCompact.js": POST_COMPACT_HOOK,
      ".ai/hooks/import-request.cjs": AI_MEMORY_IMPORT_HOOK,
      ".claude/settings.local.json": CLAUDE_HOOKS_CONFIG,
    },
  },
};
