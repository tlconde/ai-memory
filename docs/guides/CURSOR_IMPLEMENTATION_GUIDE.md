# AMP Implementation Guide — for Cursor

> **Audience:** Cursor (the IDE agent) working on the AMP codebase
> **Purpose:** Onboard Cursor to the AMP architecture and provide a concrete starting point for implementation work
> **Companion document:** AMP-CONSOLIDATED-SPEC.md (the protocol spec — read this first)

---

## What you're implementing

**AMP (Agent Memory Protocol)** is a substrate protocol that sits between AI models/harnesses and storage backends. It carries:
- Knowledge (frames: episodic, semantic, crystal)
- User profile (saved queries over primitives)
- Procedures (skills, adopting the Agent Skills standard)
- Active intent + operational state (runtime layer)

You are implementing the **reference implementation** of AMP. Other implementations are encouraged later; this is the canonical one.

## What you are NOT implementing

- A new memory storage system (we use gbrain as the reference storage backend)
- A new skills format (we adopt the Agent Skills open standard)
- A new transport (we use MCP, fs-watch, and briefing — all existing)
- A new model or agent runtime (those are Layer 0 and Layer 1; we are Layer 2)

## Hard constraints

- **Local-first.** Old Samsung laptop, CPU-only, no GPU. Cloud features (Shape B) are optional opt-in.
- **Single-user (v1).** No multi-tenant. No knowledge sharing across users (skills are shareable; knowledge is not).
- **Adopt, don't invent.** Use existing standards (MCP, Agent Skills, JSON-RPC 2.0, hybrid retrieval patterns from gbrain).

---

## Architecture you're implementing

```
Layer 0 — MODEL       (we don't touch this)
Layer 1 — HARNESS     (we read from/write to these via MCP and FS)
Layer 2 — SUBSTRATE   (THIS IS WHAT WE BUILD)
  ├── Storage sub-layer (runtime store + knowledge store)
  ├── Inference sub-layer (kind classifier, etc.)
  ├── Consolidation sub-layer (the overnight processor)
  └── Propagation sub-layer (skill distribution)
Layer 3 — STORAGE     (gbrain, Mem0, etc. — we plug into these)
```

### Sub-layer ownership

**Storage sub-layer** owns:
- Runtime store implementation (SQLite; configurable path; platform user-data default)
- Knowledge store interface (calls out to storage backend via SSA)
- Transaction primitives

**Inference sub-layer** owns:
- Kind classifier (default rule-based; later: learned from corrections)
- Curation_mode classifier
- Entity extractor (called during consolidation)
- Profile slot router
- Edge type inferrer

**Consolidation sub-layer** owns:
- The consolidation cron job
- The 9-step pipeline (drain → extract → wire → embed → detect → decay → write → clear → manifest)
- Idempotency / checkpoint management
- Quiet-hours respect

**Propagation sub-layer** owns:
- Procedural artifact registry (in knowledge store with curation_mode=personal)
- Watching for registry changes
- Compiling canonical AMP skill artifacts into harness-native emitted files under `from-amp/`
- Conflict detection across harnesses
- Cursor's `.mdc` compiler output (frontmatter mapping + flatter naming)

---

## Implementation order (suggested)

**Don't implement everything at once.** This is the suggested phasing.

### Phase 0 — Vertical-slice foundation (build first)

Goal: prove one falsifiable end-to-end claim before broadening the architecture.

**Claim:** A scoped preference created from one local harness can be captured as a frame, consolidated into the knowledge store, retrieved by another local harness, and protected by the scope and `from-amp` invariants.

1. Project scaffolding in the existing TypeScript repo
2. Frame schema validation (Zod or similar) with conformance IDs for every invariant
3. Configurable runtime store path and isolated test path
4. Minimal knowledge store adapter sufficient for the vertical slice
5. Capability coverage block parser
6. JSON-RPC 2.0 error response infrastructure
7. Cursor + Claude Code filesystem adapter skeletons with path-safety guards
8. One end-to-end test: Cursor-style scoped preference -> runtime queue -> consolidation -> Claude Code retrieval

