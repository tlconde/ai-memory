---
id: integrations
type: toolbox
status: active
---

# Integration Patterns

How to use ai-memory with external platforms and automation triggers.

## Slack → Agent → Memory

When triggered from Slack (Cursor `@cursor` or custom webhook):
1. Agent clones repo — `.ai/` is available because it's git-tracked
2. Read IDENTITY.md and DIRECTION.md for project context
3. Search memory for relevant decisions before starting work
4. Use `claim_task` to prevent duplicate work
5. After work: `publish_result` + `sync_memory` + push branch

## GitHub PR → Review → Memory

When triggered by PR creation (Bugbot, automation, CI):
1. Get diff with `git diff origin/main...HEAD`
2. Run `validate_context` against governance rules
3. Search memory for patterns relevant to changed files
4. Report violations and suggestions
5. Record result with `publish_result`

## Linear/Jira → Task → Memory

When triggered by issue assignment:
1. Read issue context from the trigger
2. `claim_task` with the issue description
3. Search memory for related decisions and patterns
4. Do the work, capture learnings
5. `publish_result` + `sync_memory`

## Scheduled/Cron → Maintenance → Memory

For recurring tasks (weekly audit, dependency check):
1. Read current memory state
2. Run `ai-memory eval` for health metrics
3. Run `ai-memory prune` for stale entries
4. Publish maintenance report to thread-archive
