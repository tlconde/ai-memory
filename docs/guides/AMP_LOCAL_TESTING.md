# AMP Local Testing Guide

Operator guide for running AMP safely on a developer machine, including optional live gbrain testing against your real local database.

## Offline first (required)

Run the deterministic acceptance gate before any live testing:

```bash
npm run amp:acceptance
```

**Label:** VERIFIED — gate runs typecheck, build, full test suite, conformance, and CLI smoke without live gbrain or network.

This gate must remain offline. Do not set `AMP_LIVE_GBRAIN=1` or live write confirmation env vars when running acceptance.

## Read-only preflight

Before connecting to live gbrain, run the read-only preflight command:

```bash
ai-memory amp gbrain-preflight
```

Preflight performs read-only **local process probes** (`which`, `gbrain doctor`, `gbrain serve --help`). It does not mutate your gbrain database.

Optional: evaluate a specific backend flag without changing env:

```bash
ai-memory amp gbrain-preflight --knowledge gbrain
```

Preflight checks (read-only):

1. Whether `gbrain` is on PATH and `gbrain serve --help` is available
2. Whether `gbrain doctor` recommends `gbrain init --migrate-only` — **AMP does not run migrations**
3. Whether `AMP_LIVE_GBRAIN=1` would enable live integration tests
4. Current resolved knowledge backend and live write confirmation status
5. Operator summary of safe vs mutating commands

## Back up gbrain before live testing

**Label:** PROVISIONAL — gbrain stores data in a local database; exact backup steps depend on your install and config.

1. Locate your database path:

   ```bash
   gbrain config show
   ```

   **Label:** VERIFIED — `gbrain config show` reports `database_path` (commonly `~/.gbrain/brain.pglite` on macOS).

2. Stop active gbrain processes before copying database files (operator judgment).

3. Copy the database directory to a timestamped backup location, for example:

   ```bash
   cp -a ~/.gbrain ~/.gbrain-backup-$(date +%Y%m%d-%H%M%S)
   ```

   **Label:** PROVISIONAL — copy semantics for PGLite while gbrain is running are not verified here; prefer stopping `gbrain serve` first.

4. **Label:** UNKNOWN — whether `gbrain` provides a first-party backup/export command in your version; use vendor docs if available.

AMP does not perform backups automatically.

## Manual migration (if preflight recommends)

If preflight or `gbrain doctor --json` recommends migration:

```bash
gbrain init --migrate-only
```

**Label:** PROVISIONAL — observed in local spike reports; run manually as the operator. AMP never runs this command.

## Safe backends (no live gbrain)

These paths do not require live write confirmation:

```bash
ai-memory amp capture --content "preference text" --scope project
ai-memory amp consolidate --knowledge in-memory
ai-memory amp consolidate --knowledge fake-gbrain
ai-memory amp retrieve --knowledge in-memory
ai-memory amp retrieve --knowledge fake-gbrain
```

## Live gbrain testing (opt-in, mutates data)

### Live integration test

```bash
AMP_LIVE_GBRAIN=1 npm test -- src/amp/integration/gbrain-live.test.ts
```

**Label:** PROVISIONAL — test writes unique pages under `amp/frames/h.{hex}` and attempts `delete_page` cleanup (soft-delete, ~72h recoverable).

### Live CLI consolidate (writes)

Requires explicit confirmation:

```bash
ai-memory amp consolidate --knowledge gbrain --confirm-live-gbrain-write
# or
AMP_CONFIRM_LIVE_GBRAIN_WRITE=1 ai-memory amp consolidate --knowledge gbrain
```

Deprecated alias: `--live-gbrain` (same as `--confirm-live-gbrain-write`).

### Live CLI retrieve (reads)

```bash
ai-memory amp retrieve --knowledge gbrain
```

**Label:** PROVISIONAL — connects to `gbrain serve` for reads; AMP prints a live-read warning and does not write during retrieve.

## One-shot live capture workflow

Recommended minimal live operator loop:

1. `npm run amp:acceptance`
2. `ai-memory amp gbrain-preflight --knowledge gbrain`
3. Back up gbrain (see above)
4. Run `gbrain init --migrate-only` manually if preflight warns
5. `ai-memory amp init` (project-local AMP config only — does not migrate gbrain)
6. `ai-memory amp capture --content "..." --scope project`
7. `ai-memory amp consolidate --knowledge gbrain --confirm-live-gbrain-write`
8. `ai-memory amp retrieve --knowledge gbrain --query "..."`

## Legacy AMP slug encoding

**Label:** VERIFIED — new AMP writes use `amp/frames/h.{hex}` slugs only.

**Label:** VERIFIED — no migration is provided for legacy base64url AMP slugs. Old pages remain at their original slugs; operators must reconcile manually if needed.

## Rollback

If live testing leaves unwanted pages:

1. Check for residual slugs: `amp/frames/h.*` prefix in gbrain
2. **Label:** PROVISIONAL — `gbrain call delete_page '{"slug":"..."}'` or vendor UI; soft-delete may leave recoverable pages for ~72h
3. Restore from backup if needed (operator-specific restore procedure)

See also:
- `tools/cursor-sdk-amp-orchestrator/reports/amp-real-gbrain-safety.md`
- `tools/cursor-sdk-amp-orchestrator/reports/amp-real-gbrain-policy-unified.md`
- `tools/cursor-sdk-amp-orchestrator/reports/amp-claude-projection-setup.md` — Claude Code `@import` wiring design (report-only; not in acceptance gate)
