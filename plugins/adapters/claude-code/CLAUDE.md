# Project Memory (ai-memory)

This project uses [ai-memory](https://github.com/radix-ai/ai-memory) for persistent AI memory.

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
