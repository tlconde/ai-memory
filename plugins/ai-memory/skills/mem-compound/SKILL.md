---
name: mem-compound
description: Captures session learnings into persistent memory. Use after a non-obvious bug fix, a pattern discovery, a corrected approach, or at the end of any meaningful session.
---

# mem-compound — Full Compound Loop

## When to run

- A bug had a non-obvious root cause
- A reusable pattern emerged
- An approach was corrected mid-session
- The session produced architectural decisions
- End of any session worth preserving

Skip: purely mechanical tasks with no new learning.

## Steps

### 0. Pre-compact dump
If a pre-compact dump exists in `.ai/temp/`, process it first before scanning the live session.

### 1. Scan
Review the session: conversation, code changes, errors encountered. Identify:
- Bugs fixed with non-obvious causes → `debugging.md`
- Reusable patterns discovered → `patterns.md`
- Architectural or process decisions made → `decisions.md`
- Incremental improvements worth noting → `improvements.md`

### 2. Conflict check, then capture
Before writing each entry: search existing entries for contradictions.

To search: call `search_memory` with the topic of the new entry.

If a contradiction is found with an existing entry:
- Mark the old entry `[DEPRECATED]` and add `**Superseded by:** [new entry title]`
- Write the new entry normally
- Never delete old entries — the history of why things changed is valuable

Write each entry with:
- Priority tag: `[P0]` (critical, never violate), `[P1]` (important), `[P2]` (advisory)
- Context, decision/pattern/fix, rationale, tradeoffs
- Optional: `**Links to:**`, `**Supersedes:**`

For `[P0]` entries, add a `constraint_pattern` in frontmatter if the rule can be expressed as a code check (see `.ai/temp/harness.json` format).

### 3. Update PROJECT_STATUS.md
PROJECT_STATUS.md is writable by default. Update it with what you learned:
- Move completed focus items to "What's Working"
- Add new open questions discovered during the session
- Update "What to Try Next" based on results
- This is the RALPH loop: each iteration evolves the focus

### 4. Archive and open items
- Call `publish_result` with a summary, outcome, and learnings
- Update `sessions/open-items.md`: close resolved items, add new ones

### 5. Regenerate index
Call `commit_memory` with type `index` to regenerate `memory-index.md`. The index is always auto-generated — never edit it manually.

### 6. Governance gate (Full tier only)
If `.ai/temp/harness.json` exists:
1. Call `generate_harness` to refresh rules from current [P0] entries
2. Call `validate_context` with the current git diff
3. Call `validate_schema` on each new memory entry

If any check fails: resolve the violation before proceeding. The gate does not warn — it blocks.

### 7. Sync (ephemeral environments)
If running in a worktree, cloud agent, or sandbox: call `sync_memory` to git commit all `.ai/` changes. Without this, your work will be lost when the environment is cleaned up.

### 8. Report & memory hygiene

Summarize the session in a structured report:

**Session summary:**
- Entries written: list each (type, priority, title)
- Items: N opened, N closed
- Gate: passed / N violations resolved

**Memory hygiene check:**
Call `prune_memory` with `dry_run: true`. Then report:

- **Clean** (no deprecated entries): "Memory is clean — no stale entries found."
- **Stale entries found**: List them clearly:
  ```
  Found N deprecated entries:
    1. [topic-file.md] "Entry title" — deprecated on YYYY-MM-DD
    2. ...

  To clean up, say: "prune these deprecated entries"
  Or ignore — they're already excluded from search results.
  ```

Keep the report concise. The user should be able to act on it immediately or move on.

---

## Automation mode

When running as a Cursor automation, Bugbot task, or CI step (no user interaction):
- Skip any steps that require user confirmation
- Use `search_memory` + `git diff` as input instead of conversation scanning
- Always call `sync_memory` at the end (automations are ephemeral)
- Output a structured report (markdown) rather than conversational summary
