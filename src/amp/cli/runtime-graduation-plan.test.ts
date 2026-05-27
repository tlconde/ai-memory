import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { runAmpInit } from "./init.js";
import { registerAmpCommands } from "./index.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";
import {
  formatAmpRuntimeGraduationPlanJson,
  formatAmpRuntimeGraduationPlanReport,
  runAmpRuntimeGraduationPlan,
} from "./runtime-graduation-plan.js";

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

describe("runAmpRuntimeGraduationPlan", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-runtime-graduation-plan-cli-"));
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

  it("returns an empty plan with zero counts on empty store", async () => {
    const { projectRoot, env, fakeHome } = await initProject("empty-graduation");

    const result = runAmpRuntimeGraduationPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });

    assert.equal(result.ok, true);
    assert.equal(result.storageWired, true);
    assert.ok(result.plan);
    assert.equal(result.plan?.generatedAt, GENERATED_AT);
    assert.deepEqual(result.plan?.decisions, []);
    assert.deepEqual(result.plan?.summary, {
      graduate: 0,
      defer: 0,
      proposal_required: 0,
      skip: 0,
    });

    const text = formatAmpRuntimeGraduationPlanReport(result).join("\n");
    assert.match(text, /experimental operator command/i);
    assert.match(text, /generated_at: 2026-05-27T10:00:00.000Z/);
    assert.match(text, /Summary: 0 graduate, 0 defer, 0 proposal, 0 skip/);
  });

  it("graduates persisted preference candidates with explicit confirmation", async () => {
    const { projectRoot, env, fakeHome } = await initProject("graduate-preference");
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

    const result = runAmpRuntimeGraduationPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });

    assert.equal(result.ok, true);
    assert.equal(result.plan?.decisions.length, 1);
    assert.equal(result.plan?.decisions[0]?.status, "graduate");
    if (result.plan?.decisions[0]?.status === "graduate") {
      assert.equal(result.plan.decisions[0].recordId, "pref-confirmed");
      assert.equal(result.plan.decisions[0].reason, "explicit_confirmation");
      assert.ok(result.plan.decisions[0].targetFrame);
    }

    const text = formatAmpRuntimeGraduationPlanReport(result).join("\n");
    assert.match(text, /GRADUATE pref-confirmed runtime-preference-candidate explicit_confirmation/);
    assert.match(text, /Summary: 1 graduate, 0 defer, 0 proposal, 0 skip/);
    assert.doesNotMatch(text, /"targetFrame"/);
    assert.doesNotMatch(text, /"kind_provenance"/);
  });

  it("requires proposal for contradicted preferences", async () => {
    const { projectRoot, env, fakeHome } = await initProject("contradicted-preference");
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

    const seedResult = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });
    assert.equal(seedResult.ok, true);

    const result = runAmpRuntimeGraduationPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });

    assert.equal(result.ok, true);
    assert.equal(result.plan?.decisions[0]?.status, "proposal_required");
    if (result.plan?.decisions[0]?.status === "proposal_required") {
      assert.equal(result.plan.decisions[0].reason, "contradicted_preference");
    }

    const text = formatAmpRuntimeGraduationPlanReport(result).join("\n");
    assert.match(
      text,
      /PROPOSAL pref-contradicted runtime-preference-candidate contradicted_preference/,
    );
  });

  it("emits parseable JSON with the full plan including targetFrame", async () => {
    const { projectRoot, env, fakeHome } = await initProject("json-graduation");
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

    const result = runAmpRuntimeGraduationPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });

    const payload = JSON.parse(formatAmpRuntimeGraduationPlanJson(result)) as {
      ok: boolean;
      storageWired: boolean;
      runtimeDbPath: string;
      plan: {
        generatedAt: string;
        summary: { graduate: number };
        decisions: Array<{
          status: string;
          recordId: string;
          targetFrame?: { kind: string };
        }>;
      };
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.storageWired, true);
    assert.match(payload.runtimeDbPath, /runtime\.db$/);
    assert.equal(payload.plan.generatedAt, GENERATED_AT);
    assert.equal(payload.plan.summary.graduate, 1);
    assert.equal(payload.plan.decisions[0]?.status, "graduate");
    assert.equal(payload.plan.decisions[0]?.recordId, "pref-confirmed");
    assert.equal(payload.plan.decisions[0]?.targetFrame?.kind, "semantic");
  });

  it("returns bootstrap error when project AMP config is missing", () => {
    const result = runAmpRuntimeGraduationPlan({
      projectRoot: "/tmp/missing-amp-config-graduation-plan",
    });

    assert.equal(result.ok, false);
    assert.equal(result.storageWired, false);
    assert.match(result.error ?? "", /Project AMP config not found/);

    const text = formatAmpRuntimeGraduationPlanReport(result).join("\n");
    assert.match(text, /ERROR Runtime graduation plan did not run/);
  });
});

describe("registerAmpCommands runtime graduation plan", () => {
  it("registers runtime graduation plan under amp runtime", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const runtime = amp.commands.find((cmd) => cmd.name() === "runtime");
    assert.ok(runtime, "expected amp runtime command group");

    const graduation = runtime.commands.find((cmd) => cmd.name() === "graduation");
    assert.ok(graduation, "expected amp runtime graduation command group");

    const plan = graduation.commands.find((cmd) => cmd.name() === "plan");
    assert.ok(plan, "expected amp runtime graduation plan subcommand");
    assert.ok(
      plan.options.some((option) => option.long?.includes("--json")),
      "expected --json option on runtime graduation plan",
    );
    assert.ok(
      plan.options.some((option) => option.long?.includes("--project-root")),
      "expected --project-root option on runtime graduation plan",
    );
    assert.match(plan.description() ?? "", /read-only/i);
  });
});
