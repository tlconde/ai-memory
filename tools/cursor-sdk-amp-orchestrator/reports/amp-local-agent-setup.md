# AMP Local Agent Setup — Wave 16 Report

> **Date:** 2026-05-25
> **Base:** `ralph/amp-projection-local-materialization-clean`
> **Scope:** Offline filesystem wiring for Claude Code and Cursor projection context

---

## Summary

Wave 16 wires already-materialized project projection files into local agent surfaces:

| Target | Mechanism | Write location |
|--------|-----------|----------------|
| Claude Code | Marker block with `@path` imports | `<project>/CLAUDE.md` |
| Cursor | Flattened `.mdc` content | `<project>/.cursor/rules/from-amp/amp-projection.mdc` |

CLI entry point: `ai-memory amp agent setup --target <claude-code|cursor> [--dry-run|--apply]`

---

## Claim labels

| Claim | Label |
|-------|-------|
| Claude Code `@path` imports resolve relative to containing file | **VERIFIED** (Anthropic docs; not re-tested in live session here) |
| AMP marker block merge preserves user content outside markers | **VERIFIED** (unit + E2E tests) |
| Cursor writes stay inside `.cursor/rules/from-amp/` (Invariant 4) | **VERIFIED** (path guard + adapter tests) |
| `.amp/local/` stays out of git status after setup (Invariant 6) | **VERIFIED** (E2E git assertions) |
| Cursor recursive `@` imports for projection paths | **UNKNOWN** — not used; flattened emit instead |
| Live Claude/Cursor session loads wired context at launch | **PROVISIONAL/UNKNOWN** — no live harness automation in acceptance gate |

---

## Undo

- **Claude:** Remove AMP marker block from project `CLAUDE.md`.
- **Cursor:** Delete `.cursor/rules/from-amp/amp-projection.mdc`.

---

## Tests

- `src/amp/agent-setup/` — contracts, Claude, Cursor modules
- `src/amp/cli/agent-setup.test.ts` — CLI dispatch
- `src/amp/cli/doctor.test.ts` — agent-setup findings
- `src/amp/integration/agent-setup-local.test.ts` — full offline E2E
