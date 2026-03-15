/**
 * Tool adapter definitions for `ai-memory install --to <tool>`.
 * Extracted from index.ts for maintainability.
 */

export const BOOTSTRAP_INSTRUCTION = `## ai-memory — Project Memory

At the start of every session:

1. Read \`.ai/IDENTITY.md\` — project constraints and how to behave
2. Read \`.ai/DIRECTION.md\` — current focus and open questions
3. Read \`.ai/memory/memory-index.md\` — priority-ranked index of all active decisions, patterns, and debugging entries

Before starting any task:
- Search \`.ai/memory/\` for decisions, patterns, or bugs relevant to the task
- Search \`.ai/skills/\` for domain-specific patterns
- Fetch \`.ai/reference/PROJECT.md\` only when the task requires architecture or data model context

During the session:
- If connected to the ai-memory MCP server, use \`search_memory\` instead of reading files directly
- Use \`commit_memory\` to write new entries (never edit memory files directly)
- Immutable paths (do not write): IDENTITY.md, toolbox/, acp/, rules/
- DIRECTION.md is writable — update it with what you learned

At the end of a meaningful session, run /mem-compound to capture learnings.
If running as a sub-agent (worktree, cloud agent, background task), run /mem-compound before exiting — your memory will be lost otherwise.
`;

export const MCP_JSON = JSON.stringify({
  mcpServers: {
    "ai-memory": {
      type: "stdio",
      command: "npx",
      args: ["@radix-ai/ai-memory", "mcp"],
      env: { AI_DIR: "${workspaceFolder}/.ai" },
    },
    "context7": {
      type: "http",
      url: "https://mcp.context7.com/mcp",
      headers: {
        "x-api-key": "${CONTEXT7_API_KEY:-}",
      },
    },
  },
}, null, 2);

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

### 3. Update DIRECTION.md
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
4. Guide the user to edit \`.ai/IDENTITY.md\` and \`.ai/DIRECTION.md\`
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
