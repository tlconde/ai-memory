# LEARNINGS

Append-only log of discoveries during the chunk-level retrieval refactor.


## T2 — Consumer audit

**Purpose:** Full map of hybrid-search module consumers, risk assessment, and test harness details.

### Overview

- **Total consumers: 4 direct consumers** (1 library-internal, 3 active usages)
- **Public exports:** NO — `hybridSearch`, `loadChunks`, `Chunk`, etc. are NOT exported in package.json `exports` field
- **Tests:** NO dedicated tests for hybrid-search; validation via eval metrics only
- **Test runner:** No test framework; use `npm run build` (TypeScript) → `npm run typecheck`
- **Eval command:** `npx ai-memory eval` or `npm exec -- ai-memory eval` (via CLI)

### Consumer map

#### 1. CLI: init command (model warming)
**File:** `/Users/dev/Dev/Github/ai-memory/src/cli/index.ts` (lines 71–72, 83–84)
**Function used:** `warmSearchModel()`
**Context:** 
- Preloads semantic model at init time with `--download-model` flag
- Called at lines 71–72 (existing .ai/) and 83–84 (new .ai/)
- Usage: `await warmSearchModel()`

**Risk assessment:**
- **Safe to change:** YES — only calls `warmSearchModel()`, does not depend on return value or model internals
- **Score field dependency:** NO
- **Output shape dependency:** NO
- **Recommendation:** Can refactor `warmSearchModel()` signature freely

---

#### 2. MCP tool: search_memory
**File:** `/Users/dev/Dev/Github/ai-memory/src/mcp-server/tools/memory.ts` (lines 15–30, 40, 46, 60)
**Functions used:** `hybridSearch()` (2 calls), `getSearchMode()`
**Context:**
- Two handlers: `handleSearchMemory()` (full query), `handleGetMemory()` (topic lookup)
- Line 16: reads `getSearchMode()` to use current mode (keyword/semantic/hybrid)
- Lines 20, 23: calls `hybridSearch()` with fallback: tries configured mode, falls back to keyword-only on error
- Lines 40, 46: result destructured as `{ results, backend, fallbackNote }`
- Lines 45–46: accesses `r.excerpt` (truncates to 200 chars), `r.file`, `r.score` (displayed to user)
- Line 60: accesses `r.file`, `r.excerpt` (no truncation in `handleGetMemory`)

**Field accesses:**
- `results[].file` — YES, displayed in output
- `results[].excerpt` — YES, displayed in output
- `results[].score` — YES, displayed as "(score: X)" in line 46
- `backend` — YES, displayed as backend label (line 42)
- Returns both the full response and a `fallbackNote` (line 29)

**Risk assessment:**
- **Safe to change:** PARTIAL — can change internal search logic, but:
  - MUST preserve `{ file, excerpt, score, backend }` shape
  - Score field IS read and displayed; currently hardcoded to 1 for semantic/hybrid modes
  - If you change score to something other than 1, users see different output (may be desired)
  - Excerpt length expectations: code truncates at 200 chars in `handleSearchMemory`, but NOT in `handleGetMemory`
- **Recommendation:** Safe to refactor keyword search scoring; semantic/hybrid score depends on RRF tuning

---

#### 3. MCP tool: validate_context (governance)
**File:** `/Users/dev/Dev/Github/ai-memory/src/mcp-server/tools/governance.ts` (lines 129–141)
**Functions used:** `hybridSearch()`, `getSearchMode()`
**Context:**
- Semantic constraint validation: checks if required knowledge is present in memory (lines 122–158)
- Line 129: reads `getSearchMode()` to use configured mode
- Line 131: calls `hybridSearch(aiDir, rule.query, { mode, limit: 5 })`
- Lines 134–141: accesses `r.file` and `r.score` to check if result matches expected file AND score >= `rule.min_score` (default 0.3)

**Field accesses:**
- `results[].file` — YES, matched against `rule.expected_in` list
- `results[].score` — YES, compared against `rule.min_score` threshold (line 141)
- `results[].excerpt` — NO

**Risk assessment:**
- **RISKY:** Score field is USED for gating. Currently hardcoded to 1.0 for semantic/hybrid, which means:
  - All semantic/hybrid results pass the score threshold (1.0 >= default 0.3)
  - If you change score calculation, governance validation behavior changes
  - Keyword-only results use real TF scores, so they already vary (may fail if < threshold)
- **Recommendation:** 
  - DO NOT change score without understanding governance gate implications
  - Consider: should semantic/hybrid results have real confidence scores? Currently they're stubbed
  - If score changes, requires audit of all [P0] rules using semantic constraints

---

#### 4. Eval: search quality metrics
**File:** `/Users/dev/Dev/Github/ai-memory/src/evals/search-quality.ts` (lines 99–105)
**Function used:** `hybridSearch()`
**Context:**
- Measures hybrid search recall vs. keyword-only on test cases (semantic advantage)
- Tests split into "shared terms" (baseline) and "zero overlap" (semantic advantage) tiers
- Lines 99–105: runs `hybridSearch()` in both keyword and hybrid modes, checks if expected file appears in results
- Line 76: accesses `r.file.toLowerCase()` for file matching (no other field accessed)

**Field accesses:**
- `results[].file` — YES, checked for presence of expected file
- `results[].excerpt` — NO
- `results[].score` — NO

**Risk assessment:**
- **Safe to change:** YES — only depends on result ordering (file presence), not score or excerpt
- **Recommendation:** Can refactor scoring and excerpt generation freely; eval only cares about ranked file list

---

### Type/function export audit