### Phase 1 — Storage sub-layer (single backend)

1. Runtime store (SQLite; env/config override; user-data default)
2. SSA loader (read SSA YAML files, validate)
3. gbrain SSA implementation (talks to gbrain via MCP stdio)
4. The six core operations against gbrain (write, read, search, mutate, list, capabilities)
5. Transaction primitive against gbrain
6. Runtime queue primitive

### Phase 2 — Harness adapters (start with two verified adapters)

1. Claude Code SAS + adapter (filesystem-native; read `CLAUDE.md` and `~/.claude/skills/`; write to `from-amp/` subdirectory)
2. Cursor SAS + adapter (filesystem-native; read `.cursor/rules/*.mdc`; write to `.cursor/rules/from-amp/*.mdc`)
3. Local MCP server endpoint for Claude Desktop integration

Do not implement Codex, Gemini, Windsurf, or other harness adapters in v1 unless their placement and load behavior are directly verified in the implementation environment.

### Phase 3 — Substrate sub-layers

1. Inference sub-layer with rule-based classifiers (no learning yet)
2. Consolidation cron job with the 9-step pipeline
3. Propagation cron job (registry watch + file writes)
4. Health check cron
5. Decay cron (weekly)

### Phase 4 — Profile schema

1. Saved query registry
2. The five core profile slots (reading_list, active_intent, relationships, strategic_goals, identity)
3. Cross-layer queries (frame + runtime polyglot)

### Phase 5 — RL feedback (the inference layer's learning loop)

1. Correction frame schema (episodic with `correction_of`, classifier name, previous output, corrected output, and context fingerprint)
2. Correction corpus collection
3. Per-classifier training data extraction and deterministic per-user lookup table generation
4. Inference training cron job
5. Versioned classifier deployment

### Phase 6 — Shape B (remote MCP)

1. Public OAuth-protected MCP endpoint
2. Bearer token management
3. Tunnel documentation (ngrok / Cloudflare Tunnel / Tailscale Funnel)

### Phase 7 — Briefing format

1. Short-form briefing generator (~150-300 words for ChatGPT etc.)
2. Long-form briefing generator (cross-session handoff format)
3. `amp brief --for <surface> [--long]` CLI

---

## File / directory structure (proposed)

