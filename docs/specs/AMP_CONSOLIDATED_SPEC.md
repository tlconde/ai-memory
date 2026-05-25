# AMP — Consolidated Specification (v2)

> **Status:** working draft, locked-decisions consolidation
> **Date:** 24 May 2026
> **Version:** v2 (replaces v1 from start of conversation)
> **Purpose:** Capture every locked architectural decision in one place. Provide clean handoff to a fresh conversation for remaining open questions.

---

## 0. What this document is

This is the protocol specification for **AMP** — Agent Memory Protocol (working name). It defines a **substrate protocol** that makes models, harnesses, and storage backends interchangeable while preserving user knowledge, preferences, intents, and skills across all of them.

This document is the **decision log**, not the implementation. It captures what was locked, why, what was deferred, and what's still open. The next conversation should start by reading this document.

**This v2 reflects substantial reframing from v1**:
- AMP is a *substrate protocol*, not just a *memory protocol*
- Two-DB architecture replaced by *unified knowledge graph with `curation_mode` property*
- Adapter contracts unified (SAC/SSC merged with role declaration)
- Runtime / knowledge store split introduced (operational vs. durable state)
- Profile is *saved queries over primitives*, not a separate type system
- AMP adopts the existing Agent Skills open standard for procedures
- "AMP defines / backends declare / users informed" model for capability coverage
- RL feedback loop is first-class (inference layer is a substrate sub-layer)
- Three substrate sub-layers above storage: inference, consolidation, propagation

### 0.1 v1 implementation status (May 2026)

The reference implementation lives in `src/amp/` in the ai-memory repo. The canonical v1 gate is `npm run amp:acceptance` at commit `82962bf`.

| Artifact | Purpose | Source of truth |
|---|---|---|
| Acceptance report | Human-readable gate steps, invariant policy, PROVISIONAL/UNKNOWN exclusions, residual risks | `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md` |
| Acceptance implementation | Executable gate policy | `src/amp/conformance/acceptance-gate.ts` |
| Implementation guide | Current build layout and remaining planned phases | `docs/guides/CURSOR_IMPLEMENTATION_GUIDE.md` |

---

## 1. Architectural commitments (read these first)

These commitments shape everything below. They are restated at the top because they have dropped between conversations historically.

### 1.1 The three-layer model

```
Layer 0 — MODEL       Replaceable.   Claude, Codex, GPT, Gemini, …
Layer 1 — HARNESS     Replaceable.   Hermes, OpenClaw, Claude Code, Cursor, …
Layer 2 — SUBSTRATE   Durable.       AMP. Defines everything below.
Layer 3 — STORAGE     Pluggable.     gbrain, Mem0, raw-fs, crystals-db, …
```

Models can be swapped. Harnesses can be swapped. The substrate is the durable layer that survives both. Storage backends plug into the substrate; multiple backends may coexist; the substrate orchestrates them.

### 1.2 Skills as the empowerment surface

Skills (procedures) should grow without bound. The more skills, the more empowered the user. The more empowered, the more hyperpersonalized any model+harness combination becomes for that user. AMP stores canonical procedural artifacts and compiles them into verified harness-native formats, extending Agent Skills-style metadata where supported.

### 1.3 Knowledge vs. procedures vs. models

These are structurally different things with different lifecycles:
- **Knowledge** — frames with mutation semantics, lives in the substrate's knowledge store
- **Procedures (skills)** — executable workflow artifacts with scaffold → fill → check → version lifecycle, body lives as files in harness FS, metadata lives in substrate
- **Models** — the layer that interprets knowledge and runs procedures; replaceable

AMP orchestrates the interconnection. None of the three are "memory" alone; together they make the user's full operational state.

### 1.4 Determinism where possible

Schema-based operations beat freeform. Typed slots beat untyped properties. Explicit confidence beats implicit hand-waving. Where a behavior can be made deterministic, it should be.

### 1.5 Single-user knowledge scope (v1)

No cross-user knowledge sharing in v1. The shareable layer is the protocol itself and skills (with personalizations removed). Knowledge stays single-tenant.

### 1.6 AMP defines / backends declare / users informed

AMP defines the full standard (frame schema, operations, profile slots, procedural standard). Each backend's SSA *declares capability coverage* — `native | wrapped | unsupported` per feature. Missing capabilities surface to users as informed gaps, not as failures and not as silent omissions. Backends below minimum compliance are usable but marked experimental.

### 1.7 Falsifiability invariant

Every behavior claim in this spec must have a concrete falsifiable test. Vague claims are insufficient. Specific testable claims are the standard.

---

## 2. The problem AMP solves

> **AMP makes the user's full operational state — knowledge, preferences, intents, procedures — reachable from any model + harness combination they use, with corrections propagating cleanly and memory mutation handled as a first-class operation.**

The failure mode AMP addresses:

