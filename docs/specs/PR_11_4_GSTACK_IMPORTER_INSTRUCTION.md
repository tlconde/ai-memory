# PR 11.4 — Gstack Importer Instruction

> **Branch base:** `ralph/amp-upstream-sync-skeleton`  
> **Spec:** `AMP_SPEC_UPDATE_OPTIMIZER_AND_UPSTREAM_SYNC.md` §5 / §9.9  
> **Scope:** First real `UpstreamSource` — local-first gstack importer (no GitHub clone)

---

## Intentional spec deviation

§9.9.1 step 1 says "clone gstack at a ref into a temp dir." **Do not.** The source reads a **local gstack checkout directory** the user already has (`config.url = file://<path>`). No `git clone`, no GitHub fetch, no network. Networked git transport is explicitly deferred/out-of-scope.

---

## Hard constraints

- No network anywhere in the importer.
- Reuse §11.2 machinery: `runUpstreamSync`, `diffManifests`, `applyChangeset`, changeset persistence, `checksum.ts`, `ProcedureRegistry`, `propagateProcedures`, `ProcedureFrontmatterSchema`.
- Mirror real `UpstreamSource` interface: `id`, `kind`, `config`, `manifest()`, `pollUpstream()`, `fetch(ref)`.
- Validate every mapped procedure against `ProcedureFrontmatterSchema` before register; failures list `validation_error`, not auto-fixed.
- Don't touch `AmpConfigFileSchema`. node:test runner only.

---

## New code

### 1. `src/amp/procedural/parse-skill-md.ts`

- `parseSkillMd(content): { frontmatter: unknown; body: string }`
- `mapGstackToCanonicalProcedure(parsed, { ref, mtime, skillDirName, ... }): CanonicalProcedure`
- Version helpers: `gstackImportVersion`, `promoteGstackImportToUserVersion`, `isUntouchedGstackImport`
- Harness inference: `inferSupportedHarnesses(body)` — default `["any"]`; narrower for Cursor `@codebase` / Claude slash commands

### 2. `src/amp/upstream/gstack-source.ts`

- `GstackUpstreamSource implements UpstreamSource`, `kind: "git-repo"`
- Reads `<localCheckout>/skills/*/SKILL.md`
- `manifest()` / `pollUpstream()` with per-skill checksums; `fetch(ref)` returns mapped procedures

### 3. `src/amp/upstream/gstack-import.ts`

- Import/revoke/list service layer
- Harness snapshot persist/load for byte-for-byte revoke (`.amp/local/gstack-revoke-snapshot/`)

### 4. `src/amp/cli/procedural.ts` + wire in `cli/index.ts`

```bash
amp procedural import gstack <local-path> [--ref <sha>]
amp procedural revoke gstack [--keep-edited]
amp procedural list [--source gstack]
amp procedural list --checkout <local-path> [--ref <sha>]
```

---

## Versioning (§9.9.2)

| Origin | Version | Conflict |
|---|---|---|
| Gstack-imported (untouched) | `0.<gstack-version>.<patch>` | Upstream edit → changeset; auto-apply after approval if still `0.x` |
| Locally edited | Promoted to `1.x.x` | §16.7 concurrent_edit; `apply` refuses without `--accept-upstream` |

---

## Fixture + tests

- `src/amp/integration/fixtures/gstack-mini/` — portable, cursor-specific, claude-specific, invalid YAML skill
- `src/amp/integration/gstack-import.test.ts` — §9.9.5 falsifiable claims

---

## Acceptance

- §9.9.5 falsifiable claims green
- `tsc --noEmit` + `npm run build` pass
- Importer network-grep empty (no `http://`, `https://`, `git clone`, `fetch(` in code)
- Revoke byte-for-byte restore verified
- `0.x → 1.x` promotion and concurrent_edit conflict edges covered

---

## Commit split

1. `parse-skill-md` + mapper + unit tests  
2. `GstackUpstreamSource` + `gstack-import` service + sync integration  
3. `amp procedural` CLI  
4. fixture + `gstack-import.test.ts` + instruction doc  

---

## Out of scope

- Networked git transport  
- Optimizer (§11.5)  
- gbrain promotions  
- Auto-apply upstream changesets  

---

## Live verification (operator)

Point import at a local gstack checkout on your machine:

```bash
amp procedural import gstack /path/to/gstack --ref $(git -C /path/to/gstack rev-parse HEAD)
amp doctor
amp procedural revoke gstack
```

Tests use `src/amp/integration/fixtures/gstack-mini/` only — no network.
