import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import { createFrame } from "../core/frame-schema.js";
import { AMP_USER_CONFIG_PATH_ENV } from "../config/paths.js";
import { runAmpCapture } from "./capture.js";
import {
  formatAmpConsolidateMessages,
  formatConsolidateKnowledgeSourceLabel,
  runAmpConsolidate,
} from "./consolidate.js";
import { openRuntimeStore } from "./cli-context.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";
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

  it("consolidates runtime queue via default local persistent knowledge.db", async () => {
    const projectRoot = join(tempRoot, "local-persistent-flow");
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

    const result = await runAmpConsolidate({
      projectRoot,
      env,
    });

    assert.equal(result.processed, 1);
    assert.equal(result.knowledgeBackend, "local-persistent");
    assert.equal(result.knowledgeSource, "local-sqlite");
    assert.equal(result.liveGbrain, undefined);
    assert.match(result.frameIds[0], /^frame-/);

    const knowledgeDbPath = resolveLocalKnowledgeDbPath(result.runtimeDbPath);
    assert.equal(existsSync(knowledgeDbPath), true);

    const knowledge = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
    try {
      const frame = knowledge.read(result.frameIds[0]!);
      assert.equal(frame?.content, "Run tests before commit.");
    } finally {
      knowledge.close();
    }

    const runtime = openRuntimeStore(result.runtimeDbPath);
    try {
      assert.equal(runtime.queueList().length, 0);
    } finally {
      runtime.close();
    }

    const retrieved = await runAmpRetrieve({
      projectRoot,
      query: "tests before commit",
      env,
    });

    assert.equal(retrieved.knowledgeBackend, "local-persistent");
    assert.equal(retrieved.knowledgeSource, "local-sqlite");
    assert.equal(retrieved.preferences.length, 1);
    assert.equal(retrieved.preferences[0]?.frame.content, "Run tests before commit.");
    assert.equal(retrieved.preferences[0]?.frame.id, result.frameIds[0]);

    const messages = formatAmpConsolidateMessages(result);
    assert.match(messages.join("\n"), /local persistent knowledge\.db/);
    assert.equal(
      formatConsolidateKnowledgeSourceLabel(result),
      "local persistent knowledge.db",
    );
  });

  it("does not construct gbrain adapter on default local persistent consolidate", async () => {
    const projectRoot = join(tempRoot, "local-no-gbrain");
    await runAmpInit({ projectRoot });
    const env = {
      [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user-config.yaml"),
    };

    runAmpCapture({
      projectRoot,
      content: "No gbrain on default consolidate.",
      scope: "project",
      env,
    });

    const result = await runAmpConsolidate({
      projectRoot,
      env,
    });

    assert.equal(result.knowledgeBackend, "local-persistent");
    assert.equal(result.knowledgeSource, "local-sqlite");
    assert.equal(result.liveGbrain, undefined);
    assert.equal(result.processed, 1);
  });

  it("retains queue when local consolidate hits duplicate frame id", async () => {
    const projectRoot = join(tempRoot, "local-duplicate-frame");
    await runAmpInit({ projectRoot });
    const env = {
      [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user-config.yaml"),
    };

    const captureResult = runAmpCapture({
      projectRoot,
      content: "Duplicate frame id safety.",
      scope: "project",
      env,
    });

    const frameId = `frame-${captureResult.signalId}`;
    const knowledgeDbPath = resolveLocalKnowledgeDbPath(captureResult.runtimeDbPath);
    const knowledge = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
    try {
      knowledge.write([
        createFrame({
          id: frameId,
          kind: "semantic",
          content: "Already persisted frame.",
          source: { surface: "seed", captured_at: "2026-05-29T12:00:00.000Z" },
          created_at: "2026-05-29T12:00:00.000Z",
          scope: { kind: "project", project_ref: captureResult.projectRef! },
          curation_mode: "personal",
        }),
      ]);
    } finally {
      knowledge.close();
    }

    await assert.rejects(
      () => runAmpConsolidate({ projectRoot, env }),
      /Duplicate knowledge frame id/,
    );

    const runtime = openRuntimeStore(captureResult.runtimeDbPath);
    try {
      assert.equal(runtime.queueList().length, 1);
      assert.equal(runtime.queueList()[0]?.id, captureResult.signalId);
    } finally {
      runtime.close();
    }
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
    assert.equal(result.knowledgeSource, "in-memory");
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
    assert.equal(result.knowledgeSource, "gbrain");

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
      knowledgeBackend: "local-persistent",
      knowledgeSource: "local-sqlite",
    });

    assert.match(lines.join("\n"), /local persistent knowledge\.db/);
    assert.match(lines.join("\n"), /frame-a/);
    assert.match(lines.join("\n"), /amp retrieve/i);
  });
});
