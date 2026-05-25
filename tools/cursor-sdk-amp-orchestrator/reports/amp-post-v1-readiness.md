# AMP Post-v1 Live Verification — Merge / Package Readiness

> **Date:** 2026-05-25  
> **Approved integration branch:** `ralph/amp-live-verification-integrated` @ `1b26ab9`  
> **Offline v1 base:** `ralph/amp-v1-v1-31` @ `75cc4c5`  
> **Scope:** Report-only readiness record for Codex final signoff. No acceptance-gate or source changes implied.

---

## 1. Approved integration state

| Item | Value |
|---|---|
| Branch | `ralph/amp-live-verification-integrated` |
| Commit | `1b26ab9e6e0efe4c6b5fd7785cdfe7c547452fee` |
| Merge tip message | `merge: amp v1 live-03 post-v1 docs` |
| Integration merges | live-04 (FF) → live-01-fix-codec → live-02-fix-hermes-module → live-03 |
| Conflicts at integration | None |

Supporting spike/audit reports on this branch:

| Report | Purpose |
|---|---|
| `amp-acceptance-offline-audit.md` | Offline gate has no live-service assumptions |
| `amp-gbrain-live.md` | Opt-in live gbrain MCP round trip |
| `amp-hermes-live.md` | Hermes `external_dirs` doctor + manual `hermes -s` steps |

---

## 2. Offline acceptance status

**Label:** **VERIFIED** — `npm run amp:acceptance` passes on `1b26ab9` (exit 0).

| Step | Result |
|---|---|
| typecheck | PASS |
| build | PASS |
| test | PASS (279 tests; live gbrain suite skipped by default) |
| conformance | PASS |
| CLI smoke (`amp --help`, `status`, `init`, `doctor`) | PASS |

**Invariant policy:** INV-1, INV-2, INV-4, INV-5 pass. **INV-3 deferred only** (cloud vendor memory — out of v1 scope).

Live gbrain, live Hermes sessions, Cursor/Claude harness session load, and network access are **explicitly excluded** from the gate (`AMP_V1_PROVISIONAL_DISCLAIMER` in `src/amp/conformance/acceptance-gate.ts`).

---

## 3. Live verification status (separate from acceptance)

### gbrain MCP (opt-in)

| Item | Label | Notes |
|---|---|---|
| Test file | — | `src/amp/integration/gbrain-live.test.ts` |
| Enable | — | `AMP_LIVE_GBRAIN=1` (skipped by default) |
| write / read / list / search (live) | **VERIFIED** | Passed in worker environment after fix chain (gbrain 0.40.2.0); see `amp-gbrain-live.md` |
| delete (`delete_page` cleanup) | **PROVISIONAL** | Soft-delete only; post-delete read errors rather than empty |
| In acceptance gate | **N/A** | Not gated — opt-in only |

### Hermes doctor (read-only)

| Item | Label | Notes |
|---|---|---|
| `skills.external_dirs` read/check | **VERIFIED** | Fixture-isolated tests in `src/amp/cli/doctor.test.ts`; module `src/amp/cli/checks/hermes-discovery.ts` |
| Live `hermes -s` session preload | **PROVISIONAL/UNKNOWN** | Manual steps in `amp-hermes-live.md`; not automated |

### Harness session loading

| Surface | Label |
|---|---|
| Cursor rule picker / live rule load | **PROVISIONAL/UNKNOWN** |
| Claude Code skill discovery in session | **PROVISIONAL/UNKNOWN** |
| Hermes `hermes -s` preload | **PROVISIONAL/UNKNOWN** |

Filesystem emit to `from-amp/` roots remains **VERIFIED** offline (INV-4, propagation E2E).

---

## 4. Merge recommendation

**Recommend merge of `ralph/amp-live-verification-integrated` into the AMP v1 integration line** (operator chooses target branch — e.g. `ralph/amp-v1-v1-31` successor or mainline policy branch).

Rationale:

- Offline acceptance green; no live checks added to the gate.
- Post-v1 live wave deliverables integrated without conflicts.
- Thermo-nuclear fix chains (slug contract, homedir determinism, codec centralization, Hermes module extraction) included via fix-branch tips.
- Docs separate offline acceptance from live verification.

**Not in scope for this merge:** cloud vendor memory (INV-3), Codex/Gemini/Windsurf adapters, live harness session automation.

---

## 5. Publish / package recommendation (separate from merge)

Merge readiness **does not** imply npm publish or external package release.

| Action | Recommendation |
|---|---|
| **Merge integration branch** | Ready when Codex signs off |
| **npm publish / version bump** | **No recommendation** — out of post-v1 live verification scope; operator decides separately |
| **Operator docs** | Point implementers at `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md` for gate policy and this report for merge readiness |

If a package is published later, live verification remains opt-in and must not be wired into default CI acceptance.

---

## 6. Residual risks and operator follow-up

1. **gbrain migration warnings** — `gbrain serve` may print schema probe/migrate failures. Run `gbrain init --migrate-only` if warnings persist before trusting doctor or live tests. **Label:** PROVISIONAL (environment-specific).

2. **Opt-in live test mutates local gbrain** — `AMP_LIVE_GBRAIN=1 npm test -- src/amp/integration/gbrain-live.test.ts` writes probe pages under `amp/frames/h.*` and attempts soft-delete cleanup. Do not run in shared CI without operator consent.

3. **No legacy slug migration** — Slug encoding is locked to `amp/frames/h.{hex}`. Pre-change base64url pages are **not migrated**; they remain at old slugs only. **Label:** documented intentional version bump.

4. **Hermes path matching** — Doctor normalizes trailing slashes; symlinked `external_dirs` paths are not canonicalized.

5. **Transactions** — gbrain transactions remain unsupported; partial writes can orphan pages.

---

## 7. Codex final review verification commands

Run from repo root at `1b26ab9`:

```bash
npm run typecheck
npm run build
npm test
npm run amp:acceptance
```

**Results (2026-05-25, integration branch):**

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS — 279 tests, 0 failures |
| `npm run amp:acceptance` | PASS — exit 0 |

**Stale-claim sweep:**

```bash
rg -n "live gbrain.*VERIFIED|hermes -s.*VERIFIED|Codex.*verified|Gemini.*verified|V1-31 active|docs active" \
  docs/ tools/cursor-sdk-amp-orchestrator/reports/amp-*.md
```

**Result:** No false-positive live VERIFIED claims in `amp-*.md` reports. Doc matches for Codex/Gemini are appropriately scoped (“out of v1 verified scope”, “placement unverified”, OpenAI docs reference).

**Optional (operator-only, mutates local gbrain):**

```bash
AMP_LIVE_GBRAIN=1 npm test -- src/amp/integration/gbrain-live.test.ts
```

Not required for merge signoff.

---

## Ready for Codex final signoff

**Yes** — integration branch is merge-ready; offline acceptance deterministic; live verification opt-in and labeled; no push performed by this report.
