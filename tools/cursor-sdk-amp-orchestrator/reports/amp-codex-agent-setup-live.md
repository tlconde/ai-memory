# AMP Codex Agent Setup — Live Verification Report

> **Date:** 2026-05-25
> **Branch:** `ralph/amp-agent-setup-codex`
> **Prerequisite:** Codex CLI installed (`codex --version`), authenticated session

---

## Claim labels

| Claim | Label |
|-------|-------|
| Codex loads project `AGENTS.md` content at session start | **VERIFIED** |
| Codex AGENTS.md marker-block setup (`amp agent setup --target codex`) | **VERIFIED** |
| Live load from automated `amp agent setup --target codex` | **VERIFIED** |
| `amp agent setup --target codex --apply` writes correct marker block | **VERIFIED** (offline unit/E2E tests + live session) |
| Codex `@import` / `@path` in AGENTS.md | **UNKNOWN** — not used by AMP; not tested |
| Codex reads AGENTS.md from parent dirs when cwd is nested | **UNKNOWN** |
| Invalid cached schedule `SKILL.md` warning at Codex startup | **Unrelated** — plugin cache parse error; does not affect AGENTS.md loading |

---

## Live verification result (2026-05-25)

| Field | Value |
|-------|-------|
| Project root | `/private/var/folders/c2/w06jh9q541xc30bzn45j0f_h0000gn/T/tmp.ZptMNpNdVw` |
| Codex version | v0.133.0 |
| Session cwd | Temp project root (same path as above) |
| Setup path | Automated `amp agent setup --target codex --apply` (marker block in `AGENTS.md`) |

### AGENTS.md contents (observed)

- `<!-- amp:agent-setup:codex:v1:start -->`
- `AMP_SENTINEL_CODEX_CONTEXT_20260525`
- `<!-- amp:agent-setup:codex:v1:end -->`

Sentinel appeared under the AMP Project Runtime section (runtime projection body included `episodic_signal` context).

### Probe prompt

> Without reading files manually, do you have any project rule or context mentioning AMP_SENTINEL_CODEX_CONTEXT_20260525?

### Observed response

Codex answered **yes**, quoted the exact string `AMP_SENTINEL_CODEX_CONTEXT_20260525`, and attributed it to **`AGENTS.md`** under **AMP Project Runtime / episodic_signal**.

**Verdict:** Live load from automated AMP Codex agent setup is **VERIFIED**.

### Unrelated startup noise

Codex reported skipping one invalid cached skill:

```
⚠ ~/.codex/plugins/cache/.../schedule/SKILL.md: invalid YAML
```

This is a plugin-cache parse warning and is **unrelated** to project `AGENTS.md` loading or the AMP marker block.

---

## Protocol (for re-testing)

### 1. Prepare isolated project

```bash
TMP=$(mktemp -d)
cd "$TMP"
git init
export AMP_USER_ROOT="$(mktemp -d)"
export AMP_KNOWLEDGE_BACKEND=in-memory

amp init
# capture/consolidate or seed knowledge as needed for your test
amp projection render --source local --apply
```

### 2. Capture a Codex-specific runtime sentinel

Use capture with a unique string, e.g. `AMP_SENTINEL_CODEX_CONTEXT_20260525`, then re-render projection:

```bash
amp capture --note "AMP_SENTINEL_CODEX_CONTEXT_20260525"
amp projection render --source local --apply
```

### 3. Dry-run then apply Codex setup

```bash
amp agent setup --target codex --dry-run
amp agent setup --target codex --apply
```

Verify `AGENTS.md` contains marker delimiters and the sentinel in the runtime section.

### 4. Doctor check

```bash
amp doctor
```

Expect ok finding: `AGENTS.md contains an AMP marker block with inlined projection context.`

### 5. Live Codex probe

Open Codex **with project root = temp project** (cwd must be the project root):

```bash
cd "$TMP"
codex
```

Prompt:

> Without reading files manually, do you have any project rule or context mentioning AMP_SENTINEL_CODEX_CONTEXT_20260525?

| Outcome | Label |
|---------|-------|
| Quotes sentinel + cites AGENTS.md / AMP Project Runtime | **VERIFIED** (observed 2026-05-25) |
| Partial / paraphrase only | **PROVISIONAL** |
| No sentinel | **UNKNOWN** — check workspace root, projection apply, marker block |

### 6. Negative control

Ask about a sentinel never captured in the project. Codex should deny — confirms load without hallucination.

---

## Cleanup

```bash
rm -rf "$TMP" "$AMP_USER_ROOT"
```

Do not commit temp project `AGENTS.md` into the ai-memory repo.

---

## Related reports

- `amp-local-agent-live-verification.md` — Wave 16 live harness matrix
- `amp-codex-agent-setup-spike.md` — contract/spike (local docs only)
- `amp-local-agent-setup.md` — Wave 16 offline agent setup summary
