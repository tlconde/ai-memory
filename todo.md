# TODO: Reevaluate Hook Quality

## Why this exists

The current ai-memory hooks now support a small cross-agent import request flow, but the lifecycle design still deserves a later pass.

AMP introduced the better model: read existing tool-native memory or chat artifacts, distill durable project learnings, and bring those learnings into the canonical memory store. Original ai-memory should keep that filesystem-first and visible:

- `.ai/memory/` remains canonical project memory.
- Tool-native memories and chats are source material, not canonical truth.
- A coding agent performs the import/distillation pass.
- Hooks create a visible request instead of silently scraping or bulk-importing transcripts.

## What Exists In This Branch

- `ai-memory import init` writes `.ai/import-sources.json`.
- `ai-memory import scan` checks configured source paths without reading contents.
- `ai-memory import request --agent <agent> --from <sources>` writes `.ai/temp/import/latest-request.md`.
- Claude, Cursor, and Codex installs write hooks that create the same pending request.
- Claude PreCompact/PostCompact hooks preserve intent with command hooks and temp files.
- `ai-memory clean` includes old `.ai/temp/import/requests` and `.ai/temp/import/reports` files.

## Reevaluate Later

The next pass should improve how hooks preserve and classify intent:

- Separate session summary, durable project learning, user preference, transient conversation context, and repo navigation context.
- Keep the pre-compact dump small while preserving the user's latest intent.
- Decide whether import requests should be installed by default or enabled behind an explicit capability flag.
- Add richer import reports that list skipped sources and duplicate/conflict decisions.
- Explore source-specific fixtures for Claude, Cursor, and Codex once their documented storage surfaces are stable enough.

## Cross-agent examples

- Claude reads Codex thread summaries and imports durable project learnings into `.ai/memory/`.
- Cursor reads Claude memory/chats and updates `.ai/memory/` plus `.ai/context/` if repo navigation changed.
- Codex reads Cursor chat artifacts and imports decisions, debugging notes, and open items.
- If only one tool is used, that tool reads its own local memory/chat artifacts and updates `.ai/memory/`.

## Design constraints

- Keep this opt-in or clearly visible; do not silently scrape private chats.
- Never treat raw chat logs as canonical memory.
- Do not import secrets, credentials, private user content, or irrelevant conversation.
- Prefer structured import reports over invisible background mutation.
- Keep `.ai/temp/` for scratch import reports and source manifests.
- Keep `.ai/memory/` concise and durable.
- Make tool-specific paths configurable because local storage differs by OS and version.

## Implemented Commands

```bash
ai-memory import init
ai-memory import scan
ai-memory import scan --from claude,codex
ai-memory import request --agent claude --from all
ai-memory import request --agent cursor --from claude,codex
ai-memory import request --agent codex --from cursor
```

## Evaluation ideas

- Fixture-based tests with fake Claude/Cursor/Codex memory exports.
- Verify only durable project facts are imported.
- Verify irrelevant chat content is skipped.
- Verify secrets are redacted or rejected.
- Verify duplicate learnings are not re-imported.
- Verify import reports are written under `.ai/temp/import/`.
- Verify `.ai/memory/` remains the canonical output.

## Open questions

- Which tool-native paths should be supported first?
- How much user confirmation is required before reading local chat histories?
- Should Cursor/Codex transcript imports remain export-only until public local chat storage docs exist?
- Should the import report become part of `ai-memory eval` history?