1. **State is stranded per surface.** Cursor saves project preferences. Claude Code saves them separately. Codex separately again. None talk to each other. Same fact gets re-captured in each.

2. **Surface state is volatile.** Each harness optimizes for context-window economy. Compaction loses critical information. Users start fresh sessions and re-explain.

3. **Corrections don't propagate.** Correcting one surface doesn't update others. Users correct each surface, every time, forever.

4. **Procedures don't follow the user.** A skill authored in Hermes is unavailable in Claude Code. Cross-harness skill portability requires manual file copying.

5. **Inference defaults don't improve from corrections.** When a system mis-classifies a fact (wrong kind, wrong audience, wrong slot), the correction trains nothing. Same mistake recurs.

### Falsifiable value-prop tests

| # | Change | Falsifiable test |
|---|---|---|
| 1 | Cross-surface visibility | Write a preference in Hermes today. Open Cursor tomorrow. Cursor's agent should know the preference without re-typing. |
| 2 | State preserved past compaction | Let a long Claude.ai conversation compact. Query substrate afterward. Pre-compaction information should be there. |
| 3 | Corrections propagate | Correct Claude Desktop about a fact. Within latency budget, ask Cursor. Cursor should give the corrected answer. |
| 4 | Skills propagate | Author a skill in Hermes. Open Claude Code (compatible harness). Skill should be available without manual install. |
| 5 | Inference improves | Correct the kind classification of N frames over time. The Nth+1 frame of similar shape should be classified correctly without correction. |

---

## 3. The five protocol invariants

These are immutable rules. Any implementation violating one is non-compliant.

### Invariant 1: Scope is never inferred upward

A project-scoped fact does not become user-scoped without explicit user confirmation captured as a separate frame. Frame schema MUST include explicit scope. Project facts stay project facts. User facts only become user facts when the user says so.

### Invariant 2: Injectability is honest

For each storage in each SAS, the `injection_modes` field declares exactly which of the four injection modes AMP can use to write. User-facing layer surfaces this honestly. No claims of propagation to surfaces where injection is impossible.

### Invariant 3: Cloud-bound vendor memory is bounded

ChatGPT's saved memories, claude.ai's saved memories, Cursor cloud sync, etc. are either:
- Read-only via vendor export API where one exists, OR
- Reachable via remote MCP if the surface supports custom connectors, OR
- Manual-paste only via AMP-generated briefings.

AMP never claims to "update vendor X's memory" via a path that doesn't exist.

### Invariant 4: AMP-managed paths are isolated

AMP writes only to `from-amp/` subdirectories within each harness's skill/rule directories. AMP never modifies files outside these subdirectories. User-authored content lives outside them and is never touched.

### Invariant 5: Falsifiable claims only

Every behavior claim has a concrete test that would falsify it.

---

## 4. The four-layer architecture (detailed)

### 4.1 Layer 0 — Model

The LLM that interprets context and acts. Replaceable. Outside AMP's scope; AMP doesn't define this layer.

**Transport up:** none (top of stack)
**Transport down:** provider API (Anthropic, OpenAI, Google, etc.) to Layer 1

### 4.2 Layer 1 — Harness

The agent runtime that brings model and substrate together. Loads skills, manages context, executes tool calls. Replaceable.

**Transport up:** provider API to model
**Transport down to substrate (four locked modes):**
- **Local MCP stdio** — harness and substrate on same machine, MCP over stdio. Real-time, in-session. Used by Claude Desktop, Cursor, Claude Code, Codex CLI for local AMP.
- **Remote MCP** — harness in cloud, substrate exposes public OAuth-protected MCP endpoint. Used by claude.ai web, Cowork.
- **Filesystem-native** — harness writes files (CLAUDE.md, `.cursor/rules/*.mdc`, `skills/*/SKILL.md`); substrate fs-watches. Reverse direction same way: substrate writes to `from-amp/` subdirectories; harness reads on next session.
- **Briefing paste** — degraded mode for surfaces with no programmatic write path. Substrate generates structured briefing; user pastes into harness session.

### 4.3 Layer 2 — Substrate (this is what AMP defines)

Durable. Survives model + harness churn. The substrate is itself decomposed into **four sub-layers**:

**4.3.1 Storage sub-layer**
Hosts the runtime store and the knowledge store (see §5). Talks to Layer 3 (storage backends) via SSAs.

**4.3.2 Inference sub-layer**
Default classifiers for places where the system makes inferences:
- Kind classifier (which kind for new content)
- Curation_mode classifier (which audience)
- Entity extractor (during consolidation)
- Profile slot router (which saved query does this fit)
- Edge type inferrer (typed graph edges)

Each inference layer is a *replaceable component*. v0 ships rule-based defaults. v1 adds correction-corpus feedback. v2 could ship per-user fine-tuned models.

**4.3.3 Consolidation sub-layer**
The "overnight processing" pattern. Runs on idle, schedule, or demand. Processes runtime store contents into knowledge store contents.

