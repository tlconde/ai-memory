---
name: load-memory
description: Load project memory at session start. Required for ai-memory to work in any IDE.
alwaysApply: true
---

At the start of every session:

1. Read `.ai/IDENTITY.md` and `.ai/DIRECTION.md`
2. Read `.ai/memory/memory-index.md` (priority-ranked summary of all active entries)
3. Search `.ai/memory/` for entries relevant to the current task before starting work
4. Search `.ai/skills/` and `.ai/toolbox/` for applicable domain patterns
5. Fetch `.ai/reference/PROJECT.md` only when the task requires architecture or data model context

Before starting work:
- Call `claim_task` to claim what you're working on (prevents duplicate work across concurrent agents)
- Check `get_open_items` for existing tasks you can pick up

Do not load full memory files wholesale. Fetch specific files via `memory://file/{name}` only when the task explicitly needs them.

DIRECTION.md is writable — update it with what you learn during the session.
IDENTITY.md is immutable by default — do not write to it unless `writable: true` is set in its frontmatter.

At session end: run `/mem:compound` to persist learnings. In ephemeral environments (worktrees, cloud agents), also call `sync_memory`.
