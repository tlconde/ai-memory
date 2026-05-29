/**
 * Durable local dogfood E2E — capture/consolidate and graduation paths against knowledge.db.
 *
 * Falsifiable claim: the simpler operator path init → capture → consolidate → retrieve
 * and the graduation path init → seed → graduation plan/apply → retrieve both work
 * against real CLI functions and persistent `.amp/runtime/knowledge.db` without gbrain
 * transport or injected knowledge stores.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir as realHomedir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import { runAmpCapture } from "../cli/capture.js";
import { runAmpConsolidate } from "../cli/consolidate.js";
import { runAmpInit } from "../cli/init.js";
import { openRuntimeStore, resolveCliProjectContext } from "../cli/cli-context.js";
import { resolveLocalKnowledgeDbPath } from "../cli/knowledge-backend.js";
import { runAmpProjectionRender } from "../cli/projection.js";
import { createProjectionRenderSource } from "../cli/projection-source.js";
import { runAmpRuntimeGraduationApply } from "../cli/runtime-graduation-apply.js";
import { runAmpRuntimeGraduationPlan } from "../cli/runtime-graduation-plan.js";
import { runAmpRuntimeSeed } from "../cli/runtime-seed.js";
import { formatAmpRetrieveMessages, runAmpRetrieve } from "../cli/retrieve.js";
import { ACTIVE_PREFERENCE } from "../runtime-semantics/runtime-semantics.test-fixture.js";
import {
  canonicalLocalProjectionPaths,
  createIsolatedAmpTestEnv,
  PROJECTION_FILE_KINDS,
} from "./_helpers/local-projection-fixture.js";

const GENERATED_AT = "2026-05-27T10:00:00.000Z";
const CANDIDATE_ID = "pref-dogfood-e2e";
const PREFERENCE_STATEMENT = ACTIVE_PREFERENCE.statement;
const CAPTURE_PREFERENCE_TEXT =
  "Run npm run typecheck before every AMP commit in this project.";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("Local durable dogfood E2E", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-local-durable-dogfood-e2e-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("runs capture → consolidate → retrieve → local projection against persistent knowledge.db", async () => {
    const projectRoot = join(tempRoot, "local-durable-dogfood-capture");
    const { env, rejectRealHomedir } = createIsolatedAmpTestEnv(
      tempRoot,
      "local-durable-dogfood-capture",
      { knowledgeBackend: false },
    );

    assert.equal(env.AMP_KNOWLEDGE_BACKEND, undefined);

    await mkdir(projectRoot, { recursive: true });

    const initResult = await runAmpInit({ projectRoot, env });
    assert.equal(initResult.configCreated, true);

    runAmpCapture({
      projectRoot,
      content: CAPTURE_PREFERENCE_TEXT,
      scope: "project",
      env,
      homedir: rejectRealHomedir,
    });

    const consolidateResult = await runAmpConsolidate({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
    });

    assert.equal(consolidateResult.processed, 1);
    assert.equal(consolidateResult.knowledgeBackend, "local-persistent");
    assert.equal(consolidateResult.knowledgeSource, "local-sqlite");
    assert.equal(consolidateResult.liveGbrain, undefined);

    const context = resolveCliProjectContext({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
    });

    const runtimeAfterConsolidate = openRuntimeStore(context.runtimeDbPath);
    try {
      assert.equal(runtimeAfterConsolidate.queueList().length, 0);
    } finally {
      runtimeAfterConsolidate.close();
    }

    const knowledgeDbPath = resolveLocalKnowledgeDbPath(context.runtimeDbPath);
    assert.equal(existsSync(knowledgeDbPath), true);

    const retrieveResult = await runAmpRetrieve({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
      scope: "project",
      query: "typecheck before every AMP commit",
    });

    assert.equal(retrieveResult.knowledgeBackend, "local-persistent");
    assert.equal(retrieveResult.knowledgeSource, "local-sqlite");
    assert.equal(retrieveResult.liveGbrain, undefined);
    assert.equal(retrieveResult.preferences.length, 1);
    assert.equal(retrieveResult.preferences[0]?.frame.content, CAPTURE_PREFERENCE_TEXT);
    assert.equal(retrieveResult.preferences[0]?.frame.id, consolidateResult.frameIds[0]);

    const dryRunResult = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      env,
      homedir: rejectRealHomedir,
    });
    assert.equal(dryRunResult.ok, true);
    assert.equal(dryRunResult.source, "local");
    assert.equal(dryRunResult.dryRun, true);
    assert.equal(dryRunResult.writes.length, 4);
    assert.deepEqual(
      dryRunResult.writes.map((write) => write.kind),
      [...PROJECTION_FILE_KINDS],
    );

    const projectProjectionWrite = dryRunResult.writes.find(
      (write) => write.kind === "project_projection",
    );
    assert.ok(projectProjectionWrite);
    assert.ok(projectProjectionWrite.bytes > 0);
    for (const write of dryRunResult.writes) {
      assert.equal(write.dryRun, true);
      assert.equal(existsSync(write.path), false);
    }

    const resolved = createProjectionRenderSource({
      sourceKind: "local",
      projectRef: context.projectRef,
      runtimeDbPath: context.runtimeDbPath,
      env,
    });
    assert.ok(!("error" in resolved));
    try {
      const documents = resolved.source.loadProjectionDocuments({
        projectRef: context.projectRef,
      });
      const projectProjection = documents.find(
        (doc) => doc.metadata.kind === "project_projection",
      );
      assert.match(projectProjection?.body ?? "", new RegExp(escapeRegex(CAPTURE_PREFERENCE_TEXT)));
    } finally {
      resolved.cleanup();
    }
  });

  it("runs seed → graduation plan/apply → retrieve → local projection against persistent knowledge.db", async () => {
    const projectRoot = join(tempRoot, "local-durable-dogfood");
    const { env, ampUserRoot, rejectRealHomedir } = createIsolatedAmpTestEnv(
      tempRoot,
      "local-durable-dogfood",
      { knowledgeBackend: false },
    );

    assert.equal(env.AMP_KNOWLEDGE_BACKEND, undefined);

    await mkdir(projectRoot, { recursive: true });

    const initResult = await runAmpInit({ projectRoot, env });
    assert.equal(initResult.configCreated, true);

    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: CANDIDATE_ID,
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: CANDIDATE_ID,
          promotion_evidence: {
            ...ACTIVE_PREFERENCE.promotion_evidence,
            explicit_confirmation_signal_id: "confirm-dogfood-e2e",
          },
        },
      }),
      "utf8",
    );

    const seedResult = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: rejectRealHomedir,
    });
    assert.equal(seedResult.ok, true);

    const planResult = runAmpRuntimeGraduationPlan({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
      generatedAt: GENERATED_AT,
    });
    assert.equal(planResult.ok, true);
    assert.equal(planResult.plan?.summary.graduate, 1);
    assert.equal(planResult.plan?.decisions.length, 1);
    assert.equal(planResult.plan?.decisions[0]?.status, "graduate");
    if (planResult.plan?.decisions[0]?.status === "graduate") {
      assert.equal(planResult.plan.decisions[0].recordId, CANDIDATE_ID);
    }

    const context = resolveCliProjectContext({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
    });
    const runtimeBefore = openRuntimeStore(context.runtimeDbPath);
    const entityBefore = runtimeBefore.semanticEntityList()[0];
    runtimeBefore.close();

    const applyResult = runAmpRuntimeGraduationApply({
      projectRoot,
      id: CANDIDATE_ID,
      env,
      homedir: rejectRealHomedir,
      generatedAt: GENERATED_AT,
    });
    assert.equal(applyResult.ok, true);
    assert.equal(applyResult.appliedFrameId, `runtime-graduation:${CANDIDATE_ID}`);
    assert.equal(applyResult.persistentLocalKnowledgeWritten, true);
    assert.equal(applyResult.runtimeRowMutated, false);

    const knowledgeDbPath = resolveLocalKnowledgeDbPath(context.runtimeDbPath);
    assert.equal(existsSync(knowledgeDbPath), true);
    const knowledge = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
    try {
      const frame = knowledge.read(`runtime-graduation:${CANDIDATE_ID}`);
      assert.equal(frame?.kind, "semantic");
      const content = frame?.content as { statement?: string; source_runtime_entity_id?: string };
      assert.equal(content.statement, PREFERENCE_STATEMENT);
      assert.equal(content.source_runtime_entity_id, CANDIDATE_ID);
    } finally {
      knowledge.close();
    }

    const runtimeAfterApply = openRuntimeStore(context.runtimeDbPath);
    try {
      const entityAfterApply = runtimeAfterApply.semanticEntityList()[0];
      assert.deepEqual(entityAfterApply?.payload, entityBefore?.payload);
      assert.equal(entityAfterApply?.kind, entityBefore?.kind);
      assert.equal(entityAfterApply?.scope, entityBefore?.scope);
      assert.equal(entityAfterApply?.id, entityBefore?.id);
    } finally {
      runtimeAfterApply.close();
    }

    const retrieveResult = await runAmpRetrieve({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
      scope: "user",
    });
    assert.equal(retrieveResult.knowledgeBackend, "local-persistent");
    assert.equal(retrieveResult.knowledgeSource, "local-sqlite");
    assert.equal(retrieveResult.preferences.length, 1);
    assert.equal(retrieveResult.preferences[0]?.frame.id, `runtime-graduation:${CANDIDATE_ID}`);
    const retrievedContent = retrieveResult.preferences[0]?.frame.content as { statement?: string };
    assert.equal(retrievedContent.statement, PREFERENCE_STATEMENT);

    const retrieveMessages = formatAmpRetrieveMessages(retrieveResult);
    assert.match(retrieveMessages.join("\n"), /local persistent knowledge\.db/);

    const dryRunResult = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      env,
      homedir: rejectRealHomedir,
    });
    assert.equal(dryRunResult.ok, true);
    assert.equal(dryRunResult.source, "local");
    assert.equal(dryRunResult.dryRun, true);
    assert.equal(dryRunResult.writes.length, 4);
    assert.deepEqual(
      dryRunResult.writes.map((write) => write.kind),
      [...PROJECTION_FILE_KINDS],
    );

    const globalProjectionWrite = dryRunResult.writes.find(
      (write) => write.kind === "global_projection",
    );
    assert.ok(globalProjectionWrite);
    assert.ok(globalProjectionWrite.bytes > 0);
    for (const write of dryRunResult.writes) {
      assert.equal(write.dryRun, true);
      assert.equal(existsSync(write.path), false);
    }

    const resolved = createProjectionRenderSource({
      sourceKind: "local",
      projectRef: context.projectRef,
      runtimeDbPath: context.runtimeDbPath,
      env,
    });
    assert.ok(!("error" in resolved));
    try {
      const documents = resolved.source.loadProjectionDocuments({
        projectRef: context.projectRef,
      });
      const globalProjection = documents.find((doc) => doc.metadata.kind === "global_projection");
      assert.match(globalProjection?.body ?? "", new RegExp(escapeRegex(PREFERENCE_STATEMENT)));
    } finally {
      resolved.cleanup();
    }

    const applyProjectionResult = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      apply: true,
      env,
      homedir: rejectRealHomedir,
    });
    assert.equal(applyProjectionResult.ok, true);
    assert.equal(applyProjectionResult.source, "local");
    assert.equal(applyProjectionResult.dryRun, false);
    assert.equal(applyProjectionResult.writes.length, 4);

    const canonicalPaths = canonicalLocalProjectionPaths(projectRoot, ampUserRoot);
    assert.deepEqual(
      applyProjectionResult.writes.map((write) => write.path),
      canonicalPaths,
    );
    for (const path of canonicalPaths) {
      assert.equal(existsSync(path), true, `expected ${path} after apply`);
    }

    const globalProjectionFile = await readFile(
      join(ampUserRoot, "projection", "global.md"),
      "utf8",
    );
    const projectProjection = await readFile(
      join(projectRoot, ".amp", "local", "projection.md"),
      "utf8",
    );
    assert.match(globalProjectionFile, new RegExp(escapeRegex(PREFERENCE_STATEMENT)));
    assert.doesNotMatch(projectProjection, new RegExp(escapeRegex(PREFERENCE_STATEMENT)));

    const realGlobalProjection = join(realHomedir(), ".amp", "projection", "global.md");
    assert.notEqual(
      applyProjectionResult.writes.find((write) => write.kind === "global_projection")?.path,
      realGlobalProjection,
    );
  });
});
