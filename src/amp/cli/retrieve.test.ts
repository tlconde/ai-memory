import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import { createFrame } from "../core/frame-schema.js";
import { runAmpInit } from "./init.js";
import { resolveCliProjectContext } from "./cli-context.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";
import { runAmpRuntimeGraduationApply } from "./runtime-graduation-apply.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";
import { formatAmpRetrieveMessages, runAmpRetrieve } from "./retrieve.js";

const GENERATED_AT = "2026-05-27T10:00:00.000Z";
const ISO = "2026-05-26T12:00:00.000Z";

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

describe("runAmpRetrieve", () => {
  it("reads preferences from injected in-memory store without explicit backend", async () => {
    const knowledge = new InMemoryKnowledgeStore();
    knowledge.write([
      createFrame({
        id: "frame-cli-1",
        kind: "semantic",
        content: "Prefer explicit verification commands.",
        source: { surface: "cursor", harness: "cursor" },
        created_at: "2026-05-24T12:00:00.000Z",
        scope: { kind: "project", project_ref: "ai-memory" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpRetrieve({
      projectRoot: process.cwd(),
      inMemoryStore: knowledge,
      scope: "project",
      projectRef: "ai-memory",
      query: "verification",
    });

    assert.equal(result.preferences.length, 1);
    assert.equal(result.knowledgeBackend, "in-memory");
    assert.equal(result.knowledgeSource, "in-memory");
    assert.equal(result.preferences[0]?.frame.content, "Prefer explicit verification commands.");
  });

  it("reads preferences from injected in-memory store with explicit backend", async () => {
    const knowledge = new InMemoryKnowledgeStore();
    knowledge.write([
      createFrame({
        id: "frame-cli-1",
        kind: "semantic",
        content: "Prefer explicit verification commands.",
        source: { surface: "cursor", harness: "cursor" },
        created_at: "2026-05-24T12:00:00.000Z",
        scope: { kind: "project", project_ref: "ai-memory" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpRetrieve({
      projectRoot: process.cwd(),
      knowledge: "in-memory",
      inMemoryStore: knowledge,
      scope: "project",
      projectRef: "ai-memory",
      query: "verification",
    });

    assert.equal(result.preferences.length, 1);
    assert.equal(result.knowledgeBackend, "in-memory");
    assert.equal(result.knowledgeSource, "in-memory");
    assert.equal(result.preferences[0]?.frame.content, "Prefer explicit verification commands.");
  });

  it("formatAmpRetrieveMessages renders matches and empty state", () => {
    const withMatches = formatAmpRetrieveMessages({
      projectRoot: "/tmp/project",
      knowledgeBackend: "in-memory",
      knowledgeSource: "in-memory",
      scope: "project",
      projectRef: "ai-memory",
      preferences: [
        {
          frame: createFrame({
            id: "frame-1",
            kind: "semantic",
            content: "Hello world.",
            source: { surface: "cursor", harness: "cursor" },
            created_at: "2026-05-24T12:00:00.000Z",
            scope: { kind: "project", project_ref: "ai-memory" },
            curation_mode: "personal",
          }),
        },
      ],
    });

    assert.match(withMatches.join("\n"), /Hello world/);

    const empty = formatAmpRetrieveMessages({
      projectRoot: "/tmp/project",
      knowledgeBackend: "gbrain",
      knowledgeSource: "gbrain",
      liveGbrain: true,
      scope: "user",
      preferences: [],
    });

    assert.match(empty.join("\n"), /no matches/i);
    assert.match(empty.join("\n"), /live gbrain read/i);

    const localSqlite = formatAmpRetrieveMessages({
      projectRoot: "/tmp/project",
      knowledgeBackend: "local-persistent",
      knowledgeSource: "local-sqlite",
      scope: "user",
      preferences: [],
    });
    assert.match(localSqlite.join("\n"), /local persistent knowledge\.db/);

    const injected = formatAmpRetrieveMessages({
      projectRoot: "/tmp/project",
      knowledgeBackend: "local-persistent",
      knowledgeSource: "injected",
      scope: "user",
      preferences: [],
    });
    assert.match(injected.join("\n"), /injected knowledge store/);
    assert.doesNotMatch(injected.join("\n"), /knowledge\.db/);
  });
});

describe("runAmpRetrieve persistent local knowledge", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-retrieve-persistent-local-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function initProject(name: string) {
    const projectRoot = join(tempRoot, name);
    const fakeHome = join(tempRoot, `home-${name}`);
    const env = { HOME: fakeHome };
    await runAmpInit({ projectRoot, env });
    return { projectRoot, env, fakeHome };
  }

  async function seedAndGraduatePreference(
    projectRoot: string,
    env: NodeJS.ProcessEnv,
    fakeHome: string,
    id = "pref-confirmed",
  ) {
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id,
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id,
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
      id,
      env,
      homedir: () => fakeHome,
      generatedAt: GENERATED_AT,
    });
    assert.equal(applyResult.ok, true);
  }

  it("reads a frame written by graduation apply after reopen without in-memory env", async () => {
    const { projectRoot, env, fakeHome } = await initProject("retrieve-persistent");
    await seedAndGraduatePreference(projectRoot, env, fakeHome);

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const knowledgeDbPath = resolveLocalKnowledgeDbPath(context.runtimeDbPath);
    const reopened = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
    try {
      assert.equal(reopened.read("runtime-graduation:pref-confirmed")?.kind, "semantic");
    } finally {
      reopened.close();
    }

    const result = await runAmpRetrieve({
      projectRoot,
      env,
      homedir: () => fakeHome,
      scope: "user",
    });

    assert.equal(result.knowledgeBackend, "local-persistent");
    assert.equal(result.knowledgeSource, "local-sqlite");
    assert.equal(result.preferences.length, 1);
    assert.equal(result.preferences[0]?.frame.id, "runtime-graduation:pref-confirmed");
    const content = result.preferences[0]?.frame.content as { statement?: string };
    assert.equal(content.statement, ACTIVE_PREFERENCE.statement);

    const messages = formatAmpRetrieveMessages(result);
    assert.match(messages.join("\n"), /local persistent knowledge\.db/);
  });

  it("prefers injected knowledge store over persistent knowledge.db", async () => {
    const { projectRoot, env, fakeHome } = await initProject("retrieve-injected-over-persistent");
    await seedAndGraduatePreference(projectRoot, env, fakeHome);

    const injected = new InMemoryKnowledgeStore();
    injected.write([
      createFrame({
        id: "injected-pref",
        kind: "semantic",
        content: "Injected retrieve wins.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "user" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpRetrieve({
      projectRoot,
      env,
      homedir: () => fakeHome,
      scope: "user",
      knowledgeStore: injected,
    });

    assert.equal(result.knowledgeBackend, "local-persistent");
    assert.equal(result.knowledgeSource, "injected");
    assert.equal(result.preferences.length, 1);
    assert.equal(result.preferences[0]?.frame.id, "injected-pref");

    const messages = formatAmpRetrieveMessages(result);
    assert.match(messages.join("\n"), /injected knowledge store/);
    assert.doesNotMatch(messages.join("\n"), /knowledge\.db/);
  });

  it("prefers inMemoryStore over knowledgeStore when both are injected without explicit backend", async () => {
    const { projectRoot, env, fakeHome } = await initProject("retrieve-coinjection-in-memory-wins");
    await seedAndGraduatePreference(projectRoot, env, fakeHome);

    const inMemory = new InMemoryKnowledgeStore();
    inMemory.write([
      createFrame({
        id: "in-memory-wins",
        kind: "semantic",
        content: "In-memory injection wins.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "user" },
        curation_mode: "personal",
      }),
    ]);

    const knowledgeStore = new InMemoryKnowledgeStore();
    knowledgeStore.write([
      createFrame({
        id: "knowledge-store-loses",
        kind: "semantic",
        content: "Should not be read.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "user" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpRetrieve({
      projectRoot,
      env,
      homedir: () => fakeHome,
      scope: "user",
      inMemoryStore: inMemory,
      knowledgeStore,
    });

    assert.equal(result.knowledgeBackend, "in-memory");
    assert.equal(result.knowledgeSource, "in-memory");
    assert.equal(result.preferences.length, 1);
    assert.equal(result.preferences[0]?.frame.id, "in-memory-wins");
  });

  it("prefers explicit backend over both injected stores", async () => {
    const { projectRoot, env, fakeHome } = await initProject("retrieve-explicit-over-coinjection");
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({
      transport: fake,
      ssaSpecPath: join(process.cwd(), "ssa-files", "gbrain.yaml"),
    });
    await adapter.writeFrames([
      createFrame({
        id: "gbrain-pref",
        kind: "semantic",
        content: "Explicit gbrain over injections.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "user" },
        curation_mode: "personal",
      }),
    ]);

    const inMemory = new InMemoryKnowledgeStore();
    inMemory.write([
      createFrame({
        id: "ignored-in-memory",
        kind: "semantic",
        content: "Ignored.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "user" },
        curation_mode: "personal",
      }),
    ]);
    const knowledgeStore = new InMemoryKnowledgeStore();
    knowledgeStore.write([
      createFrame({
        id: "ignored-knowledge-store",
        kind: "semantic",
        content: "Also ignored.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "user" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpRetrieve({
      projectRoot,
      env,
      homedir: () => fakeHome,
      scope: "user",
      knowledge: "fake-gbrain",
      gbrainAdapter: adapter,
      inMemoryStore: inMemory,
      knowledgeStore,
    });

    assert.equal(result.knowledgeBackend, "fake-gbrain");
    assert.equal(result.knowledgeSource, "gbrain");
    assert.equal(result.preferences.length, 1);
    assert.equal(result.preferences[0]?.frame.content, "Explicit gbrain over injections.");
  });

  it("uses gbrain adapter only when knowledge backend is explicitly gbrain", async () => {
    const { projectRoot, env, fakeHome } = await initProject("retrieve-explicit-gbrain");
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({
      transport: fake,
      ssaSpecPath: join(process.cwd(), "ssa-files", "gbrain.yaml"),
    });
    await adapter.writeFrames([
      createFrame({
        id: "gbrain-pref",
        kind: "semantic",
        content: "Gbrain explicit retrieve path.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "user" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpRetrieve({
      projectRoot,
      env,
      homedir: () => fakeHome,
      scope: "user",
      knowledge: "fake-gbrain",
      gbrainAdapter: adapter,
    });

    assert.equal(result.knowledgeBackend, "fake-gbrain");
    assert.equal(result.knowledgeSource, "gbrain");
    assert.equal(result.preferences.length, 1);
    assert.equal(result.preferences[0]?.frame.content, "Gbrain explicit retrieve path.");
  });
});
