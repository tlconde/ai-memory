# AMP Persistent Local Knowledge Store Plan

> **Owner:** Codex planning pass  
> **Date:** 2026-05-27  
> **Branch:** `ralph/amp-runtime-semantics-plan`  
> **Scope:** plan/spec only — no implementation in this report  
> **Inputs:** current runtime graduation stack through `b05a8d8`, `RuntimeStore`, `KnowledgeStore`, local projection source, knowledge backend resolver

---

## Executive Verdict

AMP needs a persistent local `KnowledgeStore` before `amp runtime graduation apply` can be useful in real operator workflows.

The current apply command is correctly fail-closed:

- injected `KnowledgeStore` works for tests
- production CLI without persistent local knowledge returns `knowledge_backend_not_persistent`
- no gbrain writes
- no false claim that process-local in-memory writes are durable

The next implementation should add a **SQLite-backed local knowledge store** and wire it only through the existing graduation-apply resolver:

```text
amp runtime graduation apply
  -> resolveGraduationApplyKnowledgeStore(...)
  -> LocalSqliteKnowledgeStore
  -> KnowledgeStore.write/read/list
```

Do not route this through the existing `in-memory` backend. `in-memory` remains ephemeral and test/local-projection-only.

---

## Design Decision

### Storage Location

Use a separate SQLite DB file from `runtime.db`:

```text
<runtime-db-dir>/knowledge.db
```

Examples:

- if runtime DB is `.amp/runtime/runtime.db`, local knowledge DB is `.amp/runtime/knowledge.db`
- if `AMP_RUNTIME_PATH=/tmp/amp/runtime.db`, local knowledge DB is `/tmp/amp/knowledge.db`

Rationale:

- Keeps runtime operational state and durable knowledge physically distinct.
- Reuses existing path discovery without adding config schema yet.
- Lets dogfood projects wipe runtime queues without accidentally deleting durable frames.
- Avoids overloading `RuntimeStore` with durable-knowledge responsibilities.

Add a pure helper:

```ts
resolveLocalKnowledgeDbPath(runtimeDbPath: string): string
```

Do not add a new env var in the first slice unless implementation discovers a strong need. Path determinism is enough.

### Store Class

Add a new adapter:

```text
src/amp/adapters/ssa/local-sqlite-knowledge-store.ts
```

Suggested API:

```ts
export interface LocalSqliteKnowledgeStoreOptions {
  dbPath: string;
}

export class LocalSqliteKnowledgeStore implements KnowledgeStore {
  constructor(options: LocalSqliteKnowledgeStoreOptions)
  close(): void
  write(frames: Frame[]): void
  read(id: string): Frame | undefined
  list(filter?: KnowledgeListFilter): Frame[]
  capabilities(): CapabilityCoverage
}
```

This lives under `adapters/ssa/` because it implements the SSA `KnowledgeStore` adapter contract, just like `InMemoryKnowledgeStore`.

### SQLite Schema

Start with one table:

```sql
CREATE TABLE IF NOT EXISTS knowledge_frame (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  project_ref TEXT,
  curation_mode TEXT NOT NULL,
  frame_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  position INTEGER NOT NULL
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS knowledge_frame_scope_idx
  ON knowledge_frame(scope_kind, project_ref);

CREATE INDEX IF NOT EXISTS knowledge_frame_curation_idx
  ON knowledge_frame(curation_mode);
```

Keep `frame_json` as the source of truth for now. Duplicating indexed metadata is acceptable because it supports `list(filter)` without JSON scanning and can be recomputed from validated frames.

### Duplicate Semantics

`LocalSqliteKnowledgeStore.write(frames)` must **fail on duplicate frame id**.

Why:

- Graduation apply already checks duplicates before write.
- In-memory currently overwrites silently, but persistent durable knowledge should not.
- Fail-closed duplicate behavior protects operator trust and auditability.

Implementation choices:

- Use `INSERT`, not `INSERT OR REPLACE`.
- Let SQLite unique constraint throw.
- Translate duplicate errors only if a caller needs structured results later. The `KnowledgeStore` interface currently throws on write failure, and `applyRuntimeGraduationDecision` already catches write failures.

