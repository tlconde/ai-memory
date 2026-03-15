# Project Memory (ai-memory)

This project uses [ai-memory](https://github.com/radix-ai/ai-memory) for persistent AI memory.

## At session start

1. Read `.ai/IDENTITY.md` — project constraints and how to behave
2. Read `.ai/DIRECTION.md` — current focus and open questions
3. Read `.ai/memory/memory-index.md` — priority-ranked summary of all active decisions, patterns, and bugs

## Before starting any task

- Search `.ai/memory/` for relevant decisions, patterns, or known bugs
- Search `.ai/skills/` for domain-specific patterns
- Fetch `.ai/reference/PROJECT.md` only when the task requires architecture or integration context

## During the session

- Use `search_memory` (MCP) instead of reading memory files directly when available
- Use `commit_memory` (MCP) to write new entries — never edit memory files directly
- Immutable (do not write): `IDENTITY.md`, `DIRECTION.md`, `toolbox/`, `acp/`, `rules/`

## At the end of a meaningful session

Run `/mem:compound` to capture decisions, patterns, and bugs from this session.
