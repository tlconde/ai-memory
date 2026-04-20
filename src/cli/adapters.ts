/**
 * Tool adapter definitions for `ai-memory install --to <tool>`.
 * Extracted from index.ts for maintainability.
 */

export const BOOTSTRAP_INSTRUCTION = `## ai-memory — Project Memory

This project has persistent AI memory in \`.ai/\`.

- **IDENTITY.md** — project constraints and behavioral rules
- **PROJECT_STATUS.md** — current focus, open questions, what to try next (writable)
- **memory/** — decisions, patterns, debugging history
- **skills/** — domain-specific patterns and session protocols
- **agents/** — specialized sub-agents (e.g. \`.ai/agents/<name>/AGENT.md\`)
- **rules/** — behavioral rules and governance constraints
- **reference/** — project docs, architecture, environment specs

When creating new content (agents, skills, rules, workflows), place the canonical version in \`.ai/\` under the appropriate directory. Tool-specific copies (e.g. \`.cursor/agents/\`, \`.claude/skills/\`) may exist as stubs that point back to the canonical source.

Read \`.ai/IDENTITY.md\` at the start of every session — it defines your role, constraints, and standard of excellence.
Read \`memory://sync\` (MCP resource) to check for canonical sync gaps between tool directories and \`.ai/\`. If gaps exist, inform the user.
Use \`search_memory\` (MCP) to find relevant context before starting a task.
Use \`commit_memory\` to write new entries — never edit memory files directly.
If MCP is not connected, read \`.ai/memory/memory-index.md\` for a summary and write to \`.ai/memory/\` files directly.

\`.ai/\` is the canonical memory for this project. Save all project learnings here, not in your tool's built-in memory (e.g. ~/.claude/, Cursor memory, etc.). Tool-native memory is for user preferences only.

Immutable paths (do not write): IDENTITY.md, toolbox/, acp/, rules/.

At the end of a meaningful session, run /mem-compound to capture learnings.
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

### 2. Conflict check (MANDATORY — use search_memory MCP)
For each topic identified in Step 1, call the \`search_memory\` MCP tool with a query describing the topic. Do NOT substitute Read/Grep/file reads — \`search_memory\` uses hybrid search (keyword + semantic) and catches matches that exact string searches miss (e.g. "Project Memory is Canonical" matches a query about "project learnings go to .ai/memory"). If contradictions found, mark old entry \`[DEPRECATED]\`.

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
2. **Codebase scan** — Read: manifest (package.json etc.), README, directory listing, CI config, build config, git log, existing MCPs, existing rules files, existing docs. Summarize internally. Also scan root-level \`*.md\` files (excluding README, CHANGELOG, CONTRIBUTING, LICENSE, CODE_OF_CONDUCT, SECURITY) — read the first 20 lines of each and flag any that contain AI-instruction patterns (role assignments, "you are", "always", "never", "constraints", YAML frontmatter with \`description\`/\`alwaysApply\`). These are potential migration candidates.
3. **Guide IDENTITY.md** — Propose a Role based on detected tech stack. Explain each section (Role, Mindset, Autonomy Level, Constraints, Permissions). Suggest project-specific constraints from scan. Ask autonomy level preference (HIGH/MEDIUM/LOW TOUCH). User edits the file. Skippable.
4. **Guide reference/PROJECT.md** — Present scan findings as suggestions for: Project Overview, Tech Stack, Architecture, Data Models, Integrations, Dev Setup. User edits the file. Skippable.
5. **Guide PROJECT_STATUS.md** — Suggest Current Focus from git log, Open Questions from scan gaps, What's Working from observed patterns. User edits. Skippable.
6. **Knowledge audit & migration** — Two parallel scans:

   **Layer 1 — Broad directory scan:** Scan ALL tool-specific directories for user content. Check every file under the tool's directory tree (e.g. everything in \`.cursor/\`, \`.claude/\`, \`.agents/\`, \`.codex/\`, \`.cursor-plugin/\`, \`.claude-plugin/\`). Exclude ai-memory managed files (bootstrap rules like \`00-load-ai-memory.mdc\`, skill stubs, \`mcp.json\`, \`settings.json\`). This catches files in current AND future subdirectories — do not rely on a fixed list of subdirectory names.

   **Layer 2 — Known files + heuristic:** Check for known root files: \`.cursorrules\`, \`.windsurfrules\`, \`.clinerules\`, \`CLAUDE.md\`, \`AGENTS.md\`, \`codex.md\`, \`.github/copilot-instructions.md\`, \`.aider.conf.yml\`. Also check known subdirectories within tool dirs: \`rules/\`, \`skills/\`, \`agents/\`, \`commands/\`, \`hooks/\`. Also report any root \`*.md\` files flagged in Step 2 as potential AI-instruction files.

   **Important:** \`.cursorrules\` and \`.cursor/rules/\` are related — both are Cursor rule formats (legacy single-file vs modern multi-file). Same for \`AGENTS.md\` and \`.agents/rules/\`. Treat these as the same tool's configuration across format versions.

   **Cross-tool paths:** If the project has files readable by multiple tools (e.g. Cursor reads \`.claude/agents/\` and \`.codex/agents/\`), flag them and ask the user: "These files are shared across tools. Create canonical versions in \`.ai/\` so all tools reference the same source?"

   For each found file, propose migration:
   - **Behavioral rules** (constraints, "always/never" directives) → \`.ai/rules/\` canonical file + tool-specific stub
   - **Project info** (architecture, tech stack, setup) → \`.ai/reference/PROJECT.md\`
   - **Identity/role** (role definition, mindset, autonomy) → \`.ai/IDENTITY.md\`
   - **Workflows/protocols** (multi-step processes) → \`.ai/skills/<name>/SKILL.md\` + tool stub
   - **Agents** (specialized sub-agents) → \`.ai/agents/<name>.md\` + tool executable

   **Stub format for rules** (proven pattern — Cursor follows these reliably):
   \`\`\`
   ---
   description: <description from original>
   alwaysApply: <true|false>
   globs: <glob pattern if applicable>
   ---
   Read and follow the canonical rule at \`.ai/rules/<name>.md\`.
   \`\`\`

   Present the full migration proposal to the user. Ask for confirmation before each file. Do not migrate automatically.

7. **Recommendations** — Suggest relevant features: CI detected → mem-auto-review, multiple contributors → Full tier, no tests → testing-strategy pattern, monorepo → per-package skills.
8. **Validate** — Run \`npx @radix-ai/ai-memory validate\`. Print summary of what was done, remaining placeholders, and next steps.
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

// Load order: static → semi-static → dynamic (prefix-cache friendly).
// See .ai/rules/context-caching.md for rationale.
// 1. IDENTITY.md        — static,      lossless (constraints, role)
// 2. PROJECT_STATUS.md   — semi-static, lossless (project focus)
// 3. memory-index.md     — semi-static, lossless (pointer file, bounded)
const sections = [];

const identity = safeRead(join(aiDir, "IDENTITY.md"));
if (identity) sections.push(identity.trim());

const status = safeRead(join(aiDir, "PROJECT_STATUS.md"));
if (status) sections.push(status.trim());

const index = safeRead(join(aiDir, "memory/memory-index.md"));
if (index && !index.includes("<!-- Index will be generated")) {
  sections.push("## Memory Index (priority-ranked)\\n\\n" + index.trim());
}

if (sections.length === 0) process.exit(0);

process.stdout.write(JSON.stringify({
  type: "context",
  content: sections.join("\\n\\n---\\n\\n"),
}));
`;