### Atomicity

`write(frames)` must be transactional:

- all frames written, or
- no frames written

Even though GRAD-03 applies one frame at a time, consolidation and future apply flows may batch writes. This should be correct from the start.

### Validation

Every frame must pass `parseFrame` before insert.

Do not store invalid frame JSON. Do not trust callers just because TypeScript says `Frame`.

### Capabilities

Return the same conservative slice coverage shape as `InMemoryKnowledgeStore` unless a more precise local capability helper already exists.

At minimum:

- write/read/list supported by implementation reality
- vector search unsupported
- cloud/gbrain features unsupported

No claims about semantic search.

---

## Resolver Wiring

Extend only this resolver:

```ts
resolveGraduationApplyKnowledgeStore(...)
```

Suggested shape:

```ts
export interface ResolveGraduationApplyKnowledgeStoreOptions {
  knowledgeStore?: KnowledgeStore;
  runtimeDbPath?: string;
}
```

Behavior:

1. If `knowledgeStore` is injected, return it.
2. If `runtimeDbPath` is provided, return `LocalSqliteKnowledgeStore({ dbPath: resolveLocalKnowledgeDbPath(runtimeDbPath) })`.
3. Otherwise fail with `knowledge_backend_not_persistent`.

This preserves the current fail-closed behavior until `runtime-graduation-apply.ts` deliberately passes `bootstrap.runtimeDbPath`.

In `runAmpRuntimeGraduationApply`, keep the gate order honest:

```text
id validation
bootstrap
resolveGraduationApplyKnowledgeStore({ knowledgeStore: deps?.knowledgeStore, runtimeDbPath: bootstrap.runtimeDbPath })
read runtime row
plan one record
apply
close stores
```

The gate can no longer run before bootstrap once it needs `runtimeDbPath`.

### Store Lifecycle

`runAmpRuntimeGraduationApply` must close the local knowledge store it opens.

Do not close injected stores.

Use a return shape from the resolver that includes cleanup:

```ts
type ResolveGraduationApplyKnowledgeStoreResult =
  | { ok: true; store: KnowledgeStore; persistent: boolean; cleanup: () => void }
  | { ok: false; reason: ...; error: string };
```

For injected stores:

```ts
cleanup: () => {}
```

For local SQLite:

```ts
cleanup: () => store.close()
```

`KnowledgeStore` itself does not have `close()`, so lifecycle belongs in the resolver result.

---

## Projection / Retrieve Integration

Do **not** silently change all local projection behavior in the first storage slice.

There are two reasonable phases:

### Phase A: Apply Persistence Only

Wire `LocalSqliteKnowledgeStore` only into graduation apply.

Pros:

- Smallest blast radius.
- Proves survival across process exits.
- Keeps projection/retrieve behavior unchanged.

Cons:

- A successfully applied frame will not automatically appear in `amp projection render --source local` unless that command also uses the persistent local store.

If Phase A ships alone, operator output must say:

```text
NOTE Frame was written to persistent local knowledge; projection/retrieve wiring follows in a later slice.
```

### Phase B: Local Projection Reads Persistent Store

Extend `resolveProjectionKnowledgeStore` to use the persistent local store when `AMP_KNOWLEDGE_BACKEND=local-sqlite` or a new backend name is selected.

Recommended backend name:

```text
local-sqlite
```

Update:

```ts
type AmpKnowledgeBackend = "in-memory" | "local-sqlite" | "gbrain" | "fake-gbrain";
```

Semantics:

- `in-memory`: ephemeral test/local projection mode, unchanged
- `local-sqlite`: persistent local knowledge, no gbrain
- `gbrain`: live gbrain read/write paths remain guarded by existing live policy
- `fake-gbrain`: tests only

This makes the operator story clear:

```bash
AMP_KNOWLEDGE_BACKEND=local-sqlite amp runtime graduation apply --id pref-1
AMP_KNOWLEDGE_BACKEND=local-sqlite amp projection render --source local --dry-run
```

Do not make `local-sqlite` the default yet. Default is currently `gbrain`; changing that is a product decision, not a storage implementation detail.

---

## Safety Invariants

