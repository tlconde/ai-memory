---
name: mem-session-close
description: Quick session close for sessions with no major learnings. Archives and updates open items.
---

# mem-session-close — Quick Session Close

## When to use
- Session was exploratory or mechanical
- Short session, no new decisions or patterns
- Want to close cleanly without the full compound loop

## Instructions

1. Call `publish_result` with a brief summary and outcome
2. Update `sessions/open-items.md`: close resolved items, add new ones
3. If in ephemeral environment: call `sync_memory`
4. Report: "Session closed. [N] items updated."