Pipeline (ordered):
1. Drain unprocessed episodic from runtime
2. Entity extraction
3. Edge wiring (typed links)
4. Embedding refresh
5. Contradiction detection
6. Decay / pruning
7. Write processed frames to knowledge
8. Clear corresponding runtime entries
9. Write session manifest

**4.3.4 Propagation sub-layer**
Distributes procedural artifacts to harness filesystems. Manages the procedural artifact registry. Triggers when registry changes.

### 4.4 Layer 3 — Storage backends

Pluggable. Where bits actually live. Different deployments swap them.

**Transport (from substrate):** SSA-defined per backend. Examples:
- gbrain → MCP stdio to gbrain's MCP server (→ PGLite / Postgres+pgvector)
- Mem0 → REST API
- Raw filesystem → direct file IO
- Crystals-DB → TBD

### 4.5 Cron jobs at the substrate level

Five substrate-level cron jobs adopted from SOTA patterns (gbrain, OpenClaw):

| Cron | Frequency | Purpose |
|---|---|---|
| Consolidation | Idle-triggered, scheduled, or on-demand | Drain runtime → knowledge per §4.3.3 pipeline |
| Propagation | On registry change | Push procedural artifacts to harness FS |
| Health check | Hourly | Verify harness adapters responsive, runtime healthy, knowledge consistent |
| Decay | Weekly | Identify stale frames, low-confidence facts, orphaned nodes; mark for review/pruning |
| Inference training | Weekly or on-demand | Train inference layer classifiers from correction corpus |

**Cron design rules** (inherited from gbrain):
- Silent when nothing happens
- Idempotent and checkpoint-aware
- Respect quiet hours for user-visible output
- Sub-agents for heavy work; cron stays lightweight
- Every harness signal must funnel through the runtime store (analog of "every ingest must call enrich")

---

## 5. The runtime / knowledge store split

The substrate has **two distinct storage layers** with different access patterns and lifecycles.

### 5.1 Runtime store

Small, fast, transactional. Cache-like. Behaves as a background-job working memory.

**Contents:**
- Active intent (current value)
- Harness health pings
- Propagation queue (skills awaiting distribution)
- Sync state per harness
- Unprocessed episodic signals (raw, pre-consolidation)
- In-flight job state
- Audit log (until flushed to knowledge)

**Lifecycle:** entries cleaned up after consolidation processes them or after expiration. Recoverable from filesystem state and recent episodic if lost.

**Implementation hint:** SQLite by default, with the path configurable by environment or config file. Defaults should follow platform conventions: `$XDG_DATA_HOME/amp/runtime.db` or `~/.local/share/amp/runtime.db` on Linux, `~/Library/Application Support/amp/runtime.db` on macOS. Tests MUST use an isolated temporary path, never a hardcoded user path. Protocol specifies behavior, not implementation.

### 5.2 Knowledge store

The unified knowledge graph. Durable, indexed for retrieval, supports vector + keyword + graph queries.

**Contents:**
- All processed frames (episodic, semantic, crystal)
- All graph edges and embeddings
- Procedural artifact registry (skill metadata)
- Historical intent log
- Post-consolidation timeline entries

**Implementation:** any compliant storage backend (gbrain is the reference). Backend declares which AMP features it supports via SSA `capability_coverage`.

### 5.3 The bridge: consolidation

Raw signals arrive in runtime store. Consolidation cron processes them into knowledge. Once processed, runtime entries are cleared. This mirrors the biological sleep/replay pattern: episodic signals throughout the day, structured knowledge consolidated during quiet periods.

---

## 6. The frame layer (Layer A — Wire Protocol, knowledge side)

### 6.1 Frame kinds — LOCKED (three kinds)

| Kind | Semantics | Mutation model | Example |
|---|---|---|---|
| **episodic** | Events that happened | Append-only, immutable once written | "Met Aurora on May 22 at Prosus event" |
| **semantic** | Stable facts about the world | Mutable via supersedes; carries optional `valid_from`/`valid_until` | "Aurora works at company X" |
| **crystal** | Falsifiable claims about regularities of the environment (physics, mechanical, structural-of-designed-systems) | Refined via conditions, scope-narrowing, accruing refutations | "Throwing glass on hard surfaces breaks it"; "Transformer attention is O(n²) under standard attention" |

**Crystal definition (sharpened):** falsifiable claims about regularities of the environment OR of designed systems (algorithms, software, hardware behaviors). NOT for claims about humans or social systems — those are semantic with confidence_basis.

**Why three kinds and not four:** profile is not a separate kind (it's saved queries over primitives — see §8). Intent is not a kind (current intent is runtime state; history is episodic). Correction is not a kind (it's an episodic frame with `correction_of` field). Procedural is not a frame at all (separate artifact type — see §9).

### 6.2 Frame schema (universal core)

Required fields on every frame:

