# AMP Codex Agent Setup — Manual Live Test Protocol

> **Date:** 2026-05-25
> **Branch:** `ralph/amp-agent-setup-codex`
> **Prerequisite:** Codex CLI installed (`codex --version`), authenticated session

---

## Claim labels (honest)

| Claim | Label |
|-------|-------|
| Codex loads project `AGENTS.md` content at session start | **VERIFIED (manual, 2026-05-25)** — operator-inlined AGENTS.md; Codex quoted runtime sentinels |
| Manual inline of `.amp/local/*.md` into AGENTS.md works | **VERIFIED (manual)** — same session as above |
| `amp agent setup --target codex --apply` writes correct marker block | **VERIFIED (offline unit/E2E tests)** — not yet live-gated in acceptance |
| Live Codex session loads content from **automated** AMP setup | **PROVISIONAL** until sentinel protocol below passes |
| Codex `@import` / `@path` in AGENTS.md | **UNKNOWN** — not used by AMP; not tested |
| Codex reads AGENTS.md from parent dirs when cwd is nested | **UNKNOWN** |

---

## Prior manual result (baseline)

Temp git project with materialized `.amp/local/` and operator-authored `AGENTS.md` containing inlined projection/runtime sections.

Probe:

> Without reading files manually, do you have any project rule or context mentioning AMP_SENTINEL_CODEX_CONTEXT_20260525?

Expected when sentinel **not** captured: Codex denies CODEX sentinel but cites Cursor/Claude sentinels from AGENTS.md runtime — **observed VERIFIED**.

---

## Protocol: automated setup + sentinel

### 1. Prepare isolated project

```bash
TMP=$(mktemp -d)
cd "$TMP"
git init
export AMP_USER_ROOT="$(mktemp -d)"
export AMP_KNOWLEDGE_BACKEND=in-memory

ai-memory amp init
# capture/consolidate or seed knowledge as needed for your test
ai-memory amp projection render --source local --apply
```

### 2. Capture a Codex-specific runtime sentinel

Use capture with a unique string, e.g. `AMP_SENTINEL_CODEX_SETUP_CLI_20260525`, then re-render projection:

```bash
ai-memory amp capture --note "AMP_SENTINEL_CODEX_SETUP_CLI_20260525"
ai-memory amp projection render --source local --apply
```

### 3. Dry-run then apply Codex setup

```bash
ai-memory amp agent setup --target codex --dry-run
ai-memory amp agent setup --target codex --apply
```

Verify `AGENTS.md` contains marker delimiters and the sentinel in the runtime section.

### 4. Doctor check

```bash
ai-memory amp doctor
```

Expect ok finding: `AGENTS.md contains an AMP marker block with inlined projection context.`

### 5. Live Codex probe

Open Codex **with project root = `$TMP`** (important: workspace must be the temp project):

```bash
cd "$TMP"
codex
```

Prompt:

> Without reading files manually, quote the exact string AMP_SENTINEL_CODEX_SETUP_CLI_20260525 and say which document section it came from.

| Outcome | Label |
|---------|-------|
| Quotes sentinel + cites AGENTS.md / AMP Project Runtime | Upgrade automated setup to **VERIFIED** |
| Partial / paraphrase only | **PROVISIONAL** |
| No sentinel | **UNKNOWN** — check workspace root, projection apply, marker block |

### 6. Negative control

Ask about a sentinel never captured (e.g. `AMP_SENTINEL_CODEX_CONTEXT_20260525` if absent). Codex should deny — confirms load without hallucination.

---

## Cleanup

```bash
rm -rf "$TMP" "$AMP_USER_ROOT"
```

Do not commit temp project `AGENTS.md` into the ai-memory repo.

---

## Related reports

- `amp-local-agent-live-verification.md` — Wave 16 live harness matrix (§10 Codex manual path)
- `amp-codex-agent-setup-spike.md` — contract/spike (local docs only)
- `amp-local-agent-setup.md` — Wave 16 offline agent setup summary (update target list when merged)
