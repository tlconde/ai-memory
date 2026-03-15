---
name: bootstrap-instruction
description: Canonical context-loading instruction for any AI tool. Mirrors BOOTSTRAP_INSTRUCTION in src/cli/adapters.ts.
type: toolbox
status: active
---

# Bootstrap Instruction (canonical)

This file mirrors the `BOOTSTRAP_INSTRUCTION` constant in `src/cli/adapters.ts`. Use `ai-memory install --to <tool>` to inject it automatically — do not copy manually.

---

## ai-memory — Project Memory

This project has persistent AI memory in `.ai/`.

- **IDENTITY.md** — project constraints and behavioral rules
- **PROJECT_STATUS.md** — current focus, open questions, what to try next (writable)
- **memory/** — decisions, patterns, debugging history

Use `search_memory` (MCP) to find relevant context before starting a task.
Use `commit_memory` to write new entries — never edit memory files directly.
If MCP is not connected, read `.ai/memory/memory-index.md` for a summary and write to `.ai/memory/` files directly.

`.ai/` is the canonical memory for this project. Save all project learnings here, not in your tool's built-in memory (e.g. ~/.claude/, Cursor memory, etc.). Tool-native memory is for user preferences only.

Immutable paths (do not write): IDENTITY.md, toolbox/, acp/, rules/.

At the end of a meaningful session, run /mem-compound to capture learnings.