```yaml
id: string                    # globally unique
kind: enum [episodic, semantic, crystal]
content: string | structured  # the actual claim
source: provenance_block      # where this came from
created_at: ISO8601
scope: enum [project, user, universal] + optional project_ref
curation_mode: enum [personal, llm_curated, shared]
```

Optional but commonly present:

```yaml
valid_from: ISO8601
valid_until: ISO8601 | null
supersedes: [frame_id]
superseded_by: frame_id
confidence: float [0..1]
confidence_basis:
  type: enum [experience_confidence, source_attestation, deductive, direct_statement]
  iterations: integer
  observation_period: { first: ISO8601, most_recent: ISO8601 }
  notes: string
kind_provenance:
  default_inferred: kind
  default_basis: string
  user_override: kind | null
  override_reason: string | null
  final_kind_source: enum [default, user_override]
correction_of: frame_id       # episodic only; marks this as a correction event
```

Kind-specific extensions:

**Crystal:**
```yaml
conditions: [structured]      # under what conditions does the claim hold
refutations: [refutation_ref] # specific cases where the claim failed
refinement_history: [ref]     # chain of refinements
```

### 6.3 Operations

Six core operations on the knowledge store:

- `write(frame)` — write a frame in AMP wire format
- `read(id)` — read a single frame
- `search(query, filters, mode)` — search; modes: vector, keyword, graph, hybrid
- `mutate(id, changes)` — supersedes, scope-narrow, refinement per kind rules
- `list(filter)` — list frames matching filter
- `capabilities()` — query backend's capability coverage

Plus runtime store operations (smaller surface):
- `runtime.set(key, value)` / `runtime.get(key)` / `runtime.delete(key)`
- `runtime.queue.push(item)` / `runtime.queue.pop()` / `runtime.queue.peek()`

Plus transaction primitive (required for multi-primitive writes when the backend declares support):
- `transaction.begin()` / `transaction.commit()` / `transaction.rollback()`

**v1 gbrain status:** the reference SSA declares `transactions: unsupported` in `ssa-files/gbrain.yaml`. The gbrain adapter returns honest unsupported errors for all three transaction methods. Multi-page writes therefore have **no atomic commit** — a partial failure can leave orphan pages (e.g. frame written but companion metadata page not). Callers must treat consolidation and propagation writes as **idempotent** and safe to retry; operators should use `amp doctor` and gbrain list/search to detect and reconcile orphans. Transaction contract types exist in `src/amp/adapter-contract/transaction-contract.ts` for backends that later declare `transactions: native | wrapped`.

### 6.4 Default-with-override for kind classification

AMP infers a default kind from content + source + context. User can override per-frame. Both inferred and override stored in `kind_provenance`. Disagreement is training signal for the inference layer.

Same pattern for curation_mode classification.

---

## 7. The unified knowledge graph with curation_mode

### 7.1 The three curation_mode values — LOCKED

```yaml
curation_mode: enum [personal, llm_curated, shared]
```

- **`personal`** — user-symbiosis content. Scope-strict. Invariant 1 applies. Default for new frames.
- **`llm_curated`** — Karpathy-style LLM wiki content. Distilled, may be reframed across sources. Different curation discipline (distillation allowed).
- **`shared`** — accessible to both consumer contexts. Rare; explicit user opt-in.

Substrate-internal state does NOT use a curation_mode value — it lives in the runtime store entirely (see §5.1), not in the knowledge graph.

### 7.2 Routing as query filter (not cross-DB dispatch)

Under the unified-graph architecture, curation_mode is a property on every node. The "audience router" is a **query filter layer**, not a multi-backend dispatcher.

- **Read**: queries default to filtering by current consumer context (a harness querying "user context" defaults to `personal` ∪ `shared`; a harness querying "background knowledge" defaults to `llm_curated` ∪ `shared`). Explicit override always allowed.
- **Write**: frame's curation_mode determines write-side gate (personal goes through scope-strict validation; llm_curated through distillation gate).
- **Cross-mode references**: edges can span curation_modes freely. Query traversal follows edges regardless of mode; the filter only applies to the *root scope* of the query.

### 7.3 Single backend for v1

v1 assumes one logical knowledge store per deployment. Multi-store federation deferred to v2. The `curation_mode` property is forward-compatible: it can later drive cross-backend routing without protocol changes.

### 7.4 Hybrid retrieval (locked)

SOTA pattern adopted from gbrain and similar systems:

```
Query → intent classifier → multi-query expansion 
      → vector search (HNSW cosine) + keyword search (tsvector) 
      → Reciprocal Rank Fusion 
      → cosine re-scoring 
      → graph-aware boosting (backlinks, edge proximity) 
      → optional cross-encoder rerank for top-K 
      → results
```

The substrate ships with this pipeline. Backends declare which steps they can support natively (a backend without vector support degrades to keyword + graph; users informed of reduced capability).

