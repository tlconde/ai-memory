---
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
- Bugs with non-obvious causes → write to `debugging.md` via `commit_memory`
- Reusable patterns → write to `patterns.md` via `commit_memory`
- Decisions made → write to `decisions.md` via `commit_memory`
- Improvements → write to `improvements.md` via `commit_memory`

### 2. Conflict check
Before writing: call `search_memory` for each topic. If contradictions found, mark old entry `[DEPRECATED]`.

### 3. Update DIRECTION.md
Update with learnings: move completed items to "What's Working", add new open questions, update "What to Try Next".

### 4. Archive
Call `publish_result` with summary, outcome, and learnings.
Update `sessions/open-items.md`: close resolved items, add new ones.

### 5. Governance gate (if harness.json exists)
Call `generate_harness`, then `validate_context` with git diff.

### 6. Sync (ephemeral environments only)
If in worktree/cloud agent: call `sync_memory` to git commit .ai/ changes.

### 7. Report
Summarize: entries written, items opened/closed, gate result.
