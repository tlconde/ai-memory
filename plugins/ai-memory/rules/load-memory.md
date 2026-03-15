---
name: load-memory
description: Load project memory at session start. Required for ai-memory to work in any IDE.
alwaysApply: true
---

This project has persistent AI memory in `.ai/`.

- **IDENTITY.md** — project constraints and behavioral rules
- **PROJECT_STATUS.md** — current focus, open questions, what to try next (writable)
- **memory/** — decisions, patterns, debugging history

Use `search_memory` (MCP) to find relevant context before starting a task.
Use `commit_memory` to write new entries — never edit memory files directly.
If MCP is not connected, read `.ai/memory/memory-index.md` for a summary and write to `.ai/memory/` files directly.

`.ai/` is the canonical memory for this project. Save all project learnings here, not in your tool's built-in memory (e.g. ~/.claude/, Cursor memory, etc.). Tool-native memory is for user preferences only.

IDENTITY.md is immutable by default — do not write to it unless `writable: true` is set in its frontmatter.
Immutable paths: toolbox/, acp/, rules/.

At session end: run `/mem-compound` to persist learnings. In ephemeral environments (worktrees, cloud agents), also call `sync_memory`.