---

## 8. Profile as saved queries over primitives

### 8.1 The model

Profile slots are **named saved queries** over the substrate's primitives (frames + graph + runtime). They are NOT a separate type system or kind.

Each slot declares:
- Name (e.g., `reading_list`, `active_intent`, `relationships`, `strategic_goals`, `identity`)
- Return type (single value, ordered list, graph, structured aggregation)
- Item schema (typed return shape)
- Underlying query (filter/sort/project over frames, graph traversal, runtime read)

### 8.2 Why this works (pressure-test result)

All five attacks against this proposal failed to refute it (see review log). Two requirements surfaced:
1. Saved queries must be polyglot (can target frames, graph, or runtime — sometimes within one query)
2. Substrate needs transaction primitives for multi-primitive writes

Both are accepted additions.

### 8.3 What slots look like at the user-facing surface

```yaml
profile_slot_registry:
  reading_list:
    return_type: ordered_list
    item_schema:
      title: string
      authors: [string]
      status: enum [to-read, reading, read, abandoned]
      ref: optional_node_id
    underlying_query: |
      semantic_frames where type='reading-list-item' and scope='user' 
      order by created_at
  
  active_intent:
    return_type: single_value
    value_schema:
      description: string
      horizon: enum [moment, current-week, current-quarter, strategic]
      started_at: ISO8601
    underlying_query: |
      runtime_registry.active_intent
  
  relationships:
    return_type: graph
    underlying_query: |
      graph traversal from user_node where edge_type in [...]
```

Harnesses see typed slots with declared schemas. They never see the underlying query. The substrate executes and materializes.

### 8.4 Extensibility

Users can add new slots by registering new saved queries. Simple slots (filter + sort) are trivially extensible. Aggregations require query language richness. Complex operations (ML inference per slot) require future query language extensions.

v1 query language supports: filter, sort, project, graph traversal, runtime lookups, simple aggregations (count, sum, latest).

---

## 9. Procedural artifacts — adopting the Agent Skills standard

### 9.1 AMP adopts the existing standard through harness compilers

The Agent Skills open standard already exists as of 2026. Claude Code and Codex CLI support the SKILL.md-style artifact directly; Cursor has its own `.mdc` rules format; Gemini CLI supports extension-bundled skills but its exact AMP placement is provisional until tested. AMP does NOT treat these as identical filesystem formats. AMP stores a canonical procedural artifact and compiles it into harness-specific emitted artifacts.

### 9.2 The canonical procedural artifact

```yaml
# File: <skill-name>/SKILL.md
---
# Core Agent Skills fields (universal across all adopters)
name: "skill-name"            # globally unique within scope
description: "When and what this skill does — load-bearing for trigger matching"

# Common extensions (used by gbrain, Claude Code, others)
version: "0.1.0"
triggers: ["natural-language phrase 1", "phrase 2"]
tools: [string]
mutating: boolean
writes_pages: boolean
writes_to: [string]

# AMP-specific extensions
amp_artifact_version: "1.0"
scope: "user" | "project" | "shared"
curation_mode: "personal" | "llm_curated"
amp_compatibility:
  min_amp_version: "1.0"
  required_frame_kinds: ["semantic"]
  required_profile_slots: ["active_intent"]
  required_audiences: ["personal"]
harness_compatibility:
  supported_harnesses: ["any" | "claude-code" | "cursor" | "hermes" | ...]
  injection_path: "filesystem-native" | "mcp" | "either"
harness_overlays:
  cursor:
    globs: ["**/*.md"]
    alwaysApply: false
  claude_code: {}
  gbrain:
    resolver_priority: 3
extends: [skill-name]
required_by: [skill-name]
conflicts_with: [skill-name]
---

# Skill body (markdown — universal across all adopters)
```

### 9.3 Harness compiler model

The canonical AMP procedural artifact is the source of truth. Harness-specific files are emitted build artifacts:

- **Canonical source**: AMP-managed skill metadata + Markdown body in the procedural registry.
- **Cursor compiler output**: `.cursor/rules/from-amp/SKILL_NAME.mdc`, with Cursor frontmatter (`description`, `globs`, `alwaysApply`) derived from `harness_overlays.cursor`.
- **Claude Code compiler output**: `<base>/from-amp/SKILL_NAME/SKILL.md`, preserving the canonical Agent Skills shape.
- **Other harness compiler outputs**: generated only after the harness placement and load semantics have been directly verified.

Emitted files are replaceable cache artifacts. User-authored files outside `from-amp/` are never mutated.

### 9.4 Per-harness placement (validated or provisional)

