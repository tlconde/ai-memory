/**
 * gbrain-backed harness retrieval E2E (V1-28).
 *
 * Falsifiable claims:
 * - Fake gbrain E2E: VERIFIED (capture → runtime → consolidateToGbrain → harness-style read)
 * - Live gbrain serve: PROVISIONAL/UNKNOWN (not exercised here)
 * - Live Hermes session: UNKNOWN (not exercised here)
 *
 * "Harness-style retrieval" simulates another harness reading consolidated knowledge
 * via the gbrain adapter list/read path — not a live Hermes or Cursor session load.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { consolidateToGbrain } from "../substrate/consolidation/gbrain-consolidation.js";
import {
  retrievePreference,
  type RetrievePreferenceInput,
  type RetrievedPreference,
} from "../substrate/retrieve-preference.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  createV1FixtureProject,
  destroyV1FixtureProject,
  discoverFixtureAmpConfig,
  type V1FixtureProject,
} from "./fixtures/v1-project.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

/** Harness-style read via gbrain adapter list path (async SSA backend). */
async function harnessRetrievePreferenceFromGbrain(
  adapter: GbrainKnowledgeAdapter,
  input: RetrievePreferenceInput
): Promise<RetrievedPreference | undefined> {
  const listResult = await adapter.listFrames({
    scopeKind: input.scope,
    projectRef: input.projectRef,
    curationMode: "personal",
  });
  assert.equal(listResult.success, true);
  if (!listResult.success) return undefined;

  const filtered = input.query
    ? listResult.items.filter((frame) =>
        typeof frame.content === "string"
          ? frame.content.toLowerCase().includes(input.query!.toLowerCase())
          : JSON.stringify(frame.content).toLowerCase().includes(input.query!.toLowerCase())
      )
    : listResult.items;

  const frame = filtered[0];
  return frame ? { frame } : undefined;
}

describe("gbrain-backed harness retrieval E2E", () => {
  let fixture: V1FixtureProject;
  let runtime: RuntimeStore;
  let transport: FakeGbrainMcpTransport;
  let adapter: GbrainKnowledgeAdapter;

  before(async () => {
    fixture = await createV1FixtureProject({ knowledgeMode: "local-gbrain" });
    runtime = new RuntimeStore({ dbPath: fixture.runtimeDbPath });
    transport = new FakeGbrainMcpTransport();
    adapter = new GbrainKnowledgeAdapter({ transport, ssaSpecPath: GBRAIN_SPEC });
  });

  after(async () => {
    runtime.close();
    await destroyV1FixtureProject(fixture);
  });

  it("capture → runtime → consolidateToGbrain → harness-style retrieval via gbrain adapter", async () => {
    const config = discoverFixtureAmpConfig(fixture);
    const preference = "Prefer explicit return types on exported AMP functions.";

    const capture = capturePreference(runtime, {
      content: preference,
      scope: "project",
      projectRef: config.projectRef,
      surface: "cursor",
    });

    assert.ok(capture.queued);
    assert.ok(runtime.queuePeek(), "preference should be queued in runtime");

    const consolidation = await consolidateToGbrain(runtime, adapter);
    assert.equal(consolidation.processed, 1);
    assert.equal(runtime.queuePeek(), undefined, "runtime queue should be drained after gbrain write");

    const retrieved = await harnessRetrievePreferenceFromGbrain(adapter, {
      scope: "project",
      projectRef: config.projectRef,
      query: "return types",
    });

    assert.equal(retrieved?.frame.content, preference);
    assert.equal(retrieved?.frame.curation_mode, "personal");
    assert.equal(retrieved?.frame.source.surface, "cursor");
    assert.equal(retrieved?.frame.scope.kind, "project");
    if (retrieved?.frame.scope.kind === "project") {
      assert.equal(retrieved.frame.scope.project_ref, config.projectRef);
    }

    const readById = await adapter.readFrame(consolidation.frameIds[0]!);
    assert.equal(readById.success, true);
    if (!readById.success) return;
    assert.equal(readById.items[0]?.content, preference);
  });

  it("KnowledgeStore-compatible read after consolidation matches retrievePreference semantics", async () => {
    const config = discoverFixtureAmpConfig(fixture);
    const preference = "Never force-push to main.";

    capturePreference(runtime, {
      content: preference,
      scope: "project",
      projectRef: config.projectRef,
      surface: "claude-code",
    });

    await consolidateToGbrain(runtime, adapter);

    const listResult = await adapter.listFrames({
      scopeKind: "project",
      projectRef: config.projectRef,
      curationMode: "personal",
    });
    assert.equal(listResult.success, true);
    if (!listResult.success) return;

    const knowledge = new InMemoryKnowledgeStore();
    knowledge.write(listResult.items);

    const retrieved = retrievePreference(knowledge, {
      scope: "project",
      projectRef: config.projectRef,
      query: "force-push",
    });

    assert.equal(retrieved?.frame.content, preference);
    assert.equal(retrieved?.frame.source.surface, "claude-code");
  });
});
