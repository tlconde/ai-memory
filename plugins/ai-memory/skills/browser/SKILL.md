---
name: browser
description: Use browser automation (screenshots, navigate, interact). Requires browser MCP.
type: skill
status: active
requires:
  capabilities: [browser]
  permission: read   # read | edit | write — only request what the task needs
---

# browser — Browser Automation Skill

## When to use

- Take screenshots of web pages
- Navigate, fill forms, click elements
- Verify visual changes or UI state

## Setup

Ensure browser capability is enabled for your environment. See `.ai/reference/capability-specs.json` or run `ai-memory install --capability browser` when available.

## Usage patterns

- **Failures** → write to `debugging.md` via `commit_memory` with symptom, screenshot path, root cause
- **Screenshots** → reference path in memory entries; include URL and viewport
- **Visual regression** → `search_memory` for known changes; create debugging entry if unexpected