// Pre-compact hook as a separate script to avoid escaping issues in JSON
// Compression policy: lossless files are preserved in full, lossy files are truncated.
// See .ai/rules/context-caching.md for rationale.
export const PRE_COMPACT_HOOK = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const aiDir = process.env.AI_DIR || path.join(process.cwd(), ".ai");
if (!fs.existsSync(aiDir)) process.exit(0);
const tempDir = path.join(aiDir, "temp");
fs.mkdirSync(tempDir, { recursive: true });
const dump = { timestamp: new Date().toISOString(), event: "pre-compact" };

// Lossless: constraints, identity, project status — never truncate or summarize
const lossless = ["IDENTITY.md", "PROJECT_STATUS.md"];
for (const f of lossless) {
  const fp = path.join(aiDir, f);
  if (fs.existsSync(fp)) dump[f] = { compression: "lossless", content: fs.readFileSync(fp, "utf-8") };
}

// Lossy: session state, index pointers — bounded truncation is safe
const lossy = [
  ["memory/memory-index.md", 3000],
  ["sessions/open-items.md", 2000],
  ["sessions/thread-current.md", 1500],
];
for (const [f, maxChars] of lossy) {
  const fp = path.join(aiDir, f);
  if (fs.existsSync(fp)) dump[f] = { compression: "lossy", maxChars, content: fs.readFileSync(fp, "utf-8").slice(0, maxChars) };
}

