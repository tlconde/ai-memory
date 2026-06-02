# TODO: Reevaluate Hooks and Cross-Agent Memory Import

## Why this exists

The current ai-memory hooks were designed around a simpler assumption: remind the active agent to run memory capture at lifecycle boundaries. That is useful, but it is not the full shape we want.

AMP introduced a better flow: read existing tool-native memory or chat artifacts, distill durable project learnings, and bring those learnings into the canonical memory store. For original ai-memory, the equivalent should stay simple and filesystem-first:

- `.ai/memory/` remains canonical project memory.
- Tool-native memories and chats are source material, not canonical truth.
- A coding agent performs the import/distillation pass.
- The hook should trigger or request that pass instead of relying on the user to remember.

## Current hook limitations

- Claude hooks currently preserve session state and ask the model to reconcile memory at Stop/PostCompact.
- Cursor support is currently rules/skills only in this branch; Cursor hooks need a separate implementation pass.
- Codex and other IDEs currently rely on generic instructions, not lifecycle hooks.
- Existing hooks do not read tool-native chat histories or memory files.
- Existing hooks do not coordinate cross-tool imports, such as Claude reading Codex chats or Cursor reading Claude memory.
- Existing hooks do not clearly distinguish:
  - session summary
  - durable project learning
  - user preference
  - transient conversation context
  - repo navigation context

## Desired future flow

Create a small agent-driven import workflow:

1. Detect available tool-native sources:
   - Claude memory/chats
   - Cursor chats/checkpoints/hooks payloads
   - Codex thread summaries/chats
   - other IDE or agent artifacts when configured
2. Ask an available coding agent to read those sources.
3. Distill only project-relevant, durable learnings.
4. Write canonical entries to `.ai/memory/` using `commit_memory` when MCP is available.
5. Update `.ai/PROJECT_STATUS.md`, `.ai/sessions/open-items.md`, and `.ai/context/` only when relevant.
6. Record what was imported, skipped, and why.

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

## Possible commands

```bash
ai-memory import scan
ai-memory import from claude
ai-memory import from cursor
ai-memory import from codex
ai-memory import from all --dry-run
ai-memory import from all --apply
```

## Possible hook direction

Hooks should eventually trigger a lightweight import request rather than trying to do everything inline.

Examples:

- Claude Stop hook: ask Claude to run an import pass over configured Codex/Cursor sources before final memory capture.
- Cursor stop hook: ask Cursor Agent to import from Claude/Codex sources, then update `.ai/memory/`.
- Codex session-close hook or automation: ask Codex to import from Cursor/Claude artifacts and summarize what changed.

## Evaluation ideas

- Fixture-based tests with fake Claude/Cursor/Codex chat files.
- Verify only durable project facts are imported.
- Verify irrelevant chat content is skipped.
- Verify secrets are redacted or rejected.
- Verify duplicate learnings are not re-imported.
- Verify import reports are written under `.ai/temp/import/`.
- Verify `.ai/memory/` remains the canonical output.

## Open questions

- Which tool-native paths should be supported first?
- Should imports be command-only, hook-triggered, or both?
- How much user confirmation is required before reading local chat histories?
- Should cross-agent import be installed by default or enabled with an explicit capability flag?
- What is the smallest useful Cursor hook implementation for this flow?
