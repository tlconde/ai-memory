/**
 * Upstream sync falsifiable tests T1–T5 (AMP §16.9).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { runAmpUpstreamApply } from "../cli/upstream.js";
import { runAmpUpstreamDismiss } from "../cli/upstream.js";
import { runAmpUpstreamPoll } from "../cli/upstream.js";
import { runAmpUpstreamSubscribe } from "../cli/upstream.js";
import {
  formatAmpUpstreamReviewReport,
  runAmpUpstreamReview,
} from "../cli/upstream.js";
import { createPropagationHarnessWriters } from "../cli/propagate.js";
import { applyChangeset } from "../upstream/apply.js";
import { expandApplyOnlyFilter } from "../upstream/apply-filters.js";
import { UPSTREAM_SYNC_MARKER } from "../upstream/projection-block.js";
import { UPSTREAM_SYNC_BLOCK_TOKEN_BUDGET } from "../upstream/projection-block.js";
import { listPendingChangesets } from "../upstream/changesets.js";
import { readChangeset } from "../upstream/changesets.js";
import { writeChangeset } from "../upstream/changesets.js";
import { formatChangesetId } from "../upstream/changesets.js";
import { runUpstreamSync } from "../upstream/sync.js";
import { StubUpstreamSource } from "../upstream/stub-source.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { parseEpisodicFrame } from "../runtime-semantics/schema.js";
import { estimateProjectionTextTokens } from "../projection/content.js";
import {
  createHarnessProcedure,
  createUpstreamIntegrationEnv,
  destroyUpstreamIntegrationEnv,
  loadProjectRuntimeViaMaterialize,
  stubSubscriptionUrl,
  UPSTREAM_TEST_SOURCE_ID,
  writeUpstreamFixture,
  type UpstreamIntegrationEnv,
} from "./fixtures/upstream-sync/helpers.js";
import { createCanonicalProcedure } from "../procedural/schema.js";

const envStack: UpstreamIntegrationEnv[] = [];

afterEach(async () => {
  while (envStack.length > 0) {
    const env = envStack.pop();
    if (env) {
      await destroyUpstreamIntegrationEnv(env);
    }
  }
});

async function subscribeStub(env: UpstreamIntegrationEnv): Promise<void> {
  await runAmpUpstreamSubscribe({
    url: stubSubscriptionUrl(env.fixtureRoot),
    id: UPSTREAM_TEST_SOURCE_ID,
    env: env.env,
  });
}

function createStubSource(env: UpstreamIntegrationEnv): StubUpstreamSource {
  return new StubUpstreamSource({
    id: UPSTREAM_TEST_SOURCE_ID,
    config: { url: stubSubscriptionUrl(env.fixtureRoot), policy: "local-wins" },
    fixtureDir: env.fixtureRoot,
    registry: env.registry,
  });
}

describe("AMP upstream sync §16.9", () => {
  it("T1: detect → surface → apply → audit → marker disappears", async () => {
    const env = await createUpstreamIntegrationEnv("t1");
    envStack.push(env);

    const newSkill = createHarnessProcedure("new-skill", "# New skill from upstream\n");
    await writeUpstreamFixture(env.fixtureRoot, {
      ref: "upstream-ref-t1",
      procedures: [newSkill],
    });

    await subscribeStub(env);

    const poll = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-27T10:30:22.000Z"),
    });
    assert.equal(poll[0]?.driftDetected, true);

    const pending = await listPendingChangesets({ env: env.env });
    assert.equal(pending.length, 1);

    const projectRuntimeBody = await loadProjectRuntimeViaMaterialize(env);
    assert.ok(projectRuntimeBody?.includes(UPSTREAM_SYNC_MARKER.begin));

    const runtime = new RuntimeStore({ dbPath: env.fixture.runtimeDbPath });
    try {
      const apply = await runAmpUpstreamApply({
        changesetId: pending[0]!.id,
        projectRoot: env.fixture.root,
        registry: env.registry,
        runtimeDbPath: env.fixture.runtimeDbPath,
        env: env.env,
      });
      assert.equal(apply.ok, true);
      assert.ok(existsSync(join(env.fixture.harnessRoots.cursorFromAmp, "new-skill.mdc")));
      assert.ok(existsSync(join(env.fixture.harnessRoots.claudeCodeFromAmp, "new-skill", "SKILL.md")));
      assert.ok(existsSync(join(env.fixture.harnessRoots.hermesFromAmp, "new-skill", "SKILL.md")));

      const auditRows = runtime
        .semanticEntityList()
        .filter((row) => row.kind === "episodic-frame");
      assert.ok(auditRows.length >= 1);
      const frame = parseEpisodicFrame(auditRows[0]!.payload);
      assert.equal(frame.event_type, "upstream_applied");

      const pendingAfter = await listPendingChangesets({ env: env.env });
      assert.equal(pendingAfter.length, 0);

      const bodyAfter = await loadProjectRuntimeViaMaterialize(env);
      assert.ok(!bodyAfter?.includes(UPSTREAM_SYNC_MARKER.begin));
    } finally {
      runtime.close();
    }
  });

  it("T2: concurrent local edit refuses apply without --accept-upstream", async () => {
    const env = await createUpstreamIntegrationEnv("t2");
    envStack.push(env);

    const local = createHarnessProcedure("shared-skill", "# Local body\n");
    local.frontmatter.provenance = {
      ...local.frontmatter.provenance!,
      updated_at: "2026-05-28T12:00:00.000Z",
    };
    env.registry.register(local);

    const upstreamSkill = createHarnessProcedure("shared-skill", "# Upstream body\n");
    upstreamSkill.frontmatter.provenance = {
      ...upstreamSkill.frontmatter.provenance!,
      updated_at: "2026-05-28T13:00:00.000Z",
    };

    await writeUpstreamFixture(env.fixtureRoot, {
      ref: "upstream-ref-t2",
      procedures: [upstreamSkill],
    });

    await subscribeStub(env);

    // Optimizer (§2) does not exist yet — simulate local edit via provenance.updated_at > upstream_synced_at.
    const poll = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-28T14:00:00.000Z"),
    });
    assert.equal(poll[0]?.driftDetected, true);

    const changeset = await readChangeset(poll[0]!.changesetId!, { env: env.env });
    assert.ok(changeset);
    assert.ok(changeset.conflictsWithLocalEdits.length > 0);
    assert.ok(
      changeset.conflictsWithLocalEdits.some(
        (entry) => entry.conflict.reason === "concurrent_edit"
      )
    );

    const refused = await runAmpUpstreamApply({
      changesetId: changeset.id,
      projectRoot: env.fixture.root,
      registry: env.registry,
      env: env.env,
    });
    assert.equal(refused.ok, false);
    assert.match(refused.error ?? "", /--accept-upstream/);
  });

  it("T3: schema migration labeled HIGH; apply refuses without --confirm-breaking", async () => {
    const env = await createUpstreamIntegrationEnv("t3");
    envStack.push(env);

    await writeUpstreamFixture(env.fixtureRoot, {
      ref: "upstream-ref-t3",
      procedures: [],
      schemaChanges: [
        {
          id: "required-field-v2",
          description: "Required new frontmatter field",
          breaking: true,
        },
      ],
    });

    await subscribeStub(env);

    const poll = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-27T11:00:00.000Z"),
    });
    assert.equal(poll[0]?.driftDetected, true);

    const changeset = await readChangeset(poll[0]!.changesetId!, { env: env.env });
    assert.equal(changeset?.riskClass, "high");

    const pending = await listPendingChangesets({ env: env.env });
    const block = await loadProjectRuntimeViaMaterialize(env);
    assert.ok(block?.includes("HIGH risk"));

    const refused = await runAmpUpstreamApply({
      changesetId: changeset!.id,
      projectRoot: env.fixture.root,
      registry: env.registry,
      env: env.env,
    });
    assert.equal(refused.ok, false);
    assert.match(refused.error ?? "", /--confirm-breaking/);
  });

  it("T4: dismiss suppresses re-surface until upstream changes again", async () => {
    const env = await createUpstreamIntegrationEnv("t4");
    envStack.push(env);

    const skill = createHarnessProcedure("dismiss-skill");
    await writeUpstreamFixture(env.fixtureRoot, {
      ref: "upstream-ref-t4-a",
      procedures: [skill],
    });

    await subscribeStub(env);

    const first = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-27T12:00:00.000Z"),
    });
    const firstId = first[0]!.changesetId!;

    await runAmpUpstreamDismiss({ id: firstId, env: env.env });

    const silent = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-27T12:05:00.000Z"),
    });
    assert.equal(silent[0]?.driftDetected, false);

    const updated = createHarnessProcedure("dismiss-skill", "# Updated upstream\n");
    await writeUpstreamFixture(env.fixtureRoot, {
      ref: "upstream-ref-t4-b",
      procedures: [updated],
    });

    const second = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-27T12:10:00.000Z"),
    });
    assert.equal(second[0]?.driftDetected, true);
    assert.notEqual(second[0]?.changesetId, firstId);
  });

  it("T5: 20 low-risk changesets collapse under 200-token budget; review has full diff", async () => {
    const env = await createUpstreamIntegrationEnv("t5");
    envStack.push(env);

    const detectedAt = new Date("2026-05-27T15:00:00.000Z");
    for (let index = 0; index < 20; index += 1) {
      const id = formatChangesetId(UPSTREAM_TEST_SOURCE_ID, new Date(detectedAt.getTime() + index * 1000));
      await writeChangeset(
        {
          id,
          sourceId: UPSTREAM_TEST_SOURCE_ID,
          detectedAt: new Date(detectedAt.getTime() + index * 1000).toISOString(),
          ref: { local: "local", upstream: `upstream-${index}` },
          added: [{ id: `skill-${index}`, version: "0.1.0" }],
          updated: [],
          removed: [],
          breakingChanges: [],
          conflictsWithLocalEdits: [],
          riskClass: "low",
        },
        { env: env.env }
      );
    }

    const pending = await listPendingChangesets({ env: env.env });
    assert.equal(pending.length, 20);

    const projectionBody = await loadProjectRuntimeViaMaterialize(env);
    const body = projectionBody ?? "";
    assert.ok(body.includes(UPSTREAM_SYNC_MARKER.begin));

    const markerStart = body.indexOf(UPSTREAM_SYNC_MARKER.begin);
    const markerEnd = body.indexOf(UPSTREAM_SYNC_MARKER.end);
    const blockText = body.slice(markerStart, markerEnd + UPSTREAM_SYNC_MARKER.end.length);
    assert.ok(estimateProjectionTextTokens(blockText) <= UPSTREAM_SYNC_BLOCK_TOKEN_BUDGET);
    assert.ok(blockText.includes("low-risk upstream update"));

    const review = await runAmpUpstreamReview({ id: pending[0]!.id, env: env.env });
    assert.equal(review.ok, true);
    assert.ok(review.changeset?.added.length === 1);
  });

  it("B1: local-only procedure never appears in removed", async () => {
    const env = await createUpstreamIntegrationEnv("b1-local-only");
    envStack.push(env);

    const tracked = createHarnessProcedure("tracked-skill");
    env.registry.register(tracked);

    const localOnly = createCanonicalProcedure({
      name: "local-only-skill",
      description: "User-owned local procedure.",
      provenance: {
        source: "user",
        created_at: "2026-05-27T10:00:00.000Z",
      },
    });
    env.registry.register(localOnly);

    await writeUpstreamFixture(env.fixtureRoot, {
      ref: "upstream-ref-b1",
      procedures: [],
    });

    await subscribeStub(env);

    const poll = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-27T11:00:00.000Z"),
    });
    assert.equal(poll[0]?.driftDetected, true);

    const changeset = await readChangeset(poll[0]!.changesetId!, { env: env.env });
    assert.ok(changeset);
    assert.ok(changeset.removed.some((entry) => entry.id === "tracked-skill"));
    assert.ok(!changeset.removed.some((entry) => entry.id === "local-only-skill"));
  });

  it("B3: audit failure rolls back registry without orphan harness files", async () => {
    const env = await createUpstreamIntegrationEnv("b3-audit-fail");
    envStack.push(env);

    const newSkill = createHarnessProcedure("rollback-skill", "# Rollback test\n");
    await writeUpstreamFixture(env.fixtureRoot, {
      ref: "upstream-ref-b3",
      procedures: [newSkill],
    });
    await subscribeStub(env);

    const poll = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-27T11:30:00.000Z"),
    });
    const changesetId = poll[0]!.changesetId!;

    const runtime = new RuntimeStore({ dbPath: env.fixture.runtimeDbPath });
    try {
      const result = await applyChangeset({
        changesetId,
        registry: env.registry,
        source: createStubSource(env),
        writers: createPropagationHarnessWriters(env.fixture.root),
        runtime,
        env: env.env,
        writeAudit: () => ({
          ok: false,
          reason: "duplicate_id",
          message: "Injected audit failure",
        }),
      });
      assert.equal(result.ok, false);
      assert.equal(env.registry.get("rollback-skill"), undefined);
      assert.ok(
        !existsSync(join(env.fixture.harnessRoots.cursorFromAmp, "rollback-skill.mdc"))
      );
    } finally {
      runtime.close();
    }
  });

  it("category --only added expands to added procedure names", async () => {
    const env = await createUpstreamIntegrationEnv("category-only");
    envStack.push(env);

    const added = createHarnessProcedure("cat-added");
    const updated = createHarnessProcedure("cat-updated", "# v2\n");
    await writeUpstreamFixture(env.fixtureRoot, {
      ref: "upstream-ref-cat",
      procedures: [added, updated],
    });
    env.registry.register(createHarnessProcedure("cat-updated", "# v1\n"));

    const poll = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-27T12:00:00.000Z"),
    });
    const changeset = await readChangeset(poll[0]!.changesetId!, { env: env.env });
    assert.ok(changeset);

    const expanded = expandApplyOnlyFilter(changeset!, ["added"]);
    assert.deepEqual(expanded, ["cat-added"]);
  });

  it("partial apply leaves changeset partially-applied", async () => {
    const env = await createUpstreamIntegrationEnv("partial-apply");
    envStack.push(env);

    const skillA = createHarnessProcedure("partial-a");
    const skillB = createHarnessProcedure("partial-b");
    await writeUpstreamFixture(env.fixtureRoot, {
      ref: "upstream-ref-partial",
      procedures: [skillA, skillB],
    });
    await subscribeStub(env);

    const poll = await runUpstreamSync({
      env: env.env,
      sources: [createStubSource(env)],
      registry: env.registry,
      detectedAt: new Date("2026-05-27T12:30:00.000Z"),
    });
    const changesetId = poll[0]!.changesetId!;

    const apply = await runAmpUpstreamApply({
      changesetId,
      projectRoot: env.fixture.root,
      registry: env.registry,
      only: ["partial-a"],
      env: env.env,
    });
    assert.equal(apply.ok, true);

    const stored = await readChangeset(changesetId, { env: env.env });
    assert.equal(stored?.status, "partially-applied");
    const pending = await listPendingChangesets({ env: env.env });
    assert.equal(pending.length, 1);
  });

  it("review --json differs from human output", async () => {
    const env = await createUpstreamIntegrationEnv("review-json");
    envStack.push(env);

    await writeChangeset(
      {
        id: "review-json-test",
        sourceId: UPSTREAM_TEST_SOURCE_ID,
        detectedAt: "2026-05-27T13:00:00.000Z",
        ref: { local: "local", upstream: "upstream" },
        added: [{ id: "demo-skill", version: "0.1.0" }],
        updated: [],
        removed: [],
        breakingChanges: [],
        conflictsWithLocalEdits: [],
        riskClass: "low",
      },
      { env: env.env }
    );

    const human = await runAmpUpstreamReview({ id: "review-json-test", env: env.env });
    const json = await runAmpUpstreamReview({ id: "review-json-test", json: true, env: env.env });
    assert.equal(human.ok, true);
    assert.equal(json.ok, true);

    const humanText = formatAmpUpstreamReviewReport(human).join("\n");
    const jsonText = formatAmpUpstreamReviewReport(json).join("\n");
    assert.notEqual(humanText, jsonText);
    assert.ok(humanText.includes("Changeset: review-json-test"));
    assert.ok(jsonText.includes('"id": "review-json-test"'));
    assert.ok(!humanText.includes('"id": "review-json-test"'));
  });

  it("poll with zero subscriptions exits silent", async () => {
    const env = await createUpstreamIntegrationEnv("poll-empty");
    envStack.push(env);

    const result = await runAmpUpstreamPoll({ env: env.env, projectRoot: env.fixture.root });
    assert.equal(result.ok, true);
    assert.equal(result.silent, true);
    assert.deepEqual(result.results, []);
  });
});