| Harness | Skill location | Subdirectory | AMP-managed path |
|---|---|---|---|
| Claude Code | `~/.claude/skills/` or `.claude/skills/` | Yes (per-skill folder) | `<base>/from-amp/SKILL_NAME/SKILL.md` |
| Cursor | `.cursor/rules/` | Yes (subdirs supported) | `.cursor/rules/from-amp/SKILL_NAME.mdc` (note: flat .mdc not folder) |
| Codex CLI | Agent Skills support verified via OpenAI docs/repo | Yes | `<base>/from-amp/SKILL_NAME/SKILL.md` after local placement verification |
| Gemini CLI | Extension-bundled skills supported; exact AMP placement provisional | TBD | Do not implement in v1 unless directly tested |
| Hermes / OpenClaw / gbrain | `skills/` | Yes (gbrain pattern) | `skills/from-amp/SKILL_NAME/SKILL.md` |

**Invariant 4 enforced:** AMP writes only to `from-amp/` subdirectories. User-authored content lives elsewhere and is never touched.

### 9.5 Procedural artifact registry

The substrate maintains a registry (in knowledge store with `curation_mode: personal`) of all known procedural artifacts:
- Name, version, description, triggers
- AMP compatibility metadata
- Harness compatibility
- Last-synced timestamps per target harness
- Relationships (extends, required_by, conflicts_with)

The registry is what the substrate indexes for cross-harness discovery and conflict detection.

### 9.6 Propagation lifecycle (compiler model)

When the registry changes:
1. Substrate identifies target harnesses per `harness_compatibility.supported_harnesses`
2. For each target, the harness compiler emits the correct harness-native artifact
3. Cursor target emits `.mdc` with flat naming
4. Claude Code target emits folder-per-skill with SKILL.md
5. Substrate logs propagation success/failure per target
6. Conflicts (two skills with overlapping triggers) flagged in registry; user notified

Harness-specific overlays as separately stored variants are documented as a planned v2 extension.

### 9.7 Skill body portability

Universal: the file format is portable.
Not universal: skill bodies that rely on harness-specific primitives (`@codebase` in Cursor; specific gbrain CLI commands) only execute on harnesses supporting those primitives. The `harness_compatibility.supported_harnesses` field declares which are supported.

For maximum portability, skills should be written against universal primitives. Skills using harness-specific primitives are scoped to compatible harnesses.

### 9.8 Verified-only adapter scope

v1 verified scope (offline, acceptance-gated via `npm run amp:acceptance`):

| Role | Adapter | Verified scope |
|---|---|---|
| SAS (surface) | Cursor | Filesystem emit to `.cursor/rules/from-amp/`; path guards; `.mdc` compiler |
| SAS (surface) | Claude Code | Filesystem emit to `<base>/from-amp/SKILL.md`; path guards |
| SAS (surface) | Hermes | Filesystem emit to `skills/from-amp/<skill>/SKILL.md`; path guards |
| SSA (substrate) | gbrain | MCP page-tool mapping with fake/in-memory transport in CI; live `gbrain serve` is PROVISIONAL |

**Out of v1 verified scope:** Codex, Gemini, Windsurf, OpenClaw, and other harness adapters — placement and load behavior not verified in the implementation environment. SAS YAML stubs may exist; they are not acceptance-gated until verified.

Acceptance exclusions and residual risks are documented in `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md` and enforced by `src/amp/conformance/acceptance-gate.ts`.

---

## 10. Adapter Contract (unified — replaces SAC/SSC)

### 10.1 One contract, role declaration

The earlier draft described two adapter contracts (SAC for surfaces, SSC for substrates). Pressure-testing showed the distinction is notational, not structural. Layer B is now **one unified Adapter Contract** with a `role` field: `surface | substrate | both`.

### 10.2 Contract operations

```typescript
interface AdapterContract {
  // Identity
  discover(): SAS | SSA | { sas: SAS, ssa: SSA }  // role-dependent
  verify(): VerifyResult                              // run verificationSteps
  capabilities(): CapabilityCoverage                  // declares what's supported
  
  // Data operations (frames + graph + runtime)
  read(scope: 'runtime' | 'knowledge', filter: Filter): Item[]
  write(scope: 'runtime' | 'knowledge', items: Item[]): WriteResult
  search(query: Query, filters?: Filter, mode?: SearchMode): RankedResult[]
  mutate(id: ItemId, changes: MutationOp): MutationResult
  list(filter?: Filter): Item[]
  
  // Subscription
  subscribe(scope: Scope, callback: Callback): Subscription
  
  // Transactions (required for multi-primitive writes)
  transactionBegin(): TransactionHandle
  transactionCommit(handle: TransactionHandle): CommitResult
  transactionRollback(handle: TransactionHandle): void
}
```

### 10.3 Capability coverage block (in SSA / SAS)

```yaml
capability_coverage:
  frame_kinds:
    episodic: native
    semantic: native
    crystal: wrapped         # implemented via metadata wrapping
  curation_mode: native
  vector_search: native
  graph_traversal: native
  transactions: wrapped
  embedding_storage: native
  full_text_search: native
  profile_slots: native
  procedural_registry: unsupported   # this backend can't serve as registry
```

