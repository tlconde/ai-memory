---
name: screen-capture
description: Capture desktop or app window for vision analysis. Platform-dependent (e.g. Peekaboo on macOS).
type: skill
status: active
requires:
  capabilities: [screen_capture]
---

# screen-capture — Desktop/App Screenshot Skill

## When to use

- Read another app's screen (e.g. IDE, browser window)
- Capture for vision analysis or handoff
- Save to `.ai/temp/` for cross-tool handoff

## Setup

See `.ai/reference/capability-specs.json` for platform-specific install (e.g. Peekaboo on macOS). Manual fallback: screenshot to `.ai/temp/screen.png`.

## Usage

- Capture → save to `.ai/temp/` → agent reads via file or `get_memory`
- Handoff: write path to `.ai/temp/request-for-*.md` for another agent
