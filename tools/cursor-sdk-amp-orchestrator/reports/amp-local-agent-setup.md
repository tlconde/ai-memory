# AMP Local Agent Setup — Wave 16 Report

> **Date:** 2026-05-25
> **Base:** `ralph/amp-projection-local-materialization-clean`
> **Scope:** Offline filesystem wiring and live session load for Claude Code, Cursor, and Codex projection context

---

## Summary

Wave 16 wires already-materialized project projection files into local agent surfaces:

| Target | Mechanism | Write location |
|--------|-----------|----------------|
| Claude Code | Marker block with `@path` imports | `<project>/CLAUDE.md` |
| Cursor | Flattened `.mdc` content | `<project>/.cursor/rules/from-amp/amp-projection.mdc` |
| Codex | Marker block with inlined bodies | `<project>/AGENTS.md` |

CLI entry point: `amp agent setup --target <claude-code|cursor|codex> [--dry-run|--apply]`

Compatibility: `ai-memory amp agent setup …` when invoked via the `ai-memory` binary.

---

## Claim labels

| Claim | Label |
|-------|-------|
| Claude Code `@path` imports resolve relative to containing file | **VERIFIED** (Anthropic docs + live session load via AMP setup) |
| Claude Code project context loading via AMP setup | **VERIFIED** | See `amp-local-agent-live-verification.md` |
| AMP marker block merge preserves user content outside markers | **VERIFIED** (unit + E2E tests) |
| Cursor writes stay inside `.cursor/rules/from-amp/` (Invariant 4) | **VERIFIED** (path guard + adapter tests) |
| Cursor project context loading via flattened `.mdc` | **VERIFIED** | See `amp-local-agent-live-verification.md` |
| Codex project context loading via `AGENTS.md` marker block | **VERIFIED** | See `amp-codex-agent-setup-live.md` |
| `.amp/local/` stays out of git status after setup (Invariant 6) | **VERIFIED** (E2E git assertions) |
| Cursor recursive `@` imports for projection paths | **UNKNOWN / not used** — flattened emit instead |
| Codex `@import` in `AGENTS.md` | **UNKNOWN / not used** — inlined bodies in marker block |
| Live gbrain / Hermes session loading | **PROVISIONAL** (opt-in) — separate from agent-setup scope |
| Offline acceptance gate requires live harness sessions | **VERIFIED absent** — gate stays offline |

---

## Undo

- **Claude:** Remove AMP marker block from project `CLAUDE.md`.
- **Cursor:** Delete `.cursor/rules/from-amp/amp-projection.mdc`.
- **Codex:** Remove AMP marker block from project `AGENTS.md`.

---

## Tests

- `src/amp/agent-setup/` — contracts, Claude, Cursor, Codex modules
- `src/amp/cli/agent-setup.test.ts` — CLI dispatch
- `src/amp/cli/doctor.test.ts` — agent-setup findings
- `src/amp/integration/agent-setup-local.test.ts` — full offline E2E
