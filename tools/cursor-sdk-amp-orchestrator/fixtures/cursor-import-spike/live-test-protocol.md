# Live Cursor import test protocol (not executed in AMP-PROJ-01)

This spike task cannot mutate `.cursor/rules/` (out of scope). Use this protocol in a follow-up live session.

## Setup

1. Create `.cursor/rules/amp-import-spike.mdc`:

```yaml
---
description: AMP cursor import spike — manual only
alwaysApply: false
---

@tools/cursor-sdk-amp-orchestrator/fixtures/cursor-import-spike/projection-leaf.md
```

2. Create `.cursor/rules/amp-import-chain-spike.mdc` with `@.../projection-chain-a.md` instead.

3. In Agent chat, `@amp-import-spike` and ask: "Quote the exact marker string in the injected projection file."

4. Repeat for chain fixture; check whether `AMP-CURSOR-SPIKE-CHAIN-B` appears without manually `@`-mentioning chain-b.

## Pass criteria

| Case | Pass if agent quotes marker without Read tool on target file |
|---|---|
| Single-level `@projection-leaf.md` | `AMP-CURSOR-SPIKE-LEAF-001` visible in context |
| Recursive `@` inside injected markdown | `AMP-CURSOR-SPIKE-CHAIN-B` visible when only chain-a is referenced |

## Optional path variants

Repeat with:

- `@.amp/local/projection.md` (project-relative, outside `.cursor/rules/`)
- `@~/.amp/projection/global.md` (home-absolute, Claude-style)

Record Cursor version from **Help → About**.
