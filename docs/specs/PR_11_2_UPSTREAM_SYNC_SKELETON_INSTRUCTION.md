# AMP §11.2 — Upstream-Sync skeleton PR instruction

Handoff artifact for Ralph/subagents. Verbatim operator instruction.

---

**TASK: AMP §11.2 — §16 Upstream-Sync skeleton against a single stub source. No real network. No scheduler. Validate T1–T5.**

**Context.** Repo ai-memory, branch off ralph/amp-runtime-semantics-plan. Canonical: docs/specs/AMP_SPEC_UPDATE_OPTIMIZER_AND_UPSTREAM_SYNC.md §16 (LOCKED design, PROVISIONAL impl). §11.1 schema landed (8788e42) — provenance.upstream block + capability_coverage keys already exist; build on them. This step builds the §16 surface end-to-end against a fixture upstream source, exercising falsifiable tests T1–T5 (§16.9) in isolation.

**Hard constraints:**

- No network. The only upstream source in this PR is a fixture StubUpstreamSource that reads a local fixture directory. No HTTP, no git clone.
- No scheduler. grep confirms no cron/scheduling infra exists. The §16.3 / §4.5 "cron" is implemented as an invokable function runUpstreamSync(...) plus a CLI verb to trigger it on demand. Wiring to an actual scheduler is explicitly out of scope.
- Do not touch AmpConfigFileSchema (config/schema.ts). Subscription state lives in its own file ~/.amp/upstream/subscriptions.json with its own zod schema, per §16.2. Keeps config untouched.
- Validate every value against schema before writing it (standing rule). Specifically resolve the upstream_applied audit-frame question against runtime-semantics/schema.ts RUNTIME_ENTITY_REGISTRY — add it as an event_type on kind: "episodic-frame" mirroring capture-correction's "correction"; do not add a new top-level entity kind unless the schema genuinely forces it.
- Reuse existing machinery — do not reinvent: ProcedureRegistry.register/update (procedural/registry.ts:46/66), ProcedureConflict (procedural/schema.ts:90), propagateProcedures (substrate/propagation/service.ts:61), writeRuntimeSemanticEntity (runtime-semantics/storage-writer.ts:66), upsertMarkerBlockFor + MarkerDelimiterPair (agent-setup/markers.ts:118), projection content model (projection/content.ts, projection/build-documents.ts:219), createV1FixtureProject (integration/fixtures/v1-project.ts:44).

**New module src/amp/upstream/:**

- types.ts — zod schemas + inferred types, all .strict(), per §16.2/§16.4
- subscriptions.ts — UpstreamSubscriptionSchema; read/write subscriptions.json. Default policy: "local-wins"
- Path helpers — config/paths.ts: defaultUserUpstreamDir(), changesets under `<upstreamDir>/changesets/`
- stub-source.ts — fixture UpstreamSource impl (local fixture dir only)
- diff.ts — diffManifests(local, upstream)
- sync.ts — runUpstreamSync(...)
- apply.ts — applyChangeset(...)
- projection-block.ts — amp:upstream-sync:v1 block, ≤200-token sub-budget

**CLI — amp upstream subgroup:** subscribe, unsubscribe, list, review, apply, dismiss, poll

**Tests — src/amp/integration/upstream-sync.test.ts + fixtures:** T1–T5 verbatim from §16.9

**Acceptance:** npx tsc --noEmit, npm run build, T1–T5 green (node --import tsx --test), amp upstream poll silent with zero subscriptions, AmpConfigFileSchema unchanged, no network in src/amp/upstream/

**Suggested commit split:** (1) types + subscriptions + paths + stub + unit tests; (2) diff + sync + changeset persistence; (3) projection block + budget; (4) apply + audit frame; (5) CLI verbs

**Out of scope:** real scheduler, real git/registry sources, optimizer, gbrain promotions, auto-apply, continuous-watch, TUI diff (§16.10)