| Export | Public (pkg.json)? | Consumers | Literal shape dependency | Score dependency |
|--------|-------------------|-----------|--------------------------|------------------|
| `hybridSearch()` | NO | 3 (memory.ts, governance.ts, search-quality.ts) | YES (all read `.file`, `.excerpt`, or `.score`) | YES (governance.ts line 141) |
| `loadChunks()` | NO | 0 direct; used internally only | N/A | N/A |
| `warmSearchModel()` | NO | 1 (cli/index.ts) | NO | N/A |
| `getSearchMode()` | NO | 2 (memory.ts, governance.ts) | NO (env read) | N/A |
| `getLastSearchBackend()` | NO | 0 direct | N/A | N/A |
| `Chunk` | NO | Internal use only | N/A | N/A |
| `SearchResult` | NO | Implicit type of `results[]` | YES (see field accesses above) | YES |
| `HybridSearchResponse` | NO | Implicit return type | YES | YES |
| `SearchMode` | NO | Not explicitly used in consumers (only read via `getSearchMode()`) | N/A | N/A |
| `SearchBackend` | NO | Return type in governance.ts, displayed in memory.ts | YES (backend label) | N/A |

### Test/eval harness

**Test files:** None (no `.test.ts` or `.spec.ts` files in `/src`)

**Eval validation (primary test mechanism):**
- Run: `npm exec -- ai-memory eval` (from project with .ai/ directory)
- Or: `npx ai-memory eval [--dir <aiDir>]`
- Metrics evaluated:
  - `evalSemanticRecall()` (search-quality.ts) — measures hybrid vs. keyword on 5 test cases
  - Other evals (rule coverage, index coverage, session cadence, etc.) do NOT directly test hybrid-search

**Build verification:**
- `npm run build` — TypeScript compilation
- `npm run typecheck` — type-only check (no emit)
- No jest/vitest/mocha; no unit tests

**Package exports:** Only `evals`, `mcp`, `formatter`, and main index; `hybrid-search` NOT exported publicly

---

### Risk summary

**Highest risk:**
- `governance.ts` line 141: score field is GATING semantic constraint validation
  - If you change score calculation, P0 constraint enforcement may break
  - Requires validation of all semantic rules in real .ai/ instances

**Medium risk:**
- `memory.ts` lines 45–46: score IS displayed to users
  - Currently hardcoded to 1 for semantic/hybrid; changing this changes UX
  - Users may rely on score ordering in practice (even if not contractually guaranteed)

**Low risk:**
- `search-quality.ts`: only needs file ordering; safe to refactor internally
- `cli/index.ts`: only warms model; safe to change signature or internal behavior

**Safe changes:**
- Refactor keyword search TF scoring algorithm
- Improve excerpt extraction logic
- Add new return fields to `HybridSearchResponse` (backward compatible if optional)
- Change `SearchMode` enum values (not directly exposed to consumers)

**Breaking changes to avoid:**
- Removing or renaming `results`, `file`, `excerpt`, or `score` fields
- Changing result ordering without understanding governance gate implications
- Removing `SearchResult`, `HybridSearchResponse`, or `SearchBackend` types (internal, but governance.ts imports them indirectly)


---

## T1 — API design critique

**Purpose:** Independent adversarial review of the API design in specs/plan.md before implementation.

### Must-fix

1. **Chunk ID is not content-stable.** `${relativePath}#${sectionIndex}` shifts if a `## ` heading is inserted upstream; IDs collide across sessionless-file cases only if two chunks share a file but not index (not a real collision). Decision: document ID as **opaque, in-process identity**, not content-addressable. Consumers must not parse it. No contentHash for now (YAGNI).
2. **`score: 1` stub must stay in `hybridSearch`.** `rankChunks` returns real similarities; `hybridSearch` maps them back to `score: 1` in hybrid/semantic modes for backcompat. Explicit test required. Confirmed critical by T2: governance.ts:141 gates on `score >= rule.min_score` (default 0.3) — a silent change to real similarities could break P0 rule enforcement.
3. **Empty / degenerate inputs.** Contract: empty `chunks[]` → `{results: [], backend: "keyword"}`, no model load. Empty / whitespace-only query → same. Query with only stopwords → keyword returns nothing, semantic still runs in hybrid mode.

### Should-fix

4. **`Chunk.id` optional on interface.** `id?: string`; `loadChunks` fills it; `rankChunks` synthesizes `__anon_${i}` for chunks without one. Avoids breaking any synthetic-chunk callers.
5. **Nullable score semantics.** Use `kwRank?: number` / `semRank?: number` (undefined = retriever didn't run) and `null` when retriever ran but chunk was absent. Or add `retrieversRun` on response envelope. Decision: use `undefined` vs `null` split. Document it.
6. **Rename `limit` → `topK` in `RankChunksOptions`.** Different unit than `hybridSearch.limit` (chunks vs files). Keep `limit` on the old options.
7. **Tag filter runs inside `rankChunks`** before retrieval — filtered chunks don't appear in results (no null ranks). Symmetric with deprecated filter.
8. **Batching determinism.** Hardcode batch size (64). Test batched vs unbatched embeddings agree within 1e-6 (normalize:true should guarantee this).
9. **Tie-breaking.** Secondary sort by `chunk.id` ascending on all ranked outputs for reproducibility.
10. **Deprecate `getLastSearchBackend()`.** Module-global `backendUsed` is racy under concurrent calls. New response field replaces it. Mark JSDoc `@deprecated`; don't remove in this PR.

### Nits (non-blocking)

- `rrfScore` not normalized; document formula.
- `backend` field in response already exists; fine.

