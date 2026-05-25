import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { AMP_USER_CONFIG_PATH_ENV } from "../config/paths.js";
import { runAmpCapture } from "./capture.js";
import { formatAmpConsolidateMessages, runAmpConsolidate } from "./consolidate.js";
import { runAmpInit } from "./init.js";
import { runAmpRetrieve } from "./retrieve.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

describe("runAmpConsolidate", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-consolidate-cli-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("consolidates runtime queue via in-memory backend", async () => {
    const projectRoot = join(tempRoot, "in-memory-flow");
    await runAmpInit({ projectRoot });
    const env = {
      [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user-config.yaml"),
    };

    runAmpCapture({
      projectRoot,
      content: "Run tests before commit.",
      scope: "project",
      env,
    });

    const knowledge = new InMemoryKnowledgeStore();
    const result = await runAmpConsolidate({
      projectRoot,
      knowledge: "in-memory",
      inMemoryStore: knowledge,
      env,
    });

    assert.equal(result.processed, 1);
    assert.equal(result.knowledgeBackend, "in-memory");
    assert.match(result.frameIds[0], /^frame-/);

    const retrieved = await runAmpRetrieve({
      projectRoot,
      knowledge: "in-memory",
      inMemoryStore: knowledge,
      query: "tests before commit",
      env,
    });

    assert.equal(retrieved.preferences.length, 1);
    assert.equal(retrieved.preferences[0]?.frame.content, "Run tests before commit.");
  });

  it("consolidates runtime queue via fake-gbrain backend", async () => {
    const projectRoot = join(tempRoot, "fake-gbrain-flow");
    await runAmpInit({ projectRoot });
    const env = {
      [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user-config.yaml"),
    };

    runAmpCapture({
      projectRoot,
      content: "Label external claims honestly.",
      scope: "project",
      env,
    });

    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });

    const result = await runAmpConsolidate({
      projectRoot,
      knowledge: "fake-gbrain",
      gbrainAdapter: adapter,
      ampRepoRoot: REPO_ROOT,
      env,
    });

    assert.equal(result.processed, 1);
    assert.equal(result.knowledgeBackend, "fake-gbrain");

    const retrieved = await runAmpRetrieve({
      projectRoot,
      knowledge: "fake-gbrain",
      gbrainAdapter: adapter,
      ampRepoRoot: REPO_ROOT,
      query: "external claims",
      env,
    });

    assert.equal(retrieved.preferences.length, 1);
    assert.equal(retrieved.preferences[0]?.frame.content, "Label external claims honestly.");
  });

  it("blocks live gbrain consolidate without explicit confirmation", async () => {
    const projectRoot = join(tempRoot, "live-guard");
    await runAmpInit({ projectRoot });
    const env = {
      [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user-config.yaml"),
    };

    runAmpCapture({
      projectRoot,
      content: "Should not reach live gbrain.",
      scope: "project",
      env,
    });

    await assert.rejects(
      () =>
        runAmpConsolidate({
          projectRoot,
          knowledge: "gbrain",
          env,
        }),
      /Live gbrain writes are disabled/
    );
  });

  it("returns zero processed when runtime queue is empty", async () => {
    const projectRoot = join(tempRoot, "empty-queue");
    await runAmpInit({ projectRoot });
    const env = {
      [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user-config.yaml"),
    };

    const result = await runAmpConsolidate({
      projectRoot,
      knowledge: "in-memory",
      env,
    });

    assert.equal(result.processed, 0);
    assert.deepEqual(result.frameIds, []);
  });

  it("formatAmpConsolidateMessages includes backend and next step", () => {
    const lines = formatAmpConsolidateMessages({
      processed: 2,
      frameIds: ["frame-a", "frame-b"],
      projectRoot: "/tmp/project",
      runtimeDbPath: "/tmp/project/.amp/runtime/runtime.db",
      knowledgeBackend: "in-memory",
    });

    assert.match(lines.join("\n"), /in-memory/);
    assert.match(lines.join("\n"), /frame-a/);
    assert.match(lines.join("\n"), /amp retrieve/i);
  });
});
