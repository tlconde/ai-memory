import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import { runAmpInit } from "./init.js";
import { registerAmpCommands } from "./index.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";
import {
  formatAmpRuntimeGraduationApplyJson,
  formatAmpRuntimeGraduationApplyReport,
  runAmpRuntimeGraduationApply,
} from "./runtime-graduation-apply.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";

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

const SUPPORTED_CRYSTAL = {
  id: "hyp-ready",
  claim: "Cursor works best for refactors in this repo",
  status: "supported" as const,
  scope: "project" as const,
  project_ref: "apply-crystal",
  related_goal_ids: [] as string[],
  related_decision_ids: [] as string[],
  supporting_evidence_refs: ["evidence-a"],
  contradicting_evidence_refs: [] as string[],
  predicted_observations: ["prediction-a"],
  successful_predictions: ["prediction-a"],
  failed_predictions: [] as string[],
  confidence: "medium" as const,
  contradiction_score: "low" as const,
  pinned: false,
  first_observed_at: ISO,
  last_referenced_at: ISO,
  source_signal_ids: ["signal-crystal"],
  lineage: {
    generated_by: "agent" as const,
    transform_id: "crystal-v1",
  },
};

describe("runAmpRuntimeGraduationApply", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-runtime-graduation-apply-cli-"));
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

  async function seedConfirmedPreference(
    projectRoot: string,
    env: NodeJS.ProcessEnv,
    fakeHome: string,
    id = "pref-confirmed",
  ) {
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id,
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id,
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
  }

  it("applies an explicitly confirmed preference candidate and writes one semantic frame", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-confirmed");
    const knowledge = new InMemoryKnowledgeStore();
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-confirmed",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-confirmed",
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

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtimeBefore = openRuntimeStore(context.runtimeDbPath);
    const entityBefore = runtimeBefore.semanticEntityList()[0];
    runtimeBefore.close();

    const result = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-confirmed",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: knowledge },
    });

    assert.equal(result.ok, true);
    assert.equal(result.appliedFrameId, "runtime-graduation:pref-confirmed");
    assert.equal(result.runtimeRowMutated, false);
    if (result.decision?.status === "graduate") {
      assert.equal(result.decision.reason, "explicit_confirmation");
    }
    assert.equal(knowledge.list().length, 1);
    assert.equal(knowledge.list()[0]?.kind, "semantic");

    const runtimeAfter = openRuntimeStore(context.runtimeDbPath);
    try {
      const entityAfter = runtimeAfter.semanticEntityList()[0];
      assert.deepEqual(entityAfter?.payload, entityBefore?.payload);
      assert.equal(entityAfter?.kind, entityBefore?.kind);
      assert.equal(entityAfter?.scope, entityBefore?.scope);
    } finally {
      runtimeAfter.close();
    }

    const text = formatAmpRuntimeGraduationApplyReport(result).join("\n");
    assert.match(text, /experimental operator command/i);
    assert.match(text, /target_id: pref-confirmed/);
    assert.match(text, /durable_frame_id: runtime-graduation:pref-confirmed/);
    assert.match(text, /explicit_confirmation/);
    assert.match(text, /Runtime semantic entity row was not mutated/);
  });

  it("applies repetition-threshold preference candidates with repetition_threshold_met reason", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-repeat");
    const knowledge = new InMemoryKnowledgeStore();
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-repeat",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-repeat",
          promotion_evidence: {
            repetition_count: 3,
            independent_sessions: 2,
          },
        },
      }),
      "utf8",
    );

    await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    const result = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-repeat",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: knowledge },
    });

    assert.equal(result.ok, true);
    if (result.decision?.status === "graduate") {
      assert.equal(result.decision.reason, "repetition_threshold_met");
    }

    const text = formatAmpRuntimeGraduationApplyReport(result).join("\n");
    assert.match(text, /repetition_threshold_met/);
  });

  it("fails for contradicted preferences because they require a proposal", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-contradicted");
    const knowledge = new InMemoryKnowledgeStore();
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-contradicted",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-contradicted",
          status: "contradicted",
        },
      }),
      "utf8",
    );

    await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    const result = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-contradicted",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: knowledge },
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /proposal_required|not graduate/i);
    assert.equal(knowledge.list().length, 0);

    const text = formatAmpRuntimeGraduationApplyReport(result).join("\n");
    assert.match(text, /ERROR/);
  });

  it("fails for proposal-ready crystal candidates", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-crystal");
    const knowledge = new InMemoryKnowledgeStore();
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "hyp-ready",
        kind: "runtime-crystal-candidate",
        scope: "project",
        project_ref: "apply-crystal",
        payload: SUPPORTED_CRYSTAL,
      }),
      "utf8",
    );

    await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    const result = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "hyp-ready",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: knowledge },
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /runtime-preference-candidate|not graduate/i);
    assert.equal(knowledge.list().length, 0);
  });

  it("fails for unknown runtime record ids", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-unknown");
    const knowledge = new InMemoryKnowledgeStore();

    const result = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "missing-id",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: knowledge },
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /not found/i);
  });

  it("fails for blank ids before storage access", () => {
    const result = runAmpRuntimeGraduationApply({
      projectRoot: "/tmp/blank-id",
      id: "   ",
    });

    assert.equal(result.ok, false);
    assert.equal(result.storageWired, false);
    assert.match(result.error ?? "", /Missing required --id/);
  });

  it("fails closed on duplicate apply", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-duplicate");
    const knowledge = new InMemoryKnowledgeStore();
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-confirmed",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-confirmed",
          promotion_evidence: {
            ...ACTIVE_PREFERENCE.promotion_evidence,
            explicit_confirmation_signal_id: "confirm-1",
          },
        },
      }),
      "utf8",
    );

    await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    const first = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-confirmed",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: knowledge },
    });
    assert.equal(first.ok, true);

    const duplicate = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-confirmed",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: knowledge },
    });

    assert.equal(duplicate.ok, false);
    assert.match(duplicate.error ?? "", /already exists/i);
    assert.equal(knowledge.list().length, 1);
  });

  it("preserves project scope and project_ref on written frames", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-project-scope");
    const knowledge = new InMemoryKnowledgeStore();
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-project",
        kind: "runtime-preference-candidate",
        scope: "project",
        project_ref: "apply-project-scope",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-project",
          scope: "project",
          project_ref: "apply-project-scope",
          promotion_evidence: {
            ...ACTIVE_PREFERENCE.promotion_evidence,
            explicit_confirmation_signal_id: "confirm-1",
          },
        },
      }),
      "utf8",
    );

    await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    const result = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-project",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: knowledge },
    });

    assert.equal(result.ok, true);
    const frame = knowledge.list()[0];
    assert.equal(frame?.scope.kind, "project");
    if (frame?.scope.kind === "project") {
      assert.equal(frame.scope.project_ref, "apply-project-scope");
    }
  });

  it("emits parseable JSON", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-json");
    const knowledge = new InMemoryKnowledgeStore();
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-confirmed",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-confirmed",
          promotion_evidence: {
            ...ACTIVE_PREFERENCE.promotion_evidence,
            explicit_confirmation_signal_id: "confirm-1",
          },
        },
      }),
      "utf8",
    );

    await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    const result = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-confirmed",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
      deps: { knowledgeStore: knowledge },
    });

    const payload = JSON.parse(formatAmpRuntimeGraduationApplyJson(result)) as {
      ok: boolean;
      projectRoot: string;
      runtimeDbPath: string;
      recordId: string;
      appliedFrameId: string;
      decision: { status: string; reason: string };
      error: string | null;
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.projectRoot, projectRoot);
    assert.match(payload.runtimeDbPath, /runtime\.db$/);
    assert.equal(payload.recordId, "pref-confirmed");
    assert.equal(payload.appliedFrameId, "runtime-graduation:pref-confirmed");
    assert.equal(payload.decision.status, "graduate");
    assert.equal(payload.decision.reason, "explicit_confirmation");
    assert.equal(payload.error, null);
  });

  it("returns bootstrap error when project AMP config is missing", () => {
    const result = runAmpRuntimeGraduationApply({
      projectRoot: "/tmp/missing-amp-config-graduation-apply",
      id: "pref-1",
    });

    assert.equal(result.ok, false);
    assert.equal(result.storageWired, false);
    assert.match(result.error ?? "", /Project AMP config not found/);
  });

  it("applies without injected store to persistent local knowledge.db", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-persistent");
    await seedConfirmedPreference(projectRoot, env, fakeHome);

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtimeBefore = openRuntimeStore(context.runtimeDbPath);
    const entityBefore = runtimeBefore.semanticEntityList()[0];
    runtimeBefore.close();

    const result = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-confirmed",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });

    assert.equal(result.ok, true);
    assert.equal(result.appliedFrameId, "runtime-graduation:pref-confirmed");
    assert.equal(result.persistentLocalKnowledgeWritten, true);
    assert.equal(result.runtimeRowMutated, false);

    const knowledgeDbPath = resolveLocalKnowledgeDbPath(context.runtimeDbPath);
    const reopened = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
    try {
      const frame = reopened.read("runtime-graduation:pref-confirmed");
      assert.equal(frame?.kind, "semantic");
      assert.equal(reopened.list().length, 1);
    } finally {
      reopened.close();
    }

    const runtimeAfter = openRuntimeStore(context.runtimeDbPath);
    try {
      const entityAfter = runtimeAfter.semanticEntityList()[0];
      assert.deepEqual(entityAfter?.payload, entityBefore?.payload);
      assert.equal(entityAfter?.kind, entityBefore?.kind);
      assert.equal(entityAfter?.scope, entityBefore?.scope);
    } finally {
      runtimeAfter.close();
    }

    const text = formatAmpRuntimeGraduationApplyReport(result).join("\n");
    assert.match(text, /durable local knowledge was written/);
    assert.doesNotMatch(text, /only durable knowledge was written/);
  });

  it("fails duplicate apply across reopened persistent knowledge store", async () => {
    const { projectRoot, env, fakeHome } = await initProject("apply-persistent-duplicate");
    await seedConfirmedPreference(projectRoot, env, fakeHome);

    const first = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-confirmed",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });
    assert.equal(first.ok, true);

    const second = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-confirmed",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });

    assert.equal(second.ok, false);
    assert.match(second.error ?? "", /already exists/i);

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const reopened = new LocalSqliteKnowledgeStore({
      dbPath: resolveLocalKnowledgeDbPath(context.runtimeDbPath),
    });
    try {
      assert.equal(reopened.list().length, 1);
    } finally {
      reopened.close();
    }
  });

  it("uses local SQLite graduation apply path without constructing gbrain", async () => {
    const { projectRoot, fakeHome } = await initProject("apply-no-gbrain");
    const env = { HOME: fakeHome };
    await seedConfirmedPreference(projectRoot, env, fakeHome, "pref-no-gbrain");

    const result = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-no-gbrain",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });

    assert.equal(result.ok, true);
    assert.equal(result.persistentLocalKnowledgeWritten, true);

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const reopened = new LocalSqliteKnowledgeStore({
      dbPath: resolveLocalKnowledgeDbPath(context.runtimeDbPath),
    });
    try {
      assert.equal(reopened.read("runtime-graduation:pref-no-gbrain")?.kind, "semantic");
    } finally {
      reopened.close();
    }
  });
});

describe("registerAmpCommands runtime graduation apply", () => {
  it("registers runtime graduation apply under amp runtime", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const runtime = amp.commands.find((cmd) => cmd.name() === "runtime");
    assert.ok(runtime, "expected amp runtime command group");

    const graduation = runtime.commands.find((cmd) => cmd.name() === "graduation");
    assert.ok(graduation, "expected amp runtime graduation command group");

    const apply = graduation.commands.find((cmd) => cmd.name() === "apply");
    assert.ok(apply, "expected amp runtime graduation apply subcommand");
    assert.ok(
      apply.options.some((option) => option.long?.includes("--id")),
      "expected --id option on runtime graduation apply",
    );
    assert.ok(
      apply.options.some((option) => option.long?.includes("--json")),
      "expected --json option on runtime graduation apply",
    );
    assert.match(apply.description() ?? "", /experimental operator command/i);
  });
});