1. **No gbrain writes.** Local SQLite apply must not call `createWriteKnowledgeBackend` or any gbrain adapter.
2. **No false durability.** `in-memory` remains explicitly non-durable for CLI apply.
3. **No overwrite.** Duplicate frame ids fail closed.
4. **No runtime mutation.** Graduation apply still leaves runtime semantic rows unchanged until a separate promoted-status API exists.
5. **No project-to-user promotion.** Store frames exactly as the planner created them; do not rewrite scope.
6. **Survives process exit.** Tests must prove a frame written by one store instance is readable by a new store instance.
7. **Projection integration is explicit.** If projection reads persistent local knowledge, it must be an intentional backend mode, not accidental coupling.

---

## Implementation Slices

### LOCAL-KNOW-01 — SQLite Knowledge Store Adapter

Build the adapter and tests only.

Files:

- `src/amp/adapters/ssa/local-sqlite-knowledge-store.ts`
- `src/amp/adapters/ssa/local-sqlite-knowledge-store.test.ts`
- `src/amp/adapters/ssa/index.ts`

Tests:

- write/read/list round trip
- survives close/reopen
- filters by scope/project/curation
- duplicate id fails closed
- invalid frame rejected
- parent directories created
- transactional batch write

No CLI wiring.

### LOCAL-KNOW-02 — Graduation Apply Resolver Wiring

Wire persistent local store only into `resolveGraduationApplyKnowledgeStore` and `runtime graduation apply`.

Files likely touched:

- `src/amp/cli/knowledge-backend.ts`
- `src/amp/cli/knowledge-backend.test.ts`
- `src/amp/cli/runtime-graduation-apply.ts`
- `src/amp/cli/runtime-graduation-apply.test.ts`

Tests:

- no injected store + initialized project applies to persistent local DB
- close/reopen local store sees written frame
- duplicate apply fails across invocations/store instances
- no runtime row mutation
- no gbrain construction
- bootstrap error still surfaces when config missing

### LOCAL-KNOW-03 — Local Projection Persistent Backend

Add `local-sqlite` backend mode and wire local projection to read it.

Files likely touched:

- `src/amp/cli/knowledge-backend.ts`
- `src/amp/cli/projection-source.ts`
- projection/retrieve tests as needed

Tests:

- `AMP_KNOWLEDGE_BACKEND=local-sqlite` local projection reads frames from persistent store
- `AMP_KNOWLEDGE_BACKEND=in-memory` behavior unchanged
- `AMP_KNOWLEDGE_BACKEND=gbrain` local projection still fails closed as today
- applied graduation frame appears in dry-run projection after a new process/store open

---

## Composer Prompt — LOCAL-KNOW-01

```text
Implement LOCAL-KNOW-01: SQLite-backed local KnowledgeStore adapter.

Scope:
- Add `src/amp/adapters/ssa/local-sqlite-knowledge-store.ts`
- Add `src/amp/adapters/ssa/local-sqlite-knowledge-store.test.ts`
- Export from `src/amp/adapters/ssa/index.ts`
- No CLI wiring.
- No runtime graduation apply wiring.
- No projection/retrieve wiring.
- No gbrain.
- No changes to RuntimeStore.

Requirements:
- Implement `KnowledgeStore`.
- Constructor takes `{ dbPath: string }`.
- Create parent directories for `dbPath`.
- Use SQLite via existing `better-sqlite3` dependency.
- Create table `knowledge_frame` if missing:
  - `id TEXT PRIMARY KEY`
  - `kind TEXT NOT NULL`
  - `scope_kind TEXT NOT NULL`
  - `project_ref TEXT`
  - `curation_mode TEXT NOT NULL`
  - `frame_json TEXT NOT NULL`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
  - `position INTEGER NOT NULL`
- Store validated full frame JSON in `frame_json`.
- Validate every frame with `parseFrame` before insert.
- `write(frames)` must be transactional.
- Duplicate frame ids must fail closed; do not overwrite.
- `read(id)` returns the parsed frame or `undefined`.
- `list(filter?)` returns frames in insertion order and supports existing `KnowledgeListFilter`.
- `capabilities()` should stay conservative; mirror `InMemoryKnowledgeStore` unless a better local helper exists.
- Include a `close()` method, but do not add it to the `KnowledgeStore` interface.

Tests:
- write/read/list round trip
- survives close/reopen
- filters by scope/project/curation
- duplicate id fails closed
- invalid frame rejected
- creates parent directories
- batch write is all-or-nothing when one frame is invalid/duplicate

Validation:
- npm run typecheck
- node --import tsx --test src/amp/adapters/ssa/local-sqlite-knowledge-store.test.ts
- npm run amp:acceptance
- git diff --check

Final report:
- Summarize files changed
- Include verification results
- Include residual risks
- After implementation, run /thermo-nuclear-code-quality-review and include the review output in the report.
```

