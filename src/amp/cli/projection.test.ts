import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import { createFrame } from "../core/frame-schema.js";
import { PROJECTION_FILE_KINDS } from "../projection/constants.js";
import {
  DB_BACKED_MATERIALIZATION_NOT_WIRED,
  LEGACY_PROJECTION_KNOWLEDGE_BACKEND_UNAVAILABLE,
} from "../projection/messages.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";
import { AMP_KNOWLEDGE_BACKEND_ENV, resolveLocalKnowledgeDbPath, resolveProjectionKnowledgeStore } from "./knowledge-backend.js";
import { runAmpInit } from "./init.js";
import { runAmpRuntimeGraduationApply } from "./runtime-graduation-apply.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";
import {
  createProjectionRenderSource,
  materializeProjectionRenderSource,
} from "./projection-source.js";
import {
  formatAmpProjectionRenderReport,
  runAmpProjectionRender,
} from "./projection.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");
const GENERATED_AT = "2026-05-27T10:00:00.000Z";
const PREFERENCE_ISO = "2026-05-26T12:00:00.000Z";

const ACTIVE_PREFERENCE = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded" as const,
  scope: "user" as const,
  context: {},
  status: "active" as const,
  expires_at: PREFERENCE_ISO,
  first_observed_at: PREFERENCE_ISO,
  last_observed_at: PREFERENCE_ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium" as const,
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

describe("projection source factory", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-projection-source-factory-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("closes local projection runtime store after successful dry-run", async () => {
    const projectRoot = join(tempRoot, "local-runtime-close-dry-run");
    const fakeHome = join(tempRoot, "home-local-runtime-close-dry-run");
    const env = { HOME: fakeHome, AMP_KNOWLEDGE_BACKEND: "in-memory" };
    await runAmpInit({ projectRoot, env });

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtime = openRuntimeStore(context.runtimeDbPath);
    let closeCalls = 0;
    const originalClose = runtime.close.bind(runtime);
    runtime.close = () => {
      closeCalls += 1;
      originalClose();
    };

    const resolved = createProjectionRenderSource({
      sourceKind: "local",
      projectRef: "local-runtime-close-dry-run",
      runtimeDbPath: context.runtimeDbPath,
      knowledgeStore: new InMemoryKnowledgeStore(),
      env,
      deps: { openRuntimeStore: () => runtime },
    });

    assert.ok(!("error" in resolved));

    const plan = await materializeProjectionRenderSource(resolved, {
      projectRoot,
      mode: "dry-run",
      projectRef: "local-runtime-close-dry-run",
      env,
      homedir: () => fakeHome,
    });

    assert.equal(plan.ok, true);
    assert.equal(closeCalls, 1);
  });

  it("closes local projection runtime store when materialization throws", async () => {
    const projectRoot = join(tempRoot, "local-runtime-close-error");
    const fakeHome = join(tempRoot, "home-local-runtime-close-error");
    const env = { HOME: fakeHome, AMP_KNOWLEDGE_BACKEND: "in-memory" };
    await runAmpInit({ projectRoot, env });

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtime = openRuntimeStore(context.runtimeDbPath);
    let closeCalls = 0;
    const originalClose = runtime.close.bind(runtime);
    runtime.close = () => {
      closeCalls += 1;
      originalClose();
    };

    const resolved = createProjectionRenderSource({
      sourceKind: "local",
      projectRef: "local-runtime-close-error",
      runtimeDbPath: context.runtimeDbPath,
      knowledgeStore: new InMemoryKnowledgeStore(),
      env,
      deps: { openRuntimeStore: () => runtime },
    });

    assert.ok(!("error" in resolved));

    await assert.rejects(
      () =>
        materializeProjectionRenderSource(
          resolved,
          {
            projectRoot,
            mode: "dry-run",
            projectRef: "local-runtime-close-error",
            env,
            homedir: () => fakeHome,
          },
          {
            materializeProjections: async () => {
              throw new Error("simulated materialization failure");
            },
          }
        ),
      /simulated materialization failure/
    );

    assert.equal(closeCalls, 1);
  });
});

