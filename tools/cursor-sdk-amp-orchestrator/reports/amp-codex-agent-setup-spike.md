# AMP Codex Agent Setup — Spike / Contract Report

> **Date:** 2026-05-25
> **Base:** `ralph/amp-agent-access-clean`
> **Scope:** Local docs/code review only — no `@import` claims without verification

---

## Question

What should `amp agent setup --target codex` write, and how does Codex load project instructions?

---

## Local sources reviewed

| Source | Finding |
|--------|---------|
| `docs/specs/AMP_CONSOLIDATED_SPEC.md` §9.4 | Codex procedural placement hypothesized as `<base>/from-amp/SKILL_NAME/SKILL.md` — **PROVISIONAL** for skills, not project projection |
| `docs/specs/AMP_CONSOLIDATED_SPEC.md` §9.8 | Codex SAS adapter **out of v1 verified scope** — placement/load **UNKNOWN** for acceptance gate |
| `src/amp/agent-setup/cursor.ts` | Cursor uses **flattened inline** projection/runtime bodies (no `@` imports) — proven pattern in repo |
| `src/amp/agent-setup/claude-code.ts` | Claude uses `@.amp/local/*.md` imports — **VERIFIED** for Claude Code only (separate live report) |
| Prior live session (manual operator path, temp project) | Codex cited **AGENTS.md** runtime section and quoted Cursor/Claude sentinels — **VERIFIED (manual)** |
| Codex CLI `--help` | Documents exec/review/skills/MCP; **does not** document `@path` imports in AGENTS.md from local help text |

---

## Contract decision

| Decision | Rationale | Label |
|----------|-----------|-------|
| Target file: `<project>/AGENTS.md` | Matches manual live verification path | **VERIFIED (manual live report)** |
| Inline `.amp/local/projection.md` + `runtime.md` bodies | Same flattening strategy as Cursor; avoids unverified `@import` | **PROVISIONAL** (design choice; aligns with manual test) |
| AMP marker block `<!-- amp:agent-setup:codex:v1:start/end -->` | Preserves user content outside block; idempotent upsert | **VERIFIED** (unit tests) |
| Require materialized projection files on `--apply` | Same strictness as Cursor (`requireFiles: true`) | **VERIFIED** (preflight tests) |
| Do **not** emit `.agents/skills/` in this wave | Skills propagation is separate (`amp propagate`); out of agent-setup scope | **VERIFIED** (scope boundary) |

---

## Explicit non-claims

- **UNKNOWN:** Whether Codex resolves `@path` or `@AGENTS.md`-style imports inside `AGENTS.md`.
- **UNKNOWN:** Whether Codex walks parent directories for `AGENTS.md` when cwd is a subdirectory (not tested here).
- **UNKNOWN:** Whether AMP marker HTML comments affect Codex parsing (assumed inert like Claude Code markers).
- **PROVISIONAL:** Automated `amp agent setup --target codex` live loading until sentinel protocol in live report passes.

---

## Implementation mapping

```
amp agent setup --target codex [--apply]
  → read .amp/local/projection.md + runtime.md
  → upsert marker block in AGENTS.md with:
       ## AMP Project Projection
       <projection body>
       ## AMP Project Runtime
       <runtime body>
  → dry-run: plan only; apply: write file
```

Doctor (read-only): warn when `AGENTS.md` missing marker; error on malformed marker; ok when marker present with inlined context.

---

## Undo

Remove the AMP Codex marker block from project `AGENTS.md`, or delete `AGENTS.md` if AMP created it and no other user content remains.
