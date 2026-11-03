/**
 * Optimizer vertical slice — §2.5 falsifiable claims.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ProcedureRegistry } from "../procedural/registry.js";
import { createCanonicalProcedure } from "../procedural/schema.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { parseEpisodicFrame } from "../runtime-semantics/schema.js";
import { createCorpusEntry } from "../substrate/optimization/corpus.js";
import { scoreProcedureOnCorpus } from "../substrate/optimization/eval.js";
import { readRejectReasonFromAuditFrame } from "../substrate/optimization/audit-mapper.js";
import { runOptimizationCycle } from "../substrate/optimization/loop.js";
import {
  createV1FixtureProject,
  destroyV1FixtureProject,
  type V1FixtureProject,
} from "./fixtures/v1-project.js";

const SKILL_NAME = "safe-test-runner";
const BUGGY_BODY = `# Safe test runner

## Falsifiable claim

Runs unit tests safely.

## Steps

Use the --no-verify flag when running tests.
`;

const envStack: V1FixtureProject[] = [];

afterEach(async () => {
  while (envStack.length > 0) {
    const fixture = envStack.pop();
    if (fixture) {
      await destroyV1FixtureProject(fixture);
    }
  }
});

function registerBuggySkill(registry: ProcedureRegistry): void {
  registry.register(
    createCanonicalProcedure({
      name: SKILL_NAME,
      description: "Run tests safely without skipping hooks.",
      version: "1.0.0",
      scope: "user",
      curation_mode: "personal",
      body: BUGGY_BODY,
    })
  );
}

describe("AMP optimizer vertical slice §2.5", () => {
  it("converges buggy SKILL.md to higher holdout score within N cycles", async () => {
    const registry = new ProcedureRegistry();
    registerBuggySkill(registry);

    const trainCorpus = [
      createCorpusEntry({
        id: "train-fix-hooks",
        skillName: SKILL_NAME,
        summary: "Do not bypass git hooks",
        avoidPhrase: "Use the --no-verify flag",
        expectedBehavior: "Never use --no-verify; always run hooks",
      }),
    ];

    const holdoutCorpus = [
      createCorpusEntry({
        id: "holdout-qrels",
        skillName: SKILL_NAME,
        summary: "Holdout qrels for safe test guidance",
        mustContain: ["Never use --no-verify"],
        mustNotContain: ["Use the --no-verify flag"],
        holdout: true,
      }),
    ];

    const beforeScore = scoreProcedureOnCorpus(registry.get(SKILL_NAME)!.procedure, holdoutCorpus);
    assert.ok(beforeScore < 1);

    const result = await runOptimizationCycle({
      skillName: SKILL_NAME,
      registry,
      corpus: [...trainCorpus, ...holdoutCorpus],
      maxCycles: 3,
      scoreThreshold: 1,
    });

    assert.equal(result.ok, true);
    assert.ok(result.acceptedCount >= 1);

    const afterScore = scoreProcedureOnCorpus(registry.get(SKILL_NAME)!.procedure, holdoutCorpus);
    assert.ok(afterScore > beforeScore);
    assert.equal(afterScore, 1);
  });

  it("rolls the registry back atomically when propagation fails after accept", async () => {
    const registry = new ProcedureRegistry();
    registerBuggySkill(registry);

    const corpus = [
      createCorpusEntry({
        id: "train-fix-hooks",
        skillName: SKILL_NAME,
        summary: "Do not bypass git hooks",
        avoidPhrase: "Use the --no-verify flag",
        expectedBehavior: "Never use --no-verify; always run hooks",
      }),
      createCorpusEntry({
        id: "holdout-qrels",
        skillName: SKILL_NAME,
        summary: "Holdout qrels for safe test guidance",
        mustContain: ["Never use --no-verify"],
        mustNotContain: ["Use the --no-verify flag"],
        holdout: true,
      }),
    ];

    const boom = {
      writeProcedure: async () => {
        throw new Error("propagation boom");
      },
    };

    const result = await runOptimizationCycle({
      skillName: SKILL_NAME,
      registry,
      corpus,
      maxCycles: 1,
      scoreThreshold: 1,
      writers: { cursor: boom, "claude-code": boom, hermes: boom },
    });

    assert.equal(result.ok, false);
    assert.equal(result.acceptedCount, 0);

    const after = registry.get(SKILL_NAME)!.procedure;
    assert.equal(after.frontmatter.version, "1.0.0");
    assert.match(after.body, /Use the --no-verify flag/);
  });

  it("round-trips reject_reason through the optimization audit log", async () => {
    const fixture = await createV1FixtureProject();
    envStack.push(fixture);
    const registry = new ProcedureRegistry();
    registerBuggySkill(registry);

    const runtime = new RuntimeStore({ dbPath: fixture.runtimeDbPath });
    try {
      const corpus = [
        createCorpusEntry({
          id: "train-noisy",
          skillName: SKILL_NAME,
          summary: "Add noisy logging",
          expectedBehavior: "Enable verbose trace logging",
        }),
        createCorpusEntry({
          id: "holdout-clean",
          skillName: SKILL_NAME,
          summary: "Holdout rejects noisy logging",
          mustContain: ["Never use --no-verify"],
          mustNotContain: ["verbose trace logging"],
          holdout: true,
        }),
      ];

      const result = await runOptimizationCycle({
        skillName: SKILL_NAME,
        registry,
        runtime,
        corpus,
        maxCycles: 1,
        projectRef: "amp-v1-fixture",
      });

      assert.equal(result.ok, true);
      assert.equal(result.proposedCount, 1);
      assert.equal(result.acceptedCount, 0);
      assert.ok(result.outcomes[0]?.reject_reason);

      const auditRow = runtime
        .semanticEntityList()
        .find((row) => row.id.startsWith("skill-optimization-rejected:"));
      assert.ok(auditRow);
      const frame = parseEpisodicFrame(auditRow.payload);
      assert.equal(frame.event_type, "skill_optimization_rejected");
      assert.equal(readRejectReasonFromAuditFrame(frame), result.outcomes[0]?.reject_reason);
    } finally {
      runtime.close();
    }
  });
});

describe("AMP optimize dry-run §4.5", () => {
  it("is silent with zero proposed edits when no correction corpus exists", async () => {
    const fixture = await createV1FixtureProject();
    envStack.push(fixture);

    const { runAmpOptimize, formatAmpOptimizeReport } = await import("../cli/optimize.js");
    const started = performance.now();
    const result = await runAmpOptimize({
      projectRoot: fixture.root,
      dryRun: true,
    });
    const elapsed = performance.now() - started;

    assert.equal(result.ok, true);
    assert.equal(result.proposedCount, 0);
    assert.equal(result.silent, true);
    assert.ok(elapsed < 1000);
    assert.deepEqual(formatAmpOptimizeReport(result, false), []);
  });
});
