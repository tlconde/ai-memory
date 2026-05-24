# AMP Vertical Slice Decisions

> **Status:** locked for Task 01 on `ralph/amp-vertical-slice`  
> **Source:** Composer report at `tools/cursor-sdk-amp-orchestrator/reports/direct-composer-vertical-slice.md`  
> **Rule:** these decisions are binding for the first vertical slice unless a failing test proves one wrong.

## Locked Decisions

| ID | Decision | Locked choice | Reason |
|---|---|---|---|
| C1 | Code root | `src/amp/` | Matches current repo build graph: `rootDir: "./src"` and existing Node/TypeScript test runner. Avoids proving a new package layout before AMP itself is proven. |
| C2 | Slice knowledge backend | Minimal in-memory or temp raw-fs backend | The slice needs `write`, `read`, `list`, and `capabilities()`. gbrain MCP is deferred until the substrate contract is proven. |
| C3 | Cursor-style preference ingest | Programmatic API in tests | The vertical slice simulates a Cursor surface without parsing or mutating user-authored `.cursor/rules/`. |
| C4 | Claude Code-style retrieval | Knowledge store read/search API | The E2E proof does not require a live Claude Code session or emitted skill file. Filesystem writes are tested separately through path guards. |
| C5 | Consolidation invocation | Synchronous `consolidateNow()` | Cron/daemon behavior is not required to prove the slice. Tests need deterministic consolidation. |
| C6 | Claude Code `from-amp` base | Project-local test default, adapter accepts `basePath` | Tests use `mkdtemp`; production can target project or user skill roots after verification. |
| C7 | Runtime queue schema | Typed `EpisodicSignal` | Queue items should map directly to frame fields: `content`, `scope`, `projectRef`, `source`, `surface`. |
| C8 | Scope promotion confirmation | Separate confirmation frame | Preserves Invariant 1: scope is never inferred upward; promotion requires explicit provenance. |

## Slice Constraints

- Use the repo's verified Node/TypeScript toolchain; do not introduce Bun-only APIs.
- Runtime paths must be configurable; tests must use isolated temporary paths.
- Adapters are verified-only: Cursor and Claude Code filesystem skeletons first.
- Treat Cursor `.mdc` and Claude Code `SKILL.md` as emitted artifacts from canonical AMP procedural sources.
- Do not implement gbrain MCP, remote MCP, profile slots, propagation cron, Codex/Gemini/Windsurf adapters, or model fine-tuning in the slice.

## External Claim Labels

| Claim | Label | Implementation consequence |
|---|---|---|
| Cursor rules live under `.cursor/rules/` with `.mdc` files | VERIFIED | Cursor adapter skeleton may target this path. |
| Cursor loads `.cursor/rules/from-amp/*.mdc` | PROVISIONAL | Test path guards now; load-test later. |
| Cursor frontmatter fields include `description`, `globs`, `alwaysApply` | VERIFIED | Compiler model can map these fields later. |
| Claude Code loads `SKILL.md` from skills directories | PROVISIONAL | Adapter accepts configurable base path; live load-test later. |
| gbrain MCP is the reference SSA | PROVISIONAL | Defer implementation. |
| Codex/Gemini/Windsurf adapter placement | UNKNOWN | Out of scope. |

## Stop Rule

If any Task 01 implementation proposal contradicts C1-C8, stop and update this decision file before code changes proceed.
