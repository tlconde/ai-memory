---
name: desktop-automation
description: Desktop UI automation — mouse, keyboard, OCR. For any desktop application, Electron apps, legacy software. Requires desktop_automation capability.
type: skill
status: active
requires:
  capabilities: [desktop_automation]
---

# desktop-automation — Desktop UI Automation Skill

## When to use

- Type into any desktop chat or other Electron apps
- Automate legacy desktop apps without APIs
- UI testing, data entry, accessibility tools

## Permissions

Declare the minimal permission needed for the task (see capability-specs.json):
- **read** — Observe, screenshot, OCR only
- **edit** — Click, type, navigate (no destructive actions)
- **write** — Full control (submit, delete, etc.)

Only request the permission the task requires.

## Setup

- **Cursor/Claude Code/Windsurf/Cline:** Run `ai-memory install --capability desktop_automation`
- **Antigravity:** Add ai-memory-desktop-automation to `~/.gemini/antigravity/mcp_config.json` manually. Config: `{ "command": "uvx", "args": ["--python", "3.13", "computer-control-mcp@latest"] }`
- **Python 3.14 users:** onnxruntime has no wheels for 3.14 yet. The config pins `--python 3.13` so uv uses a compatible version. If you see "No solution found when resolving tool dependencies", ensure uv can access Python 3.13 (`uv python install 3.13`).

## Usage

- Use mouse/keyboard tools for interaction; OCR for reading screen content
- Save captures to `.ai/temp/` for handoff
