/**
 * Tool adapter definitions for `ai-memory install --to <tool>`.
 * Extracted from index.ts for maintainability.
 */

export const BOOTSTRAP_INSTRUCTION = `## ai-memory — Project Memory

At the start of every session:

1. Read \`.ai/IDENTITY.md\` — project constraints and how to behave
2. Read \`.ai/PROJECT_STATUS.md\` (or \`.ai/DIRECTION.md\`) — current focus and open questions
3. Read \`.ai/memory/memory-index.md\` — priority-ranked index of all active decisions, patterns, and debugging entries

Before starting any task:
- Search \`.ai/memory/\` for decisions, patterns, or bugs relevant to the task
- Search \`.ai/skills/\` for domain-specific patterns
- Fetch \`.ai/reference/PROJECT.md\` only when the task requires architecture or data model context

During the session:
- If connected to the ai-memory MCP server, use \`search_memory\` instead of reading files directly
- Use \`commit_memory\` to write new entries (never edit memory files directly)
- When creating docs under \`docs/\` or \`.ai/\`: use \`get_doc_path\` before writing, \`validate_doc_placement\` after. Read \`.ai/rules/doc-placement.md\` if present.
- Immutable paths (do not write): IDENTITY.md, toolbox/, acp/, rules/
- PROJECT_STATUS.md (or DIRECTION.md) is writable — update it with what you learned

At the end of a meaningful session, run /mem-compound to capture learnings.
If running as a sub-agent (worktree, cloud agent, background task), run /mem-compound before exiting — your memory will be lost otherwise.
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
    child = spawn("node", [npxCli, "-y", "@radix-ai/ai-memory", "mcp"], opts);
  } else {
    child = spawn("cmd", ["/c", "npx", "-y", "@radix-ai/ai-memory", "mcp"], { ...opts, windowsHide: true });
  }
} else {
  child = spawn("npx", ["-y", "@radix-ai/ai-memory", "mcp"], opts);
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

// ─── Cursor skills (.cursor/skills/<name>/SKILL.md format) ─────────────────

const CURSOR_COMPOUND_SKILL = `---
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

### 3. Update PROJECT_STATUS.md (or DIRECTION.md)
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
`;

const CURSOR_SESSION_CLOSE_SKILL = `---
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
`;

const CURSOR_VALIDATE_SKILL = `---
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
`;

const CURSOR_INIT_SKILL = `---
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
`;

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
      // Portable skill directory (.agents/skills/) — works in both Cursor and Claude Code
      ".agents/skills/mem-compound/SKILL.md": CURSOR_COMPOUND_SKILL,
      ".agents/skills/mem-session-close/SKILL.md": CURSOR_SESSION_CLOSE_SKILL,
      ".agents/skills/mem-validate/SKILL.md": CURSOR_VALIDATE_SKILL,
      ".agents/skills/mem-init/SKILL.md": CURSOR_INIT_SKILL,
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
      // Portable skills (same dir Cursor uses)
      ".agents/skills/mem-compound/SKILL.md": CURSOR_COMPOUND_SKILL,
      ".agents/skills/mem-session-close/SKILL.md": CURSOR_SESSION_CLOSE_SKILL,
      ".agents/skills/mem-validate/SKILL.md": CURSOR_VALIDATE_SKILL,
      ".agents/skills/mem-init/SKILL.md": CURSOR_INIT_SKILL,
    },
  },
};
