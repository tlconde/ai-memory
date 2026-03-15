---
id: cursor-platform
type: toolbox
status: active
last_updated: 2026-03-15
---

# Cursor Platform Reference

Loaded on demand when tasks involve Cursor integration, plugin development, or cloud agent compatibility.

## Rules

Rules live in `.cursor/rules/` as `.md` or `.mdc` files with YAML frontmatter.

| Application type | Behavior |
|---|---|
| `alwaysApply: true` | Fires every chat |
| `alwaysApply: false` | Agent decides relevance via `description` field |
| Glob-scoped | Activates when file matches patterns |
| Manual | Invoked via `@rule-name` |

Precedence: Team Rules → Project Rules → User Rules.

## Skills

Skills live in `.cursor/skills/<name>/SKILL.md` or `.agents/skills/<name>/SKILL.md` (both checked).

Required frontmatter: `name`, `description`.
Optional: `disable-model-invocation` (true = slash command only), `license`, `compatibility`, `metadata`.

Invokable via `/skill-name` in Agent chat. Agent also auto-applies skills when contextually relevant unless `disable-model-invocation: true`.

Skills can include `scripts/`, `references/`, `assets/` subdirectories.

## Cloud Agents

Cloud agents clone the repo from GitHub/GitLab, work on a separate branch, push changes.

- Run in isolated VMs with desktop environment
- MCP supported: HTTP recommended over stdio (credentials stay server-side)
- Read `.cursor/rules/` and `.cursor/skills/` from the cloned repo
- Can control browser (screenshots, testing, UI verification)
- Max Mode models only
- Triggered from: Cursor Desktop, cursor.com/agents, Slack, GitHub, Linear, API

For ai-memory: `.ai/` must be git-tracked. MCP server should support HTTP transport.

## Automations

Always-on agents triggered by schedules or events:
- Slack messages, Linear issues, GitHub PR merges, PagerDuty incidents
- Custom webhooks
- Scheduled (cron-like)

Automations have MCP access and a built-in "memory tool" to learn from past runs.
Skills and rules must work without user interaction for automation context.

## Bugbot

Code review agent that auto-reviews PRs. Spawns cloud agents in VMs.
Bugbot Autofix can propose and merge fixes automatically.
Activated via Bugbot dashboard. Can be disabled per-PR with `@cursor autofix off`.

## Integrations

| Platform | Trigger | How it works |
|---|---|---|
| Slack | `@cursor` in messages | Agent clones repo, reads thread context, creates PR |
| GitHub | PR/issue comments | Agent responds to comments, auto-fixes CI failures |
| Linear | `@cursor` on issues | Agent picks up issue, works on solution |
| API | HTTP endpoint | Programmatic agent invocation |

## AGENTS.md

Alternative to `.cursor/rules/` for simple cases. Place in project root.
Nested `AGENTS.md` in subdirectories apply context-specifically with inheritance.
