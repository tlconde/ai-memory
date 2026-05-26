import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIXTURE_ISO } from "../runtime-semantics/runtime-semantics.test-fixture.js";
import {
  EXPLICIT_CORRECTION_CLI_PROVENANCE,
  explicitCorrectionTransformId,
} from "../runtime-semantics/capture-correction-mapper.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";
import { runAmpInit } from "./init.js";
import { createProjectionRenderSource } from "./projection-source.js";
import { runAmpRuntimeInspect, formatAmpRuntimeInspectJson } from "./runtime-inspect.js";
import {
  formatAmpRuntimeCorrectReport,
  runAmpRuntimeCorrect,
} from "./runtime.js";

describe("runAmpRuntimeCorrect", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-runtime-correct-cli-"));
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

  it("persists an explicit correction and surfaces it in runtime inspect", async () => {
    const { projectRoot, env, fakeHome } = await initProject("correct-inspect");
    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });

    const result = runAmpRuntimeCorrect({
      projectRoot,
      env,
      homedir: () => fakeHome,
      id: "frame-123",
      note: "Reclassify as correction_event",
      recordId: "correction-frame-123",
      occurredAt: FIXTURE_ISO,
      recordedAt: FIXTURE_ISO,
    });

    assert.equal(result.ok, true);
    assert.equal(result.storageWired, true);
    assert.equal(result.recordId, "correction-frame-123");

    const inspect = runAmpRuntimeInspect({
      projectRoot,
      env,
      homedir: () => fakeHome,
      entity: "episodic-frame",
    });

    assert.equal(inspect.ok, true);
    assert.equal(inspect.records.length, 1);
    assert.equal(inspect.records[0]?.id, "correction-frame-123");
    assert.equal(inspect.records[0]?.ok, true);

    const runtime = openRuntimeStore(context.runtimeDbPath);
    try {
      assert.equal(runtime.queueList().length, 0);
      assert.equal(runtime.semanticEntityList().length, 1);
    } finally {
      runtime.close();
    }

    const text = formatAmpRuntimeCorrectReport(result).join("\n");
    assert.match(text, /correction-frame-123/);
    assert.match(text, /Reclassify as correction_event/);
    assert.match(text, /OK Runtime correction captured/);

    const payload = inspect.records[0]?.payload as {
      details?: Record<string, unknown>;
      provenance?: { transform_id?: string };
      source_signals?: string[];
    };
    assert.equal(payload.details?.source_surface, EXPLICIT_CORRECTION_CLI_PROVENANCE.sourceSurface);
    assert.equal(payload.details?.source_command, EXPLICIT_CORRECTION_CLI_PROVENANCE.sourceCommand);
    assert.equal(
      payload.provenance?.transform_id,
      explicitCorrectionTransformId("cli"),
    );

    const inspectJson = JSON.parse(formatAmpRuntimeInspectJson(inspect)) as {
      records: Array<{ payload: typeof payload }>;
    };
    assert.equal(inspectJson.records[0]?.payload.details?.source_surface, "cli");
  });

  it("surfaces explicit corrections in local runtime projection output", async () => {
    const { projectRoot, env, fakeHome } = await initProject("correct-projection");
    const note = "Correction visible in runtime projection";

    const result = runAmpRuntimeCorrect({
      projectRoot,
      env,
      homedir: () => fakeHome,
      id: "frame-proj",
      note,
      recordId: "correction-frame-proj",
      scope: "project",
      occurredAt: FIXTURE_ISO,
      recordedAt: FIXTURE_ISO,
    });
    assert.equal(result.ok, true);

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
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
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");
      assert.ok(projectRuntime);
      assert.match(projectRuntime.body, new RegExp(note));
      assert.match(projectRuntime.body, /Details omitted from runtime projection\./);
      assert.doesNotMatch(projectRuntime.body, /source_surface/);
      assert.doesNotMatch(projectRuntime.body, /source_command/);
      assert.match(
        projectRuntime.body,
        new RegExp(explicitCorrectionTransformId("cli").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    } finally {
      resolved.cleanup();
    }
  });

  it("returns duplicate_id for repeated correction record ids", async () => {
    const { projectRoot, env, fakeHome } = await initProject("correct-duplicate");

    const options = {
      projectRoot,
      env,
      homedir: () => fakeHome,
      id: "frame-dup",
      note: "First correction",
      recordId: "correction-frame-dup",
      occurredAt: FIXTURE_ISO,
      recordedAt: FIXTURE_ISO,
    };

    assert.equal(runAmpRuntimeCorrect(options).ok, true);
    const duplicate = runAmpRuntimeCorrect({
      ...options,
      note: "Second correction",
    });

    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.reason, "duplicate_id");
  });

  it("fails closed for whitespace-only notes", async () => {
    const { projectRoot, env, fakeHome } = await initProject("correct-invalid-note");

    const result = runAmpRuntimeCorrect({
      projectRoot,
      env,
      homedir: () => fakeHome,
      id: "frame-123",
      note: "   ",
      recordId: "correction-frame-123",
      occurredAt: FIXTURE_ISO,
      recordedAt: FIXTURE_ISO,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_note");
    assert.match(formatAmpRuntimeCorrectReport(result).join("\n"), /ERROR/);
  });
});
