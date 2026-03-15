---
name: mem-session-close
description: Lite session close. Archives the session and updates open items without a full compound run. Use when ending a session that produced no new decisions or patterns worth capturing.
---

# mem:session-close — Lite Path

## When to use

- Session was exploratory or mechanical (no new decisions, patterns, or bugs)
- Short session not worth a full compound run
- Want to close cleanly without the full loop

For sessions with real learning, use `/mem:compound` instead.

## Steps

### 1. Pre-compact dump
If a pre-compact dump exists in `.ai/temp/`, process it first.

### 2. Archive
Add a one-line summary to `sessions/archive/thread-archive.md`:
```
[date] Brief description of what was done. No major decisions.
```

### 3. Open items
Review `sessions/open-items.md`:
- Close any items resolved during this session
- Add any newly discovered items

### 4. Sync (ephemeral environments)
If running in a worktree, cloud agent, or sandbox: call `sync_memory` to git commit all `.ai/` changes.

### 5. Report
One line: "Session closed. [N] items updated."

No index regeneration. No governance gate. No topic file writes.