fs.writeFileSync(path.join(tempDir, "pre-compact-dump.json"), JSON.stringify(dump, null, 2));
`;

export const MEMORY_HYGIENE_HOOK = `#!/usr/bin/env node
/**
 * ai-memory — Claude Code PostToolUse hook (memory hygiene)
 *
 * Fires after Write/Edit tool calls. If the target path is Claude Code's
 * auto-memory (~/.claude/projects/<id>/memory/), reminds the AI to also
 * save project-relevant learnings to .ai/memory/ via commit_memory.
 *
 * Does NOT block — emits additionalContext as a nudge.
 */
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d));
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const filePath = input.tool_input?.file_path || input.tool_input?.filePath || "";

    // Detect writes to Claude Code's internal memory directory
    const isClaudeMemory =
      /[\\\\/]\\.claude[\\\\/]projects[\\\\/][^\\\\/]+[\\\\/]memory[\\\\/]/.test(filePath);

    if (isClaudeMemory) {
      const isIndex = /MEMORY\\.md$/i.test(filePath);
      const context = isIndex
        ? "You updated Claude Code's memory index. If any entries contain project knowledge (decisions, patterns, debugging), ensure the same info exists in .ai/memory/ via commit_memory."
        : "MEMORY HYGIENE: You just wrote to Claude Code's auto-memory. " +
          "If this contains project knowledge (decisions, patterns, debugging findings, testing practices), " +
          "you MUST also save it to .ai/memory/ via commit_memory. " +
          "Claude Code memory is tool-specific and ephemeral. " +
          ".ai/memory/ is canonical and shared across all tools.";

      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: context,
          },
        })
      );
    }
  } catch {
    // Silent failure — hooks should never break the session
  }
});
`;

export const CLAUDE_HOOKS_CONFIG = JSON.stringify({
  hooks: {
    SessionStart: [{
      hooks: [{
        type: "command",
        command: "node .claude/hooks/SessionStart.cjs",
        timeout: 10000,
      }],
    }],
    PreCompact: [{
      hooks: [{
        type: "command",
        command: "node .claude/hooks/PreCompact.cjs",
        timeout: 10000,
      }],
    }],
    PostToolUse: [{
      matcher: "Write|Edit",
      hooks: [{
        type: "command",
        command: "node .claude/hooks/memory-hygiene.cjs",
        timeout: 5000,
      }],
    }],
  },
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
    postInstallNote: "Hooks installed: SessionStart (context injection), PreCompact (state preservation), PostToolUse (memory hygiene)\n  Note: Restart Claude Code for hooks to take effect.",
    extraFiles: {
      ...skillStubsForDir(".claude/skills"),
      ".claude/hooks/SessionStart.cjs": SESSION_START_HOOK,
      ".claude/hooks/PreCompact.cjs": PRE_COMPACT_HOOK,
      ".claude/hooks/memory-hygiene.cjs": MEMORY_HYGIENE_HOOK,
      ".claude/settings.local.json": CLAUDE_HOOKS_CONFIG,
    },
  },
};
