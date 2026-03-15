---
id: integrations
type: toolbox
status: active
last_updated: 2026-03-15
---

# Integration Patterns

How ai-memory works with external platforms and tools.

## Slack → Cursor Cloud Agent → ai-memory

1. User mentions `@cursor fix the auth bug` in Slack
2. Cloud agent clones repo (`.ai/` is git-tracked, so it's available)
3. Agent reads `.cursor/rules/00-load-ai-memory.mdc` → loads IDENTITY, DIRECTION, memory-index
4. Agent calls `claim_task` via MCP → claims the task
5. Agent does work, calls `commit_memory` to capture decisions
6. Agent calls `publish_result` → records outcome in thread-archive
7. Agent calls `sync_memory` → git commits `.ai/` changes
8. Agent pushes branch, creates PR

## GitHub PR → Bugbot → ai-memory

1. PR is created → Bugbot activates
2. Bugbot reads `.ai/` from the repo (rules, patterns, governance)
3. Bugbot runs `validate_context` against the PR diff
4. If P0 violations found → Bugbot comments on PR with violations
5. If Autofix enabled → Bugbot spawns cloud agent to fix violations
6. Fixed agent calls `publish_result` with outcome

## Linear Issue → Cursor Automation → ai-memory

1. Issue assigned in Linear → triggers Cursor automation
2. Automation agent clones repo, reads `.ai/`
3. Agent calls `search_memory` for related decisions/patterns
4. Agent calls `claim_task` with issue description
5. Agent implements, calls `commit_memory` for any new decisions
6. Agent calls `sync_memory`, pushes PR

## Browser Testing (Playwright/Chrome)

Both Cursor and Claude Code support browser control:
- Cursor: Cloud agents have desktop VM with browser
- Claude Code: `--chrome` flag enables browser integration

Pattern with ai-memory:
1. Agent reads test patterns from `.ai/skills/` or `.ai/toolbox/browser.md`
2. Agent runs Playwright/browser tests
3. Agent captures test results as memory entries
4. Failures become debugging entries in `debugging.md`

## Shell / Bash Operations

Agents can run shell commands. Common memory patterns:
- `git diff` output → feed to `validate_context`
- `npm test` output → capture failures in `debugging.md`
- Build logs → extract patterns for `patterns.md`
- Deploy scripts → record deployment decisions in `decisions.md`

## MCP Transport

| Environment | Transport | Why |
|---|---|---|
| Local IDE (Cursor, Claude Code) | stdio | Simple, secure, no network |
| Cursor cloud agents | HTTP | Credentials stay server-side |
| Cursor automations | HTTP | Remote execution |
| Claude Code worktrees | stdio | Local process, shared filesystem |

Configure via:
- stdio: `npx @radix-ai/ai-memory mcp`
- HTTP: `npx @radix-ai/ai-memory mcp --http --port 3100`