Three values:
- **`native`** — backend supports this directly
- **`wrapped`** — backend supports via AMP-side wrapping or sidecar
- **`unsupported`** — capability unavailable with this backend

### 10.4 Compliance tiers

- **Fully compliant** — all native, no degradations
- **Minimally compliant** — frame storage, basic query, curation_mode (native or wrapped); other features may be unsupported
- **Experimental** — below minimum compliance; usable but with significant gaps; user explicitly informed

The substrate runs against any backend at any tier, surfacing capability gaps to users as informed messages, not failures.

### 10.5 Two spec types remain

Layer C still has two declarative spec types:
- **SAS** (Surface Adapter Spec) — describes a surface (Cursor, Hermes, OpenClaw, Claude Code, …)
- **SSA** (Substrate Storage Adapter spec) — describes a storage backend (gbrain, Mem0, Cognee, …)

Specs are data. The contract is code. Dual-role tools (OpenClaw, Hermes) get both a SAS and an SSA describing different concerns of the same underlying software.

---

## 11. Three deployment shapes

### 11.1 Shape A — local-only

- Substrate: local with consolidation daemon
- Target surfaces over time: local harnesses such as Cursor, Claude Code, Codex, Hermes, OpenClaw, and Claude Desktop via local MCP. v1 verified offline: Cursor, Claude Code, and Hermes filesystem adapters (see §9.8).
- Coverage gap: claude.ai web, Cowork, ChatGPT cloud → briefing-only
- Network requirement: none
- Daemon required: yes (for consolidation, propagation, health, decay, inference training)

### 11.2 Shape B — hybrid (local + remote MCP gateway)

- Same substrate as Shape A
- Plus: AMP exposes public-internet OAuth-protected MCP endpoint
- Surfaces integrated: all of Shape A plus claude.ai web, Cowork
- Coverage gap: ChatGPT cloud → still briefing-only
- Daemon required: yes

### 11.3 Shape C — briefing-only

- No daemon, no fs-watcher, no MCP server
- AMP runs as CLI library
- User triggers briefing generation on demand
- **No consolidation, no health monitoring, no active intent registry, no inference training, no propagation**
- Use case: users not running a daemon, or only using cloud surfaces
- Spec is honest about reduced functionality

### 11.4 Architectural commitments

