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

/** Full skill content — written to .ai/skills/<name>/SKILL.md by install */
export const CANONICAL_SKILLS: Record<string, string> = {
  "mem-compound": `---
name: mem-compound
description: Captures session learnings into persistent memory. Use after a bug fix, pattern discovery, corrected approach, or at the end of any meaningful session.
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
name: mem-session-close
description: Quick session close for sessions with no major learnings. Archives and updates open items.
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
name: mem-validate
description: Validate memory entries and code changes against governance rules. Use before risky changes.
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
name: mem-init
description: Initialize ai-memory in a new project. Scaffolds the .ai/ directory structure.
disable-model-invocation: true
---

# mem-init — Project Setup

## Instructions

1. Confirm the user wants to initialize ai-memory in this project
2. Ask: Default tier or Full tier (adds governance, evals, ACP)?
3. Run: \`ai-memory init\` (or \`ai-memory init --full\`)
4. Guide the user to edit \`.ai/IDENTITY.md\` and \`.ai/PROJECT_STATUS.md\`
5. Run \`ai-memory validate\` to confirm setup
`,
  browser: `---
name: browser
description: Use browser automation (screenshots, navigate, interact). Requires browser MCP.
type: skill
status: active
requires:
  capabilities: [browser]
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
fs.writeFileSync(path.join(tempDir, "pre-compact-dump.json"), JSON.stringify(dump, null, 2));
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
}

export const TOOL_ADAPTERS: Record<string, ToolAdapter> = {
  cursor: {
    dest: ".cursor/rules/00-load-ai-memory.mdc",
    content: `---\ndescription: Load ai-memory project context at session start\nalwaysApply: true\n---\n\n${BOOTSTRAP_INSTRUCTION}`,
    mcp: true,
    mcpPath: ".cursor/mcp.json",
    extraFiles: {
      // Stubs in .agents/skills/ point to canonical .ai/skills/
      ".agents/skills/mem-compound/SKILL.md": skillStub("mem-compound", "Captures session learnings into persistent memory."),
      ".agents/skills/mem-session-close/SKILL.md": skillStub("mem-session-close", "Quick session close for sessions with no major learnings."),
      ".agents/skills/mem-validate/SKILL.md": skillStub("mem-validate", "Validate memory entries and code changes against governance rules."),
      ".agents/skills/mem-init/SKILL.md": skillStub("mem-init", "Initialize ai-memory in a new project."),
      ".agents/skills/browser/SKILL.md": skillStub("browser", "Browser automation (screenshots, navigate, interact)."),
      ".agents/skills/screen-capture/SKILL.md": skillStub("screen-capture", "Desktop/app window screenshot for vision analysis."),
    },
  },
  windsurf: {
    dest: ".windsurfrules",
    content: BOOTSTRAP_INSTRUCTION,
    mcp: true,
  },
  cline: {
    dest: ".clinerules",
    content: BOOTSTRAP_INSTRUCTION,
    mcp: true,
  },
  copilot: {
    dest: ".github/copilot-instructions.md",
    content: `# Copilot Instructions\n\n${BOOTSTRAP_INSTRUCTION}\n\n> Note: GitHub Copilot does not support MCP. Skills must be run by pasting content from \`.ai/skills/\`.\n`,
    mcp: false,
  },
  "claude-code": {
    dest: "CLAUDE.md",
    content: `# Claude Code — Project Memory\n\n${BOOTSTRAP_INSTRUCTION}`,
    mcp: true,
    extraFiles: {
      // Stubs in .agents/skills/ point to canonical .ai/skills/
      ".agents/skills/mem-compound/SKILL.md": skillStub("mem-compound", "Captures session learnings into persistent memory."),
      ".agents/skills/mem-session-close/SKILL.md": skillStub("mem-session-close", "Quick session close for sessions with no major learnings."),
      ".agents/skills/mem-validate/SKILL.md": skillStub("mem-validate", "Validate memory entries and code changes against governance rules."),
      ".agents/skills/mem-init/SKILL.md": skillStub("mem-init", "Initialize ai-memory in a new project."),
      ".agents/skills/browser/SKILL.md": skillStub("browser", "Browser automation (screenshots, navigate, interact)."),
      ".agents/skills/screen-capture/SKILL.md": skillStub("screen-capture", "Desktop/app window screenshot for vision analysis."),
      // Claude Code hooks (SessionStart, PreCompact)
      ".claude/hooks/SessionStart.js": SESSION_START_HOOK,
      ".claude/hooks/PreCompact.js": PRE_COMPACT_HOOK,
      ".claude/settings.local.json": CLAUDE_HOOKS_CONFIG,
    },
  },
};
