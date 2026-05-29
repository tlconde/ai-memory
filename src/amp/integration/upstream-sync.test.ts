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
import { runAmpUpstreamReview } from "../cli/upstream.js";
import { buildProjectionDocumentsWithReport } from "../projection/build-documents.js";
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
  stubSubscriptionUrl,
  UPSTREAM_TEST_SOURCE_ID,
  writeUpstreamFixture,
  type UpstreamIntegrationEnv,
} from "./fixtures/upstream-sync/helpers.js";

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

    const projection = buildProjectionDocumentsWithReport({
      frames: [],
      runtimeItems: [],
      projectRef: "amp-v1-fixture",
      revisionPrefix: "t1",
      pendingUpstreamChangesets: pending,
    });
    const projectRuntime = projection.documents.find((doc) => doc.metadata.kind === "project_runtime");
    assert.ok(projectRuntime?.body.includes(UPSTREAM_SYNC_MARKER.begin));

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

      const projectionAfter = buildProjectionDocumentsWithReport({
        frames: [],
        runtimeItems: [],
        projectRef: "amp-v1-fixture",
        revisionPrefix: "t1-after",
        pendingUpstreamChangesets: pendingAfter,
      });
      const bodyAfter = projectionAfter.documents.find((doc) => doc.metadata.kind === "project_runtime")?.body;
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

    const entry = env.registry.get("shared-skill");
    assert.ok(entry?.conflicts.some((conflict) => conflict.reason === "concurrent_edit"));

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
    const block = buildProjectionDocumentsWithReport({
      frames: [],
      runtimeItems: [],
      projectRef: "amp-v1-fixture",
      revisionPrefix: "t3",
      pendingUpstreamChangesets: pending,
    }).documents.find((doc) => doc.metadata.kind === "project_runtime")?.body;
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

    const projection = buildProjectionDocumentsWithReport({
      frames: [],
      runtimeItems: [],
      projectRef: "amp-v1-fixture",
      revisionPrefix: "t5",
      pendingUpstreamChangesets: pending,
    });
    const body = projection.documents.find((doc) => doc.metadata.kind === "project_runtime")?.body ?? "";
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

  it("poll with zero subscriptions exits silent", async () => {
    const env = await createUpstreamIntegrationEnv("poll-empty");
    envStack.push(env);

    const result = await runAmpUpstreamPoll({ env: env.env, projectRoot: env.fixture.root });
    assert.equal(result.ok, true);
    assert.equal(result.silent, true);
    assert.deepEqual(result.results, []);
  });
});