```
amp/
├── README.md
├── AMP-CONSOLIDATED-SPEC.md       (the protocol)
├── package.json
├── bun.lock
├── tsconfig.json
│
├── src/
│   ├── core/                       (Layer A: wire protocol + schema)
│   │   ├── frame-schema.ts
│   │   ├── operations.ts
│   │   ├── errors.ts
│   │   └── transactions.ts
│   │
│   ├── adapter-contract/           (Layer B: unified contract)
│   │   ├── contract.ts
│   │   ├── capability-coverage.ts
│   │   └── role.ts
│   │
│   ├── ssa/                        (Layer C: SSA loading)
│   │   ├── ssa-loader.ts
│   │   ├── ssa-validator.ts
│   │   └── ssa-schema.yaml
│   │
│   ├── sas/                        (Layer C: SAS loading)
│   │   ├── sas-loader.ts
│   │   ├── sas-validator.ts
│   │   └── sas-schema.yaml
│   │
│   ├── adapters/                   (Layer D: actual adapters)
│   │   ├── ssa/
│   │   │   ├── gbrain/
│   │   │   ├── mem0/                (v2)
│   │   │   └── raw-fs/
│   │   └── sas/
│   │       ├── claude-code/
│   │       ├── cursor/
│   │       ├── hermes/
│   │       ├── openclaw/
│   │       └── codex/
│   │
│   ├── substrate/                  (Layer 2 sub-layers)
│   │   ├── storage/
│   │   │   ├── runtime-store.ts
│   │   │   └── knowledge-store.ts
│   │   ├── inference/
│   │   │   ├── kind-classifier.ts
│   │   │   ├── curation-mode-classifier.ts
│   │   │   ├── entity-extractor.ts
│   │   │   ├── slot-router.ts
│   │   │   └── edge-type-inferrer.ts
│   │   ├── consolidation/
│   │   │   ├── consolidation-cron.ts
│   │   │   └── pipeline.ts
│   │   └── propagation/
│   │       ├── registry.ts
│   │       ├── propagation-cron.ts
│   │       └── conflict-detector.ts
│   │
│   ├── profile/                    (saved queries over primitives)
│   │   ├── slot-registry.ts
│   │   ├── query-engine.ts
│   │   └── slots/
│   │       ├── reading-list.ts
│   │       ├── active-intent.ts
│   │       ├── relationships.ts
│   │       ├── strategic-goals.ts
│   │       └── identity.ts
│   │
│   ├── procedural/                 (skills handling)
│   │   ├── registry.ts
│   │   ├── propagator.ts
│   │   └── cursor-mdc-converter.ts
│   │
│   ├── transport/
│   │   ├── local-mcp/
│   │   ├── remote-mcp/
│   │   ├── fs-watch/
│   │   └── briefing/
│   │
│   └── cli/
│       ├── amp.ts                   (main entry)
│       ├── consolidate.ts
│       ├── brief.ts
│       ├── migrate.ts
│       └── doctor.ts
│
├── ssa-files/                       (declarative SSA specs)
│   ├── gbrain.yaml
│   ├── mem0.yaml
│   └── raw-fs.yaml
│
├── sas-files/                       (declarative SAS specs)
│   ├── claude-code.yaml
│   ├── cursor.yaml
│   ├── hermes.yaml
│   ├── openclaw.yaml
│   └── codex.yaml
│
├── conformance/                     (conformance test suite)
│   ├── runner.ts
│   ├── frame-roundtrip.test.ts
│   ├── curation-mode-roundtrip.test.ts
│   ├── mutation-semantics.test.ts
│   └── capability-coverage.test.ts
│
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
└── docs/
    ├── ARCHITECTURE.md
    ├── SSA-AUTHORING.md
    ├── SAS-AUTHORING.md
    └── SKILL-AUTHORING.md
```

---

## Cursor-specific notes for working in this codebase

### Reading order on first session

1. `AMP-CONSOLIDATED-SPEC.md` — the protocol (lengthy but load-bearing)
2. `src/core/frame-schema.ts` — the shape of everything
3. `src/adapter-contract/contract.ts` — what every adapter implements
4. `ssa-files/gbrain.yaml` — what an SSA looks like
5. `sas-files/cursor.yaml` — what your own SAS looks like (Cursor reading itself)

### What goes where (the resolver)

Before creating any new file, ask:
- Is this **wire protocol** (frames, schema, errors)? → `src/core/`
- Is this **contract** (interface every adapter implements)? → `src/adapter-contract/`
- Is this an **SSA or SAS spec file** (declarative YAML)? → `ssa-files/` or `sas-files/`
- Is this an **adapter** (code implementing the contract for a specific tool)? → `src/adapters/`
- Is this **substrate logic** (the four sub-layers)? → `src/substrate/<sublayer>/`
- Is this **profile** (saved queries)? → `src/profile/`
- Is this **procedural** (skills handling)? → `src/procedural/`
- Is this **transport** (MCP, fs-watch, briefing)? → `src/transport/`

### Conventions

