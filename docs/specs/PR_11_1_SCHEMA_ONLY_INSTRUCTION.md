# AMP §11.1 — Schema-only PR instruction

Handoff artifact for Ralph/subagents. Verbatim operator instruction.

---

**TASK: AMP §11.1 — schema-only PR (capability_coverage + provenance.upstream). NO feature code.**

**Context.** You are working in the `ai-memory` repo. The canonical specs are `docs/specs/AMP_CONSOLIDATED_SPEC.md` and `docs/specs/AMP_SPEC_UPDATE_OPTIMIZER_AND_UPSTREAM_SYNC.md`. This PR implements **only** step 1 of that delta's §11 implementation order: pin the type surface before any feature depends on it. The §16 Upstream Sync protocol and §4.3.5 Optimizer are already designed and LOCKED — you are **not** building them here, only adding the schema fields they will later depend on.

**Hard constraints — do not violate:**
- Schema + tests only. No optimizer logic, no upstream cron, no gstack importer, no gbrain capability promotions, no CLI verbs. If you find yourself writing behavior, stop.
- Do **not** add any ingestion of user-authored surfaces (Claude Code memory, CLAUDE.md user sections, .cursor/rules, gbrain pages). That is out of scope and trust-model-gated (§16.8). Not this PR.
- Do **not** touch `src/amp/config/` schema. No new config keys.
- Validate every enum value and field name against the actual `.ts` schema before writing — do not invent values. (This is a standing project rule.)
- `ProcedureProvenanceSchema` and `CapabilityCoverageSchema` are both `.strict()`. Adding fields has blast radius — you must update every construction site, not just the schema.

**Edit 1 — `src/amp/adapter-contract/capability-coverage.ts`.**
Add two keys to `CapabilityCoverageSchema`, typed `CapabilityLevelSchema`, matching the existing pattern:
```ts
skill_optimization: CapabilityLevelSchema,
action_log: CapabilityLevelSchema,
```
Per §1.6 (honest gaps): since no optimizer/action-log code exists in this PR, declare **both as `"unsupported"`** for all backends. Update the `createSliceCapabilityCoverage` base defaults accordingly (add `skill_optimization: "unsupported"`, `action_log: "unsupported"`).

Then `grep -rn "CapabilityCoverageSchema\|createSliceCapabilityCoverage\|frame_kinds:" src/amp` and find **every** other object literal that constructs a coverage object (including `ssa-files/*.yaml` and any gbrain/in-memory/sqlite adapter defaults). Add both keys = `"unsupported"` to each. The PR must compile and all existing tests must pass — a missing key on a `.strict()` schema is a parse failure.

**Edit 2 — `src/amp/procedural/schema.ts`.**
Extend `ProcedureProvenanceSchema` with the optional, additive `upstream` block exactly per spec §9.9.6. Do **not** change the `source` enum:
```ts
export const ProcedureProvenanceSchema = z
  .object({
    source: z.enum(["user", "amp-registry", "import"]),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime().optional(),
    author: z.string().min(1).optional(),
    notes: z.string().optional(),
    upstream: z
      .object({
        source_id: z.string().min(1),
        ref: z.string().min(1),
        fetched_at: z.string().datetime().optional(),
        upstream_synced_at: z.string().datetime().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
```

**Tests.**
- Extend `src/amp/procedural/schema.test.ts` with the two §9.9.6 cases: (1) a procedure with `source: "import"` + populated `upstream` round-trips byte-identical through the parser; (2) a procedure with `source: "user"` and no `upstream` does not synthesize one. Use the project's existing parse/round-trip helper (`grep` for `parseCanonicalProcedure` or the registry parse path — use whatever the existing tests use; do not invent a helper).
- Extend `src/amp/adapter-contract/capability-coverage.test.ts`: (1) a coverage object missing `skill_optimization` or `action_log` fails `parseCapabilityCoverage`; (2) `isCapabilitySupported(coverage, "skill_optimization")` returns `false` when declared `"unsupported"` (honest-gap conformance).

**Acceptance / falsifiable checks (must all hold before you call this done):**
- `npm run build` (or the repo's typecheck) passes; full test suite green.
- §3 action_log claim: `grep -ri "action_log\|ActionLog\|action-log" src/amp/` returns **only** the capability_coverage type/usages and spec references — **no** behavioral code.
- §9.9.6 round-trip claims pass as tests.

**Out of scope (explicit):** optimizer interfaces (§2), upstream cron/changeset/CLI (§16), gstack importer (§5/§9.9 pipeline), gbrain promotions (§6/§10.4), config changes, and any user-memory ingestion. Those are later steps and separate PRs.

**Deliverable:** one small, atomic, easily-revertible commit touching only the two schema files, their tests, and the coverage-construction sites the strict schemas force you to update. Report the list of files changed and the grep output for the action_log check.