describe("runAmpProjectionRender", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-projection-cli-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("dry-run plans all four projection paths without writing files", async () => {
    const projectRoot = join(tempRoot, "dry-run-all");
    const fakeHome = join(tempRoot, "home-dry-run-all");
    await runAmpInit({ projectRoot, env: { HOME: fakeHome } });

    const result = await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "placeholder");
    assert.equal(result.dryRun, true);
    assert.equal(result.projectRef, "dry-run-all");
    assert.equal(result.writes.length, 4);
    assert.deepEqual(
      result.writes.map((write) => write.kind),
      [...PROJECTION_FILE_KINDS]
    );
    assert.deepEqual(
      result.writes.map((write) => write.path),
      [
        join(fakeHome, ".amp", "projection", "global.md"),
        join(fakeHome, ".amp", "runtime", "global.md"),
        join(projectRoot, ".amp", "local", "projection.md"),
        join(projectRoot, ".amp", "local", "runtime.md"),
      ]
    );

    for (const write of result.writes) {
      assert.equal(write.dryRun, true);
      assert.equal(write.wrote, false);
      assert.equal(existsSync(write.path), false);
    }

    assert.ok(result.budget);
    assert.equal(result.budget.success, true);
    assert.equal(result.budget.combined.status, "ok");
  });

  it("refuses non-dry-run apply when placeholder source does not support apply", async () => {
    const projectRoot = join(tempRoot, "no-dry-run");
    await runAmpInit({ projectRoot });

    const result = await runAmpProjectionRender({ projectRoot, dryRun: false });

    assert.equal(result.ok, false);
    assert.equal(result.source, "placeholder");
    assert.equal(result.dryRun, false);
    assert.equal(result.blocked, true);
    assert.equal(result.error, DB_BACKED_MATERIALIZATION_NOT_WIRED);
    assert.equal(result.budget, undefined);
    assert.equal(result.writes.length, 0);
  });

  it("requires project AMP config", async () => {
    const projectRoot = join(tempRoot, "missing-config");

    const result = await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Project AMP config not found/);
    assert.match(result.error ?? "", /ai-memory amp init/);
    assert.equal(result.budget, undefined);
    assert.equal(result.writes.length, 0);
  });

  it("reports budget status in formatted output", async () => {
    const projectRoot = join(tempRoot, "budget-report");
    const fakeHome = join(tempRoot, "home-budget-report");
    await runAmpInit({ projectRoot });

    const result = await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
      homedir: () => fakeHome,
    });
    const lines = formatAmpProjectionRenderReport(result);
    const text = lines.join("\n");

    assert.match(text, /source=placeholder/);
    assert.match(text, /Budget:/);
    assert.match(text, /combined: 0\/2000 \(ok\)/);
    assert.match(text, /Planned writes:/);
    assert.match(text, /global_projection ->/);
    assert.match(text, /project_runtime ->/);
    assert.match(text, /OK Projection dry-run finished/);
  });

  it("does not touch real homedir when homedir is injected", async () => {
    const projectRoot = join(tempRoot, "injected-home");
    const fakeHome = join(tempRoot, "isolated-home");
    await runAmpInit({ projectRoot });

    await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
      homedir: () => fakeHome,
    });

    assert.equal(existsSync(join(fakeHome, ".amp", "projection", "global.md")), false);
    assert.equal(existsSync(join(projectRoot, ".amp", "local", "projection.md")), false);
  });

  it("local dry-run plans four writes with injected knowledge store", async () => {
    const projectRoot = join(tempRoot, "local-dry-run");
    const ampUserRoot = join(tempRoot, "amp-user-local-dry-run");
    const fakeHome = join(tempRoot, "home-local-dry-run");
    const env = { HOME: fakeHome, AMP_USER_ROOT: ampUserRoot, AMP_KNOWLEDGE_BACKEND: "in-memory" };
    await runAmpInit({ projectRoot, env });

    const knowledge = new InMemoryKnowledgeStore();
    knowledge.write([
      createFrame({
        id: "local-pref",
        kind: "semantic",
        content: "Local dry-run preference.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "local-dry-run" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      homedir: () => fakeHome,
      env,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "local");
    assert.equal(result.dryRun, true);
    assert.equal(result.writes.length, 4);
    assert.deepEqual(
      result.writes.map((write) => write.path),
      [
        join(ampUserRoot, "projection", "global.md"),
        join(ampUserRoot, "runtime", "global.md"),
        join(projectRoot, ".amp", "local", "projection.md"),
        join(projectRoot, ".amp", "local", "runtime.md"),
      ]
    );
    for (const write of result.writes) {
      assert.equal(write.dryRun, true);
      assert.equal(existsSync(write.path), false);
    }
  });

  it("local apply writes four projection files under injected AMP_USER_ROOT and project .amp/local", async () => {
    const projectRoot = join(tempRoot, "local-apply");
    const ampUserRoot = join(tempRoot, "amp-user-local-apply");
    const fakeHome = join(tempRoot, "home-local-apply");
    const env = { HOME: fakeHome, AMP_USER_ROOT: ampUserRoot, AMP_KNOWLEDGE_BACKEND: "in-memory" };
    await runAmpInit({ projectRoot, env });

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtime = openRuntimeStore(context.runtimeDbPath);
    capturePreference(runtime, {
      content: "Runtime note for local apply.",
      scope: "project",
      projectRef: "local-apply",
    });
    runtime.close();

    const knowledge = new InMemoryKnowledgeStore();
    knowledge.write([
      createFrame({
        id: "apply-pref",
        kind: "semantic",
        content: "Local apply preference.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "local-apply" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      apply: true,
      homedir: () => fakeHome,
      env,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "local");
    assert.equal(result.dryRun, false);
    assert.equal(result.writes.length, 4);

    const canonicalPaths = [
      join(ampUserRoot, "projection", "global.md"),
      join(ampUserRoot, "runtime", "global.md"),
      join(projectRoot, ".amp", "local", "projection.md"),
      join(projectRoot, ".amp", "local", "runtime.md"),
    ];

    for (const path of canonicalPaths) {
      assert.equal(existsSync(path), true, `expected ${path} to exist`);
    }

    const projectProjection = await readFile(
      join(projectRoot, ".amp", "local", "projection.md"),
      "utf8"
    );
    const projectRuntime = await readFile(join(projectRoot, ".amp", "local", "runtime.md"), "utf8");
    assert.match(projectProjection, /Local apply preference\./);
    assert.match(projectRuntime, /Runtime note for local apply\./);
  });

  it("local source reads persistent knowledge.db without AMP_KNOWLEDGE_BACKEND=in-memory", async () => {
    const projectRoot = join(tempRoot, "local-persistent-default");
    const fakeHome = join(tempRoot, "home-local-persistent-default");
    const env = { HOME: fakeHome, AMP_KNOWLEDGE_BACKEND: "gbrain" };
    await runAmpInit({ projectRoot, env });

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      homedir: () => fakeHome,
      env,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "local");
    assert.equal(result.writes.length, 4);
  });

  it("local projection dry-run includes frames persisted by graduation apply", async () => {
    const projectRoot = join(tempRoot, "local-graduation-projection");
    const fakeHome = join(tempRoot, "home-local-graduation-projection");
    const env = { HOME: fakeHome };
    await runAmpInit({ projectRoot, env });

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

    const applyResult = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-confirmed",
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });
    assert.equal(applyResult.ok, true);

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const reopened = new LocalSqliteKnowledgeStore({
      dbPath: resolveLocalKnowledgeDbPath(context.runtimeDbPath),
    });
    try {
      assert.equal(reopened.read("runtime-graduation:pref-confirmed")?.kind, "semantic");
    } finally {
      reopened.close();
    }

    const resolved = createProjectionRenderSource({
      sourceKind: "local",
      projectRef: "local-graduation-projection",
      runtimeDbPath: context.runtimeDbPath,
    });
    assert.ok(!("error" in resolved));
    try {
      const documents = resolved.source.loadProjectionDocuments({
        projectRef: "local-graduation-projection",
      });
      const globalProjection = documents.find((doc) => doc.metadata.kind === "global_projection");
      assert.match(globalProjection?.body ?? "", /Keep responses short today/);
    } finally {
      resolved.cleanup();
    }

    const renderResult = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      homedir: () => fakeHome,
      env,
    });
    assert.equal(renderResult.ok, true);
  });

  it("local source with empty knowledge.db remains queue and runtime-semantics compatible", async () => {
    const projectRoot = join(tempRoot, "local-empty-knowledge-db");
    const fakeHome = join(tempRoot, "home-local-empty-knowledge-db");
    const env = { HOME: fakeHome };
    await runAmpInit({ projectRoot, env });

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtime = openRuntimeStore(context.runtimeDbPath);
    capturePreference(runtime, {
      content: "Queue-only runtime note.",
      scope: "project",
      projectRef: "local-empty-knowledge-db",
    });
    runtime.close();

    const resolved = createProjectionRenderSource({
      sourceKind: "local",
      projectRef: "local-empty-knowledge-db",
      runtimeDbPath: context.runtimeDbPath,
    });
    assert.ok(!("error" in resolved));
    try {
      const documents = resolved.source.loadProjectionDocuments({
        projectRef: "local-empty-knowledge-db",
      });
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");
      assert.match(projectRuntime?.body ?? "", /Queue-only runtime note\./);
    } finally {
      resolved.cleanup();
    }
  });

  it("fails legacy in-memory-only resolver when offline knowledge backend is unavailable", () => {
    const result = resolveProjectionKnowledgeStore({
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "gbrain" },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, LEGACY_PROJECTION_KNOWLEDGE_BACKEND_UNAVAILABLE);
    }
  });

  it("gbrain dry-run plans four writes without live gbrain when adapter is injected", async () => {
    const projectRoot = join(tempRoot, "gbrain-dry-run");
    const ampUserRoot = join(tempRoot, "amp-user-gbrain-dry-run");
    const fakeHome = join(tempRoot, "home-gbrain-dry-run");
    const env = { HOME: fakeHome, AMP_USER_ROOT: ampUserRoot };
    await runAmpInit({ projectRoot, env });

    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    await adapter.writeFrames([
      createFrame({
        id: "gbrain-cli-pref",
        kind: "semantic",
        content: "Gbrain CLI dry-run preference.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "gbrain-dry-run" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "gbrain",
      dryRun: true,
      homedir: () => fakeHome,
      env,
      gbrainAdapter: adapter,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "gbrain");
    assert.equal(result.dryRun, true);
    assert.equal(result.writes.length, 4);
    for (const write of result.writes) {
      assert.equal(write.dryRun, true);
      assert.equal(existsSync(write.path), false);
    }
  });

  it("gbrain apply writes projection files without requiring write confirmation", async () => {
    const projectRoot = join(tempRoot, "gbrain-apply");
    const ampUserRoot = join(tempRoot, "amp-user-gbrain-apply");
    const fakeHome = join(tempRoot, "home-gbrain-apply");
    const env = { HOME: fakeHome, AMP_USER_ROOT: ampUserRoot };
    await runAmpInit({ projectRoot, env });

    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    await adapter.writeFrames([
      createFrame({
        id: "gbrain-cli-apply",
        kind: "semantic",
        content: "Gbrain CLI apply preference.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "gbrain-apply" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "gbrain",
      apply: true,
      homedir: () => fakeHome,
      env,
      gbrainAdapter: adapter,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "gbrain");
    assert.equal(result.dryRun, false);

    const projectProjectionPath = join(projectRoot, ".amp", "local", "projection.md");
    assert.equal(existsSync(projectProjectionPath), true);
    const projectProjection = await readFile(projectProjectionPath, "utf8");
    assert.match(projectProjection, /Gbrain CLI apply preference\./);
  });

  it("gbrain source works without AMP_KNOWLEDGE_BACKEND=in-memory via fake-gbrain env", async () => {
    const projectRoot = join(tempRoot, "gbrain-fake-env");
    const fakeHome = join(tempRoot, "home-gbrain-fake-env");
    const env = { HOME: fakeHome, AMP_KNOWLEDGE_BACKEND: "fake-gbrain" };
    await runAmpInit({ projectRoot, env });

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "gbrain",
      dryRun: true,
      homedir: () => fakeHome,
      env,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "gbrain");
    assert.equal(result.writes.length, 4);
  });

  it("gbrain source uses injected adapter while consolidate backend is in-memory", async () => {
    const projectRoot = join(tempRoot, "gbrain-in-memory-injected");
    const fakeHome = join(tempRoot, "home-gbrain-in-memory-injected");
    const env = { HOME: fakeHome, AMP_KNOWLEDGE_BACKEND: "in-memory" };
    await runAmpInit({ projectRoot, env });

    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    await adapter.writeFrames([
      createFrame({
        id: "gbrain-in-memory-pref",
        kind: "semantic",
        content: "Gbrain with in-memory consolidate backend.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "gbrain-in-memory-injected" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "gbrain",
      dryRun: true,
      homedir: () => fakeHome,
      env,
      gbrainAdapter: adapter,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "gbrain");
    assert.equal(result.writes.length, 4);
  });
});

describe("formatAmpProjectionRenderReport", () => {
  it("formats blocked apply refusal without task IDs", () => {
    const lines = formatAmpProjectionRenderReport({
      projectRoot: "/tmp/demo",
      source: "placeholder",
      dryRun: false,
      writes: [],
      ok: false,
      blocked: true,
      error: DB_BACKED_MATERIALIZATION_NOT_WIRED,
    });

    const text = lines.join("\n");
    assert.match(text, /source=placeholder/);
    assert.match(text, /not wired yet/);
    assert.match(text, /materialization is not available yet/);
    assert.equal(text.includes("AMP-PROJ"), false);
  });
});