---

## Composer Prompt — LOCAL-KNOW-02

Do not run this until LOCAL-KNOW-01 is reviewed and committed.

```text
Implement LOCAL-KNOW-02: wire persistent local KnowledgeStore into runtime graduation apply.

Scope:
- Touch only:
  - `src/amp/cli/knowledge-backend.ts`
  - `src/amp/cli/knowledge-backend.test.ts`
  - `src/amp/cli/runtime-graduation-apply.ts`
  - `src/amp/cli/runtime-graduation-apply.test.ts`
  - any exports needed for `LocalSqliteKnowledgeStore`
- No planner rule changes.
- No projection/retrieve wiring.
- No gbrain.
- No proposal queue.
- No runtime semantic row mutation.
- No batch apply.

Requirements:
- Add `resolveLocalKnowledgeDbPath(runtimeDbPath: string): string`, returning `knowledge.db` next to `runtime.db`.
- Extend `resolveGraduationApplyKnowledgeStore`:
  - injected `knowledgeStore` still succeeds
  - provided `runtimeDbPath` opens `LocalSqliteKnowledgeStore`
  - result includes cleanup so CLI can close local SQLite store
  - missing both still fails with `knowledge_backend_not_persistent`
- Update `runAmpRuntimeGraduationApply`:
  - validate `--id`
  - bootstrap project/runtime context
  - resolve graduation apply knowledge with `bootstrap.runtimeDbPath`
  - ensure runtime store and local knowledge store are closed on success and failure
  - keep runtime semantic row unchanged
- Human output may now say durable local knowledge was written only after successful persistent write.
- JSON output should keep existing shape.

Tests:
- CLI apply without injected store succeeds for eligible preference candidate and writes to persistent local knowledge DB.
- Reopen `LocalSqliteKnowledgeStore` from `knowledge.db` and verify frame exists.
- Duplicate apply fails across new store/runtime opens.
- Runtime semantic row remains unchanged.
- Missing config still returns bootstrap error.
- No gbrain construction/live write path.
- Existing injected-store tests still pass.

Validation:
- npm run typecheck
- node --import tsx --test src/amp/cli/runtime*.test.ts src/amp/cli/knowledge-backend.test.ts src/amp/adapters/ssa/local-sqlite-knowledge-store.test.ts src/amp/runtime-semantics/graduation-apply.test.ts
- npm run amp:acceptance
- git diff --check

Final report:
- Summarize files changed
- Include verification results
- Include residual risks
- After implementation, run /thermo-nuclear-code-quality-review and include the review output in the report.
```

---

## Thermo-Nuclear Review

**Verdict:** approve plan with one constraint.

The plan avoids the dangerous shortcut: it does not make `in-memory` pretend to be durable. It adds a real local persistence adapter, keeps runtime and knowledge physically separate, and wires graduation apply through the resolver that already owns the durability gate.

Hard constraint:

- Do not change `AMP_KNOWLEDGE_BACKEND=in-memory` semantics. It remains ephemeral.

Watch list:

- If `LocalSqliteKnowledgeStore.write()` overwrites duplicate ids, reject the implementation.
- If projection starts reading persistent knowledge without an explicit backend mode, reject the implementation.
- If graduation apply reaches gbrain, reject the implementation.
- If runtime rows are marked promoted in the same slice, reject the implementation.

This is intentionally a local-first durability path, not a cloud/gbrain synchronization design.
