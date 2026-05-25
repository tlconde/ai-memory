# AMP v1 Acceptance Report

> **Status:** recorded at V1-30 acceptance gate
> **Gate commit:** `82962bf` (`test(amp): add v1 acceptance gate`)
> **Branch:** `ralph/amp-v1-v1-31`
> **Proof command:** `npm run amp:acceptance`
> **Implementation:** `src/amp/conformance/acceptance-gate.ts`

---

## Purpose

This document records what the v1 acceptance gate proves **offline** — deterministically, without live gbrain, Hermes, Cursor, Claude Code sessions, or network access. It is factual status, not a roadmap.

Re-run the gate after substantive AMP changes:

```bash
npm run amp:acceptance
```

Exit code `0` means acceptance pass; `1` means fail.

---

## Gate steps

The gate runs steps in order and stops early if typecheck, build, or test fails.

| Step | Command / check | Pass criterion |
|---|---|---|
| 1 | `npm run typecheck` | Exit 0 |
| 2 | `npm run build` | Exit 0 |
| 3 | `npm run test` | Full suite pass |
| 4 | Conformance runner | INV-1, INV-2, INV-4, INV-5 pass; **INV-3 deferral only** |
| 5 | `amp --help` | Exit 0; output contains "Agent Memory Protocol" |
| 6 | `amp status` | Exit 0; output matches `AMP CLI shell v` |
| 7 | `amp init --project-root <temp>` | Exit 0; output mentions config |
| 8 | `amp doctor --project-root <temp>` | Exit 0 |

Conformance step detail: if any invariant other than INV-3 is deferred or failing, acceptance fails even when the conformance runner reports overall pass.

---

## Conformance mapping (at gate)

| Invariant | Description | Status | Test files |
|---|---|---|---|
| INV-1 | Scope never inferred upward | PASS | `src/amp/core/scope-gate.test.ts` |
| INV-2 | Injectability honest (capability coverage) | PASS | `src/amp/adapter-contract/capability-coverage.test.ts`, `src/amp/conformance/gbrain-capability-honesty.test.ts` |
| INV-3 | Cloud-bound vendor memory bounded | **DEFERRED** | No automated tests (vertical slice) |
| INV-4 | `from-amp/` isolation | PASS | `src/amp/path-safety/guard.test.ts`, Cursor/Claude Code adapter tests |
| INV-5 | Falsifiable claims | PASS | `src/amp/core/frame-schema.test.ts`, `src/amp/integration/preference-vertical-slice.test.ts` |

Registry source: `src/amp/conformance/invariant-registry.ts`.

---

## Verified behaviors (offline)

These behaviors are exercised by the acceptance gate and its underlying test suite:

- **Wire protocol:** frame schema validation, scope gate, JSON-RPC-style errors
- **Runtime store:** SQLite queue FIFO, configurable isolated paths in tests
- **Knowledge backends:** in-memory store; gbrain adapter via `FakeGbrainMcpTransport`
- **Preference vertical slice:** capture → runtime queue → consolidate → retrieve (in-memory)
- **gbrain-backed slice:** capture → runtime → `consolidateToGbrain` → harness-style read (fake transport)
- **Procedure propagation:** canonical registry → Cursor, Claude Code, Hermes `from-amp` emit with path guards and readback
- **Capability honesty:** gbrain SSA declares unsupported features (transactions, profile_slots, graph_traversal, etc.)
- **CLI commands:** `amp init`, `doctor`, `capture`, `consolidate`, `retrieve`, `propagate`, `status` — full command coverage in unit tests; acceptance gate smoke-tests `init`/`doctor` only after conformance pass

Hermes filesystem adapter is in verified offline scope (same acceptance-gated path guards and propagation E2E as Cursor and Claude Code).

---

## PROVISIONAL / UNKNOWN exclusions

Not part of v1 acceptance (from `AMP_V1_PROVISIONAL_DISCLAIMER` in `acceptance-gate.ts`):

```
PROVISIONAL/UNKNOWN (not part of v1 acceptance):
  - live gbrain serve / cloud vendor memory (INV-3 deferred in vertical slice)
  - live harness session checks (Cursor rule picker, Claude skill discovery, hermes -s)
```

Additional out-of-scope items (not blocking acceptance):

| Item | Label | Notes |
|---|---|---|
| Codex, Gemini, Windsurf adapters | OUT OF v1 verified scope | No SAS files; placement unverified |
| Live `gbrain serve` MCP | PROVISIONAL | Default CLI backend (`gbrain`); use `fake-gbrain` or `in-memory` for offline proof |
| gbrain search/read/delete MCP claims | PROVISIONAL | Listed in `ssa-files/gbrain.yaml` external_claims |
| Profile slots | unsupported | gbrain SSA declares `profile_slots: unsupported` |
| Remote MCP (Shape B), briefing CLI | Not started | Spec-defined; no acceptance tests |
| Propagation / consolidation daemon crons | Partial | Synchronous `consolidateNow` / `propagateProcedures` verified; scheduled daemon not acceptance-gated |

---

## Residual risks

1. **Orphan pages on gbrain writes:** gbrain v1 declares `transactions: unsupported`. Multi-page consolidation without atomic commit can leave partial writes. Mitigation: idempotent retry; operator reconciliation via list/search and `amp doctor`.

2. **Live gbrain drift:** Acceptance uses fake transport. Live `gbrain serve` behavior (schema migrations, MCP tool semantics) may diverge from CI fixtures.

3. **Harness load semantics:** Filesystem emit to `from-amp/` is verified; whether Cursor, Claude Code, or Hermes actually load emitted artifacts in a live session is PROVISIONAL/UNKNOWN.

4. **INV-3 deferral:** Cloud vendor memory paths are untested. Acceptance explicitly allows only this deferral; adding other deferred invariants without updating the gate policy would be non-compliant.

5. **Default CLI backend:** `AMP_KNOWLEDGE_BACKEND` defaults to live `gbrain`. Operators running consolidate/retrieve without overriding backend hit live transport — outside acceptance proof.

---

## Sample passing output (82962bf)

```
=== AMP v1 Acceptance Gate ===
...
PASS typecheck
PASS build
PASS test
PASS conformance
PASS cli: amp --help
PASS cli: amp status
PASS cli: amp init
PASS cli: amp doctor
...
DEFERRED INV-3: Deferred in vertical slice — cloud surfaces out of scope
Overall: PASS
=== AMP v1 ACCEPTANCE: PASS ===
```

---

## Related documents

- `docs/specs/AMP_CONSOLIDATED_SPEC.md` — §0.1 v1 implementation status; §6.3 transactions; §9.8 verified adapter scope
- `docs/guides/CURSOR_IMPLEMENTATION_GUIDE.md` — implementation status table, CLI backend defaults
- `src/amp/conformance/acceptance-gate.ts` — gate implementation and policy
- `src/amp/conformance/invariant-registry.ts` — invariant → test mapping

---

*Recorded May 2026 for AMP v1 vertical slice.*