1. Substrate works standalone (library not just daemon)
2. Remote MCP endpoint is opt-in infrastructure
3. Mode transitions non-destructive (Shape A → Shape B doesn't require data migration)

---

## 12. The five gaps addressed in v2 spec update

### 12.1 Error model

JSON-RPC 2.0 error semantics. AMP-specific codes:

| Code | Meaning | Retriable |
|---|---|---|
| -32001 | substrate offline | yes after backoff |
| -32002 | frame schema mismatch | no |
| -32003 | surface inject failure | yes with degraded mode |
| -32004 | transport timeout | yes |
| -32005 | concurrent write conflict | yes with conflict resolution |
| -32006 | partial federation failure | partial — return what succeeded |
| -32007 | transaction rollback | depends on cause |
| -32008 | capability not supported by backend | no — surface to user |
| -32009 | runtime queue full | yes after consolidation |
| -32010 | propagation target unreachable | yes |

### 12.2 Versioning strategy

- **Protocol version** — semver. v1.x is forward-compatible within major version.
- **Frame schema version** — embedded in frame. Older frames readable indefinitely.
- **SSA version** — semver per backend. Substrate negotiates compatible operations.
- **SAS version** — semver per surface. Substrate adjusts inject behavior to declared version.
- **Procedural artifact version** — per `version` field. Substrate tracks across updates.

Mismatches: substrate runs against any declared version it supports, surfaces feature gaps to user.

### 12.3 Trust boundaries

- **Skills from AMP-managed paths are trusted by the harness** (the user installed AMP; AMP only writes to `from-amp/`)
- **Skills from elsewhere in the harness's skill directory are user-authored** — outside AMP's purview
- **AMP-propagated skills carry source provenance** — which user, which substrate instance, which version
- **The substrate validates AMP-managed paths exist and are writable before propagation**
- **The substrate never writes outside `from-amp/`** (Invariant 4)

Conflict detection prevents two skills with the same name in `from-amp/` and outside `from-amp/` from triggering on the same input; if conflict detected, substrate flags rather than silently overriding.

### 12.4 Backup / export / migration

- **Export format**: AMP wire format (frames + graph + registry) serialized as JSONL. Profile slot definitions and runtime state (minus ephemeral) included.
- **Import**: reverse. Substrate accepts AMP export, populates knowledge store, validates schema.
- **Backend migration**: `amp migrate --from <source-ssa> --to <target-ssa>`. Export from source via SSA, import into target via SSA. Capability gaps surface during validation.
- **Backup**: storage backend's native backup (gbrain has its own; Mem0 has its own) plus AMP-managed JSONL snapshot of runtime + procedural registry.

### 12.5 Shared curation_mode operational spec

`shared` is used when:
- A fact is explicitly user-curated AND meant to be available in both personal-context queries (this is something true about my world) AND llm-curated-context queries (this is general-purpose knowledge)
- The user has explicitly opted to share an item to the LLM-curated layer for future reference

Operational rules:
- Frames default to `personal`. Promoting to `shared` requires explicit user action.
- Once promoted, a frame is queryable from both contexts.
- Demoting from `shared` requires explicit user action; the substrate doesn't auto-demote.

---

## 13. Open questions (deferred)

In priority order:

### 13.1 Active intent storage — runtime vs. profile slot ✓ RESOLVED

Current: runtime store. Historical: knowledge store via profile slot saved query. Strategic: profile schema slot. **Resolved per runtime/knowledge split.**

### 13.2 Procedural lifecycle operations (v2)

Versioning of skills, deprecation propagation, conflict resolution between skills with overlapping triggers, dependency resolution between skills (extends, required_by). v1 ships basic conflict detection (flagging); v2 ships full lifecycle.

### 13.3 Multi-device sync (v2)

User with AMP on two machines (laptop + desktop). gbrain handles via Supabase. AMP needs its own story. Deferred — most users single-device for v1.

### 13.4 The gbrain entity pages relationship (one paragraph in spec)

gbrain has rich entity pages (people, companies). AMP's profile slots (relationships, identity) query against gbrain's storage. Slots are *views* over gbrain's pages, not separate storage. The reading_list slot follows the same pattern: an ordered query over gbrain pages tagged appropriately.

### 13.5 Multi-store federation (v2)

When project is more solid. Cross-backend operations, conflict resolution across backends, sync primitives. Not v1.

### 13.6 Naming

Working name: AMP. Candidates: AMP, PMP, MCP-Memory, continuity-protocol-something, substrate-protocol-something. Not blocking. Decided later.

### 13.7 Adversarial pressure-test on new structural additions

Three substrate sub-layers (inference, consolidation, propagation) and the runtime/knowledge split are new in v2. They should receive the same five-attack treatment that three-kinds and profile-as-saved-query received before being treated as locked.

### 13.8 Correction lookup table schema

The v1 feedback loop may use deterministic per-user correction lookup tables before model fine-tuning. The exact persisted representation is not locked. Default: store each correction as an episodic frame with `correction_of`, classifier name, previous output, corrected output, and context fingerprint; derive lookup tables as runtime indexes during consolidation.

### 13.9 Vertical-slice kill criterion

The first implementation milestone is a single falsifiable vertical slice: create a scoped preference in one local harness, consolidate it, retrieve it in another local harness, and prove invariant checks fired. If this vertical slice is not working after two focused implementation weeks, pause and reassess whether the substrate abstraction is earning its complexity.

---

## 14. Calibration signals (for next conversation)

### 14.1 User discipline

User (T) is a research scientist with falsifiability discipline. Every claim should be testable. Sycophancy and over-claiming have cost time. Restate, run against literature, apply falsifiability and hard-to-vary tests, label established vs synthesis vs speculation.

### 14.2 Hardware constraint

Old Samsung laptop, CPU-only, no dedicated GPU. Most architectural decisions default to local-first.

### 14.3 Non-developer reachability

AMP must be useful for non-developers too. The product layer matters. One-click install for non-technical users is a deferred but real requirement.

### 14.4 User pushbacks that shaped this spec

1. Generalized scope inference → Invariant 1
2. Implied cross-system propagation that wasn't possible → Invariant 3
3. Defaulted to MCP without examining other transports → four injection modes
4. Two-DB architecture forgotten then recovered → unified graph with curation_mode
5. Three-layer model forgotten then recovered → §1.1 lead framing
6. Skills are AMP's concern (not out-of-scope) → §9 first-class treatment
7. Universal SKILL.md was already a standard → §9.1 adopt-not-invent
8. AMP imposes vs adapts (wrong direction both ways) → §1.6 informed-gaps model
9. RL feedback loop must be in scope → §4.3.2 inference sub-layer

Each pushback corrected a real overreach. The pattern: the falsifiability discipline catches errors. The user does the work.

### 14.5 Information-loss pattern

Principles stated once tend to drop. Principles in the lead framing or marked as commitments survive. The §1 architectural commitments section exists because this pattern is consistent. Future updates should preserve §1 first.

---

## 15. How to use this document in the next conversation

1. Read §1 (architectural commitments) and §14 (calibration) first
2. Confirm the locked decisions still feel right
3. Move to §13 open questions in priority order
4. Start with §13.7 — pressure-test the new structural additions
5. Treat locked decisions as locked unless a new reason emerges
6. Update this document at end-of-conversation if anything changes

---

*End of v2 specification. Generated 24 May 2026.*
