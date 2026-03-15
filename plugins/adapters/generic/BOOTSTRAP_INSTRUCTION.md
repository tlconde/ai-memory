---
name: bootstrap-instruction
description: Canonical context-loading instruction for any AI tool. Paste into your tool's rules file, system prompt, or equivalent.
type: toolbox
status: active
---

# Bootstrap Instruction (canonical)

Copy the block below into your tool's context-loading mechanism (`.cursorrules`, `.windsurfrules`, `.clinerules`, system prompt, etc.).

---

```
## ai-memory — Project Memory

At the start of every session:

1. Read `.ai/IDENTITY.md` — project constraints and how to behave
2. Read `.ai/DIRECTION.md` — current focus and open questions (you can update this)
3. Read `.ai/memory/memory-index.md` — priority-ranked index of all active decisions, patterns, and debugging entries

Before starting any task:
- Search `.ai/memory/` for decisions, patterns, or bugs relevant to the task
- Search `.ai/skills/` for domain-specific patterns
- Fetch `.ai/reference/PROJECT.md` only when the task requires architecture or data model context

During the session:
- If connected to the ai-memory MCP server, use `search_memory` instead of reading files directly
- Use `commit_memory` to write new entries (never edit memory files directly)
- Immutable paths (do not write): IDENTITY.md, toolbox/, acp/, rules/
- DIRECTION.md is writable — update it with what you learned

At the end of a meaningful session, run `/mem:compound` to capture learnings.
If running as a sub-agent (worktree, cloud agent, background task), run `/mem:compound` before exiting — your memory will be lost otherwise.
```

---

## Notes

- Replace the block delimiters with whatever your tool expects (some tools use plain text, others expect markdown, others expect JSON)
- If your tool doesn't support MCP, the instruction above still works — the AI reads files directly instead of using the tools
- IDENTITY.md immutability is enforced by default; set `writable: true` in its frontmatter to allow AI writes
- DIRECTION.md is writable by default — this enables RALPH-style iterative loops where the AI evolves its own program
- The claim system prevents concurrent agents from corrupting the same file
