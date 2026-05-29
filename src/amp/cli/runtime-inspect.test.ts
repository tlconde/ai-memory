import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { runAmpInit } from "./init.js";
import { resolveCliProjectContext } from "./cli-context.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";
import { runAmpRuntimeGraduationApply } from "./runtime-graduation-apply.js";
import {
  formatAmpRuntimeInspectJson,
  formatAmpRuntimeInspectReport,
  runAmpRuntimeInspect,
} from "./runtime-inspect.js";

const ISO = "2026-05-26T12:00:00.000Z";

const GENERATED_AT = "2026-05-27T10:00:00.000Z";

const ACTIVE_PREFERENCE = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded" as const,
  scope: "user" as const,
  context: {},
  status: "active" as const,
  expires_at: ISO,
  first_observed_at: ISO,
  last_observed_at: ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium" as const,
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

const OPEN_DECISION = {
  id: "dec-1",
  question: "Which storage backend?",
  status: "open" as const,
  scope: "project" as const,
  options: [
    {
      id: "opt-1",
      label: "SQLite",
      tradeoffs: ["local only"],
      evidence_refs: ["evidence-1"],
    },
  ],
  urgency: "medium" as const,
  owner: "user" as const,
  created_at: ISO,
  last_touched_at: ISO,
  provenance: ["signal-1"],
};

describe("runAmpRuntimeInspect", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-runtime-inspect-cli-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function initProject(name: string) {
    const projectRoot = join(tempRoot, name);
    const fakeHome = join(tempRoot, `home-${name}`);
    const env = { HOME: fakeHome, AMP_KNOWLEDGE_BACKEND: "in-memory" };
    await runAmpInit({ projectRoot, env });
    return { projectRoot, env, fakeHome };
  }

  it("succeeds on empty store and reports zero records", async () => {
    const { projectRoot, env, fakeHome } = await initProject("empty-inspect");

    const result = runAmpRuntimeInspect({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.storageWired, true);
    assert.deepEqual(result.records, []);

    const text = formatAmpRuntimeInspectReport(result).join("\n");
    assert.match(text, /experimental operator command/i);
    assert.match(text, /no persisted typed runtime semantic entities/);
    assert.match(text, /Summary: 0 valid, 0 skipped/);
  });

  it("shows seeded valid entity in inspect text and JSON", async () => {
    const { projectRoot, env, fakeHome } = await initProject("seeded-inspect");
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }),
      "utf8",
    );

    const seedResult = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });
    assert.equal(seedResult.ok, true);

    const result = runAmpRuntimeInspect({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.id, "pref-1");
    assert.equal(result.records[0]?.ok, true);

    const text = formatAmpRuntimeInspectReport(result).join("\n");
    assert.match(text, /OK pref-1 \(runtime-preference-candidate, user\)/);

    const payload = JSON.parse(formatAmpRuntimeInspectJson(result)) as {
      ok: boolean;
      storageWired: boolean;
      records: Array<{ id: string; ok: boolean; kind: string }>;
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.storageWired, true);
    assert.equal(payload.records.length, 1);
    assert.equal(payload.records[0]?.id, "pref-1");
    assert.equal(payload.records[0]?.ok, true);
  });

  it("includes graduated status in inspect text and JSON after graduation apply", async () => {
    const { projectRoot, env, fakeHome } = await initProject("graduated-inspect");
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-graduated",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-graduated",
          promotion_evidence: {
            ...ACTIVE_PREFERENCE.promotion_evidence,
            explicit_confirmation_signal_id: "confirm-1",
          },
        },
      }),
      "utf8",
    );

    const seedResult = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });
    assert.equal(seedResult.ok, true);

    const applyResult = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-graduated",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: new InMemoryKnowledgeStore() },
    });
    assert.equal(applyResult.ok, true);
    assert.equal(applyResult.runtimeRowMutated, true);

    const result = runAmpRuntimeInspect({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.graduation_status, "graduated");
    assert.equal(result.records[0]?.graduated_at, GENERATED_AT);

    const text = formatAmpRuntimeInspectReport(result).join("\n");
    assert.match(text, /graduated at 2026-05-27T10:00:00.000Z/);

    const payload = JSON.parse(formatAmpRuntimeInspectJson(result)) as {
      records: Array<{ graduation_status: string | null; graduated_at: string | null }>;
    };
    assert.equal(payload.records[0]?.graduation_status, "graduated");
    assert.equal(payload.records[0]?.graduated_at, GENERATED_AT);
  });

  it("filters by --entity runtime-preference-candidate", async () => {
    const { projectRoot, env, fakeHome } = await initProject("filtered-inspect");
    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtime = new RuntimeStore({ dbPath: context.runtimeDbPath });
    try {
      runtime.semanticEntityInsert({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      });
      runtime.semanticEntityInsert({
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: "filtered-inspect",
        payload: OPEN_DECISION,
      });
    } finally {
      runtime.close();
    }

    const result = runAmpRuntimeInspect({
      projectRoot,
      entity: "runtime-preference-candidate",
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.entity, "runtime-preference-candidate");
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.id, "pref-1");
    assert.equal(result.records[0]?.kind, "runtime-preference-candidate");
  });

  it("reports invalid persisted row as skip entry, not valid output", async () => {
    const { projectRoot, env, fakeHome } = await initProject("invalid-inspect");
    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtime = new RuntimeStore({ dbPath: context.runtimeDbPath });
    try {
      runtime.semanticEntityInsert({
        id: "dec-bad",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: "invalid-inspect",
        payload: { id: "dec-bad" },
      });
    } finally {
      runtime.close();
    }

    const result = runAmpRuntimeInspect({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.ok, false);
    if (result.records[0]?.ok === false) {
      assert.equal(result.records[0].reason, "invalid_input");
    }

    const text = formatAmpRuntimeInspectReport(result).join("\n");
    assert.match(text, /SKIP dec-bad/);
    assert.match(text, /invalid_input/);
    assert.doesNotMatch(text, /OK dec-bad/);

    const payload = JSON.parse(formatAmpRuntimeInspectJson(result)) as {
      records: Array<{ id: string; ok: boolean; reason?: string }>;
    };
    assert.equal(payload.records[0]?.ok, false);
    assert.equal(payload.records[0]?.reason, "invalid_input");
  });

  it("rejects unknown entity filter with clear error", () => {
    const result = runAmpRuntimeInspect({ entity: "not-a-real-kind" });

    assert.equal(result.ok, false);
    assert.equal(result.storageWired, false);
    assert.match(result.error ?? "", /Invalid runtime entity kind "not-a-real-kind"/);
    assert.deepEqual(result.records, []);

    const text = formatAmpRuntimeInspectReport(result).join("\n");
    assert.match(text, /ERROR Runtime inspect did not run/);
  });
});
