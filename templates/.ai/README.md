# .ai/ — Canonical AI Agent Workspace

**This directory is the single source of truth for all AI agents working on this codebase, regardless of tool (Cursor, Claude Code, Windsurf, Copilot, or any future tool).**

## Structure

```
.ai/
├── IDENTITY.md              ← Behavioral contract (who the agent is, guardrails, permissions)
├── reference/
│   └── PROJECT.md           ← Full project reference (architecture, data models, integrations, warnings)
├── memory/
│   ├── debugging.md         ← Non-obvious bugs with root cause + fix (tagged [P0]/[P1]/[P2])
│   ├── decisions.md         ← Architectural decisions with rationale (tagged [P0]/[P1]/[P2])
│   ├── patterns.md          ← Reusable patterns confirmed across the codebase
│   ├── improvements.md      ← Proposed improvements (human or agent, awaiting decision)
│   └── memory-index.md      ← Auto-generated priority index of all tagged entries
├── sessions/
│   ├── open-items.md        ← Live registry of open/closed items (compound Step 3c)
│   └── archive/
│       └── thread-archive.md ← Curated session summaries (proposals, accepted, rejected)
├── rules/                   ← Behavioral constraints (observed, always active or glob-attached)
├── commands/                ← Invoked command protocols (audit, fix, compound, session-close, etc.)
├── agents/                  ← Agent methodology (_base-auditor.md shared, _template.md for new agents)
├── skills/                  ← Project domain knowledge
└── toolbox/                 ← Technology/capability knowledge (shell, browser, builds, hooks, MCP, verification, context)
```

## Placement Litmus Tests

| Question | If YES → | If NO → |
|----------|----------|---------|
| Do I INVOKE this on demand? | `commands/` | `rules/` |
| Is this about THIS PROJECT's domain? | `skills/` | `toolbox/` |
| Does this define behavior or enable capability? | `rules/` | `toolbox/` |
| Is this a specialized executor persona? | `agents/` | — |

## The Three Pillars

1. **Understand First** — Search memory and skills before building
2. **Decide Together** — Human-in-the-loop for decisions, not execution
3. **Reflect and Surface** — Capture learnings, surface improvements to human
