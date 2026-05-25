# AMP Hermes Live Verification (V1-LIVE-02)

> **Date:** 2026-05-25  
> **Task:** V1-LIVE-02 — Hermes `skills.external_dirs` discovery check in `amp doctor`  
> **Scope:** Read-only config inspection + optional manual `hermes -s` session load

## Automated check (VERIFIED)

`amp doctor` now reads Hermes config (default `~/.hermes/config.yaml`) and verifies that the project skills root (`<projectRoot>/skills/`) is listed in `skills.external_dirs`. Hermes recursively discovers nested `skills/from-amp/<name>/SKILL.md` files when the parent `skills/` directory is registered.

Fixture-isolated tests cover:

- missing `external_dirs` entry → `WARN [hermes-discovery]`
- configured project `skills/` root → `OK [hermes-discovery]`
- `HERMES_CONFIG_PATH` env override for opt-in fixture/live paths

**Label:** VERIFIED — external_dirs read/check exercised via temp HOME/config fixtures in `src/amp/cli/doctor.test.ts`.

## Opt-in env overrides

| Variable | Purpose |
|---|---|
| `HERMES_CONFIG_PATH` | Absolute path to Hermes `config.yaml` for doctor checks (does not mutate config) |

Example fixture run (no writes to real `~/.hermes/`):

```bash
export HERMES_CONFIG_PATH=/tmp/hermes-fixture/config.yaml
amp doctor --project-root /path/to/project
```

Tests pass an isolated `homedir` callback instead of touching the operator home directory.

## Manual live verification (`hermes -s`)

**Label:** PROVISIONAL/UNKNOWN — not executed as part of V1-LIVE-02 automation.

When validating end-to-end skill preload in a real Hermes install:

1. Ensure project config passes doctor:

   ```bash
   amp doctor --project-root .
   ```

   Expect `OK [hermes-discovery] Project skills root skills/ is listed in Hermes skills.external_dirs (...)`.

2. If doctor warns, add the project skills root to Hermes config (operator-owned file):

   ```yaml
   skills:
     external_dirs:
       - /absolute/path/to/<projectRoot>/skills
   ```

3. Propagate or write a fixture skill under `skills/from-amp/<skill-name>/SKILL.md`.

4. Confirm Hermes indexes the skill:

   ```bash
   hermes skills list | rg '<skill-name>'
   ```

5. Preload for a session:

   ```bash
   hermes -s <skill-name> -z "Summarize what this skill does."
   ```

6. Record transcript/tool evidence that the emitted `SKILL.md` body is visible to the session.

## Residual risks

- Doctor checks config file presence and path listing only; it does not invoke `hermes` or validate live chat preload.
- Hermes bundled skills under `~/.hermes/skills/` can mask naming collisions without listing project skills.
- Relative vs absolute `external_dirs` entries are normalized with `path.resolve`; symlinked roots are not canonicalized.
- Auto-discovery without `external_dirs` remains PROVISIONAL per `sas-files/hermes.yaml`.

## Related docs

- Spike: `tools/cursor-sdk-amp-orchestrator/reports/amp-hermes-spike.md`
- SAS claims: `sas-files/hermes.yaml`
