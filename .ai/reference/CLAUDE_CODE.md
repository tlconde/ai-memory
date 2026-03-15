---
id: claude-code-platform
type: toolbox
status: active
last_updated: 2026-03-15
---

# Claude Code Platform Reference

Loaded on demand when tasks involve Claude Code integration, hook development, or sub-agent design.

## Hooks

20+ lifecycle events. Four hook types: `command`, `http`, `prompt`, `agent`.

### Key events for ai-memory

| Event | When | Hook types | ai-memory use |
|---|---|---|---|
| `SessionStart` | Session begins | command | Inject .ai/ context |
| `Stop` | Agent finishes | all | Trigger compound/sync |
| `PreCompact` | Before context compaction | command | Dump memory state |
| `PostCompact` | After compaction | command | Reload memory context |
| `SubagentStop` | Sub-agent finishes | all | Trigger sync_memory |
| `WorktreeCreate` | Creating worktree | command | Ensure .ai/ available |
| `PreToolUse` | Before tool runs | all | Validate via governance |
| `PostToolUse` | After tool runs | all | Capture learnings |

### Hook configuration

Hooks go in `.claude/settings.json`, `.claude/settings.local.json`, or plugin `hooks/hooks.json`.

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "prompt", "prompt": "..." }] }]
  }
}
```

Exit code 2 = blocking error. Exit code 0 = success. JSON output via stdout.

## Sub-agents

Defined in `.claude/agents/` (project) or `~/.claude/agents/` (user). Markdown with YAML frontmatter.

### Key frontmatter fields

| Field | Description |
|---|---|
| `name` | Unique identifier (required) |
| `description` | When to delegate (required) |
| `tools` | Allowed tools (default: inherit all) |
| `model` | `sonnet`, `opus`, `haiku`, `inherit` |
| `mcpServers` | MCP servers (inline or reference) |
| `hooks` | Lifecycle hooks scoped to this agent |
| `memory` | `user`, `project`, or `local` — persistent cross-session memory |
| `skills` | Skills to preload into context |
| `background` | Run as background task |
| `isolation` | `worktree` for isolated git copy |

### Persistent memory

`memory: project` stores to `.claude/agent-memory/<agent-name>/` with auto-curated `MEMORY.md`.
Complementary to ai-memory's `.ai/` system — agent memory is per-agent, ai-memory is per-project.

## Skills

Same SKILL.md format as Cursor. Loaded from:
- `.claude/skills/`, `.agents/skills/` (project)
- `~/.claude/skills/` (user)
- Plugin `skills/` directory

Skills can define hooks in frontmatter. Skills can run in sub-agents via `context: fork`.

## Worktrees

`claude -w <name>` creates isolated git worktree at `.claude/worktrees/<name>`.
Auto-cleaned if no changes made. `WorktreeCreate`/`WorktreeRemove` hooks available.

## Agent Teams

Multiple Claude instances working in parallel. Each has own context window.
Configure via `--teammate-mode` (`auto`, `in-process`, `tmux`).
Use `TeammateIdle` hook to keep teammates working.

## Remote Control

`claude remote-control` starts server controllable from claude.ai.
`claude --remote "task"` creates web session.
`claude --teleport` resumes web session locally.

## CLI key flags

| Flag | Purpose |
|---|---|
| `--agent <name>` | Run with specific agent |
| `--worktree`, `-w` | Isolated worktree |
| `--mcp-config` | Load MCP servers |
| `--plugin-dir` | Load plugins |
| `--chrome` | Browser integration |
| `--print`, `-p` | Non-interactive (SDK mode) |
| `--max-turns` | Limit agent turns |
| `--max-budget-usd` | Cost limit |
