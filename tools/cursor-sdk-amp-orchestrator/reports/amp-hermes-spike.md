# AMP Hermes Placement Spike (V1-12)

> **Date:** 2026-05-25  
> **Environment:** macOS, Hermes Agent v0.14.0 (2026.5.16), repo `/Users/dev/Dev/Github/ai-memory`  
> **Scope:** Verify Hermes local skill/rule paths, load behavior, and safe AMP write target. No Hermes adapter implementation in this task.

## Decision

**Hermes SAS v1 should treat project-local `skills/from-amp/<skill-name>/SKILL.md` as the AMP-managed write root**, with the project’s parent `skills/` directory registered in Hermes `skills.external_dirs` (or project-local equivalent) for discovery.

**Do not write into `~/.hermes/hermes-agent/skills/` (bundled install tree) or other user-authored skill trees without an explicit `from-amp/` subdirectory.**

## Evidence

### 1. Hermes install and home layout

```bash
$ which hermes
/Users/dev/.local/bin/hermes

$ hermes version
Hermes Agent v0.14.0 (2026.5.16)
Project: /Users/dev/.hermes/hermes-agent
```

```bash
$ hermes config | rg 'Config:|Install:'
  Config:       /Users/dev/.hermes/config.yaml
  Install:      /Users/dev/.hermes/hermes-agent
```

**Label:** VERIFIED — Hermes uses `~/.hermes/` as home and a separate install tree under `~/.hermes/hermes-agent/`.

### 2. Skill discovery roots (source inspection)

Files inspected:

- `/Users/dev/.hermes/hermes-agent/hermes_constants.py` — `get_skills_dir()` → `~/.hermes/skills`
- `/Users/dev/.hermes/hermes-agent/agent/skill_utils.py` — `get_all_skills_dirs()` returns local dir first, then `skills.external_dirs`
- `/Users/dev/.hermes/hermes-agent/agent/skill_utils.py` — `iter_skill_index_files()` recursively walks directories for `SKILL.md`, excluding `.git`, `.github`, `.hub`, `.archive`

**Label:** VERIFIED — Hermes discovers skills by recursive `SKILL.md` scan under:

1. `~/.hermes/skills/` (always first)
2. Each existing directory in `skills.external_dirs` from `~/.hermes/config.yaml`

**Label:** VERIFIED — Nested paths such as `skills/from-amp/<name>/SKILL.md` are discoverable when the parent `skills/` directory is registered.

### 3. Operator config shows external project skills dir

From `~/.hermes/config.yaml`:

```yaml
skills:
  external_dirs:
  - /Users/dev/Dev/Github/ai-product-sense/skills
```

Observed on disk:

```bash
$ find /Users/dev/Dev/Github/ai-product-sense/skills -maxdepth 2 -name 'SKILL.md' | head -3
/Users/dev/Dev/Github/ai-product-sense/skills/voice-note-ingest/SKILL.md
/Users/dev/Dev/Github/ai-product-sense/skills/article-enrichment/SKILL.md
/Users/dev/Dev/Github/ai-product-sense/skills/book-mirror/SKILL.md
```

**Label:** VERIFIED — Hermes loads project skills from an external absolute `skills/` directory configured in `config.yaml`.

**Label:** PROVISIONAL — Hermes does **not** automatically scan `./skills` from the current working directory unless that path is listed in `skills.external_dirs` or skills are copied/symlinked under `~/.hermes/skills/`.

### 4. Installed skill inventory command

```bash
$ hermes skills list | head -10
                                Installed Skills
...
│ academic-verify         │                      │ local   │ local   │ enabled │
```

**Label:** VERIFIED — `hermes skills list` reports enabled local/bundled skills.

**Label:** UNKNOWN — whether a skill placed only under `<project>/skills/from-amp/` is listed without adding the parent dir to `external_dirs`; source code implies it will **not** be discovered automatically.

### 5. Preload / session load behavior

From `hermes --help`:

```
--skills SKILLS, -s SKILLS
                        Preload one or more skills for the session (repeat
                        flag or comma-separate)
```

Source inspected:

- `/Users/dev/.hermes/hermes-agent/agent/skill_commands.py` — slash commands and preloaded skills prompt construction
- `/Users/dev/.hermes/hermes-agent/tools/skills_tool.py` — `skill_view` loads `SKILL.md` from trusted skill roots

**Label:** VERIFIED — Hermes can preload named skills for a session via CLI flag once the skill is indexed under a trusted root.

**Label:** PROVISIONAL — End-to-end “Hermes chat session sees AMP-emitted skill body” was not run in this spike; discovery mechanics are verified from source + config, not a live chat transcript.

### 6. Safe AMP write target vs AMP spec table

AMP consolidated spec §9.4 lists Hermes/OpenClaw/gbrain pattern:

| Harness | Skill location | AMP-managed path |
|---|---|---|
| Hermes / OpenClaw / gbrain | `skills/` | `skills/from-amp/SKILL_NAME/SKILL.md` |

Recommended v1 mapping for a project rooted at `<projectRoot>`:

| Purpose | Path |
|---|---|
| User-authored skills | `<projectRoot>/skills/<name>/SKILL.md` (outside AMP writes) |
| AMP-managed emissions | `<projectRoot>/skills/from-amp/<name>/SKILL.md` |
| Hermes discovery config | add `<projectRoot>/skills` to `skills.external_dirs` during `amp init` / doctor (future CLI tasks) |

**Label:** VERIFIED (path pattern from spec) + PROVISIONAL (Hermes auto-load without config entry).

**Invariant 4:** AMP adapter must refuse writes outside `<projectRoot>/skills/from-amp/`.

### 7. Rules / AGENTS.md injection (not the procedure target)

Hermes `--help` documents `--ignore-rules` skipping auto-injection of `AGENTS.md`, `SOUL.md`, `.cursorrules`, memory, and preloaded skills.

**Label:** VERIFIED — Hermes has separate rule/memory injection from skill files.

**Label:** UNKNOWN — whether Hermes reads `.cursor/rules/*.mdc`; out of scope for Hermes SAS v1 except to note Cursor remains a separate verified adapter.

## Comparison to Cursor / Claude Code (context only)

| Harness | AMP-managed emission path | Verification in repo |
|---|---|---|
| Cursor | `.cursor/rules/from-amp/*.mdc` | VERIFIED path guards in `src/amp/adapters/sas/cursor/` |
| Claude Code | `<base>/from-amp/<skill>/SKILL.md` | VERIFIED skeleton adapter |
| Hermes | `<project>/skills/from-amp/<skill>/SKILL.md` | PROVISIONAL until V1-14 adapter + load test |

## Unresolved claims for V1-13+

1. Exact SAS `from_amp_path` string for Hermes (recommend `skills/from-amp/` relative to project root).
2. Whether Hermes prefers `~/.hermes/skills/from-amp/` for user-global AMP emissions vs project-local `skills/from-amp/`.
3. Live load test: emit a fixture skill, run `hermes -s <name> -z "..."`, confirm skill body in prompt/tool path.
4. Conflict detection with hub-installed skills of the same name.

## Recommendation for V1-13

Author `sas-files/hermes.yaml` with:

- `injection_modes: [filesystem-native]`
- `from_amp_path: skills/from-amp/`
- `emitted_artifact: { format: skill-md, naming: folder-per-skill }`
- External claims marking auto-discovery as PROVISIONAL pending V1-14 load test.