- TypeScript strict mode
- Bun as runtime (per gbrain's choice)
- Zod for runtime schema validation
- No `any` — use `unknown` or define types
- Every public function has a JSDoc comment with the falsifiable behavior it implements
- Tests: unit + integration + e2e (per gbrain's pattern)
- Conformance suite is separate from regular tests

### Pre-existing patterns to follow

Look at gbrain's repo (github.com/garrytan/gbrain) for:
- Skill structure (`skills/<name>/SKILL.md` with frontmatter)
- Cron orchestration pattern (silent-when-no-work, idempotent, checkpointed)
- MCP server structure
- The auto-link extraction pattern (zero LLM calls on writes)
- The compiled-truth + timeline pattern for entity pages
- Diff-protected file writes (skillpack install pattern)

### Cursor working in its own integration

When you write the Cursor SAS and adapter, you'll be writing the spec for *yourself*. This is deliberate. The Cursor adapter should:
- Read `.cursor/rules/*.mdc` files (the user-authored rules)
- Read `.cursor/rules/from-amp/*.mdc` files (AMP-managed)
- Write only to `.cursor/rules/from-amp/` (Invariant 4)
- Compile AMP's canonical procedural artifact to Cursor's `.mdc` format on write
- Import Cursor's `.mdc` rules into AMP's canonical artifact model only when the user explicitly chooses to propagate them to other harnesses

The `.mdc` format is YAML frontmatter + Markdown with Cursor-specific fields: `description`, `globs`, `alwaysApply`. AMP's Cursor compiler writes those fields from the canonical artifact's `harness_overlays.cursor` block during emission.

### Open issues you may encounter

1. **The runtime store's exact shape isn't locked.** Use SQLite for v1. The path must be configurable by env/config, defaulting to `$XDG_DATA_HOME/amp/runtime.db` or `~/.local/share/amp/runtime.db` on Linux and `~/Library/Application Support/amp/runtime.db` on macOS. Tests must use an isolated temporary path.

2. **The consolidation pipeline's entity extractor needs a model.** v0 ships rule-based (regex + heuristics). v1 may invoke Claude Haiku or similar for harder cases. Hardware-constrained — keep model calls bounded.

3. **The inference layer's training mechanism is not yet locked.** v1 ships rule-based defaults. Feedback should first produce deterministic per-user lookup tables from correction frames; model fine-tuning is v2 unless evals prove it is worth the cost.

4. **The query language for profile slots is not yet locked.** v1 supports: filter (by field), sort (by field), project (select fields), graph traversal (by edge type), runtime lookups, simple aggregations (count, sum, latest). Anything more complex needs explicit spec extension.

5. **The "shared" curation_mode operational semantics are minimal in v1.** Promotion requires explicit user action. Demotion same. v2 may add bulk operations.

6. **Kill criterion.** If the vertical slice is not working after two focused implementation weeks, pause and reassess the substrate abstraction before building more surface area.

### Testing discipline

Per the spec (Invariant 5): every behavior claim must have a falsifiable test. The conformance suite is structured around this:
- Frame round-trip (write a frame, read it back, verify all fields preserved)
- Curation_mode round-trip (verify routing works as declared)
- Mutation semantics (supersedes works for semantic; refinement works for crystal)
- Capability coverage (verify the SSA declares accurately what the backend does)

Run conformance against every new SSA before merging.

### What to ask the user when blocked

If you hit a question that the spec doesn't answer:
1. Check the open-questions section (§13)
2. Apply the falsifiability discipline (what would refute the claim you'd need to make?)
3. Apply the determinism-where-possible principle
4. If still unclear, ask the user explicitly — flag what you're uncertain about and what the options are

Do not silently make architectural decisions. Surface them.

### Skills you should adopt locally

The project has these discipline skills you should follow:
- **frontier-thinking** — for any non-trivial design decision
- **academic-verify** — for any claim about how external systems behave (Cursor, Claude Code, Mem0, etc.)
- **cross-modal-review** — before merging significant code changes
- **strict-honesty** — for every response (falsifiability, scope, defaults, disagreement, confidence)

---

## What this guide does NOT cover

- Specific business logic of individual skills (out of scope; users author their own)
- The model layer (we don't touch it)
- The exact UI for the user-facing layer (later)
- Multi-device sync (v2)
- Multi-store federation (v2)
- Procedural lifecycle operations beyond basic conflict detection (v2)

---

## When you're ready to start

1. Confirm you've read AMP-CONSOLIDATED-SPEC.md
2. Confirm you understand the four-layer architecture
3. Confirm you understand the four substrate sub-layers
4. Confirm you understand the from-amp invariant
5. Start with Phase 0 (vertical-slice foundation) — don't skip ahead
6. Write tests as you go, not after
7. Surface any architectural uncertainty rather than absorbing it silently

The bar: every PR should be reviewable by someone who has read the spec. If the diff makes sense to a spec reader, it makes sense.

---

*End of Cursor implementation guide. Generated 24 May 2026.*
