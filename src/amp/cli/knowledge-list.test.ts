import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import type { Frame } from "../core/frame-schema.js";
import { runAmpInit } from "./init.js";
import { registerAmpCommands } from "./index.js";
import {
  DEFAULT_KNOWLEDGE_LIST_LIMIT,
  formatAmpKnowledgeListJson,
  formatAmpKnowledgeListReport,
  KNOWLEDGE_LIST_CONTENT_PREVIEW_MAX,
  parseKnowledgeListLimit,
  previewKnowledgeFrameContent,
  runAmpKnowledgeList,
} from "./knowledge-list.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";
import { runAmpRuntimeGraduationApply } from "./runtime-graduation-apply.js";

const ISO = "2026-05-27T10:00:00.000Z";

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

function makeFrame(overrides: Partial<Frame> & Pick<Frame, "id" | "kind" | "scope">): Frame {
  return {
    schema_version: "1.0",
    content: "sample content",
    curation_mode: "personal",
    source: { surface: "cli" },
    created_at: ISO,
    ...overrides,
  };
}

describe("parseKnowledgeListLimit", () => {
  it("defaults to 20 when unset", () => {
    const result = parseKnowledgeListLimit();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.limit, DEFAULT_KNOWLEDGE_LIST_LIMIT);
    }
  });

  it("rejects non-positive limits", () => {
    const result = parseKnowledgeListLimit("0");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /positive integer/);
    }
  });
});

describe("previewKnowledgeFrameContent", () => {
  it("truncates long string content for human output", () => {
    const preview = previewKnowledgeFrameContent("x".repeat(200));
    assert.equal(preview.length, KNOWLEDGE_LIST_CONTENT_PREVIEW_MAX);
    assert.match(preview, /…$/);
  });

  it("stringifies and truncates object content", () => {
    const preview = previewKnowledgeFrameContent({ secret: "value", nested: { a: 1 } });
    assert.ok(preview.length <= KNOWLEDGE_LIST_CONTENT_PREVIEW_MAX);
  });
});

describe("runAmpKnowledgeList", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-knowledge-list-"));
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

  async function seedAndApplyPreference(projectRoot: string, env: NodeJS.ProcessEnv, fakeHome: string) {
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
    });
    assert.equal(applyResult.ok, true);
  }

  it("returns error when project AMP config is missing", async () => {
    const projectRoot = join(tempRoot, "missing-config");
    const result = runAmpKnowledgeList({ projectRoot });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Project AMP config not found/);
    assert.deepEqual(result.items, []);
  });

  it("returns empty list when knowledge.db does not exist", async () => {
    const { projectRoot, env, fakeHome } = await initProject("empty-db");
    const result = runAmpKnowledgeList({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.knowledgeDbExists, false);
    assert.equal(result.totalReturned, 0);
    assert.deepEqual(result.items, []);
  });

  it("lists a frame written by graduation apply", async () => {
    const { projectRoot, env, fakeHome } = await initProject("one-frame");
    await seedAndApplyPreference(projectRoot, env, fakeHome);

    const result = runAmpKnowledgeList({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.totalReturned, 1);
    assert.match(result.items[0]?.id ?? "", /pref-confirmed/);
    assert.equal(result.items[0]?.kind, "semantic");
    assert.equal(result.items[0]?.scope, "user");
    assert.equal(typeof result.items[0]?.contentPreview, "string");
  });

  it("filters by --kind and --scope", async () => {
    const { projectRoot, env, fakeHome } = await initProject("filters");
    const store = new InMemoryKnowledgeStore();
    store.write([
      makeFrame({
        id: "frame-semantic-user",
        kind: "semantic",
        scope: { kind: "user" },
        content: "semantic user",
      }),
      makeFrame({
        id: "frame-episodic-project",
        kind: "episodic",
        scope: { kind: "project", project_ref: "demo" },
        content: "episodic project",
      }),
    ]);

    const kindResult = runAmpKnowledgeList({
      projectRoot,
      env,
      homedir: () => fakeHome,
      knowledgeStore: store,
      kind: "semantic",
    });
    assert.equal(kindResult.ok, true);
    assert.equal(kindResult.totalReturned, 1);
    assert.equal(kindResult.items[0]?.id, "frame-semantic-user");

    const scopeResult = runAmpKnowledgeList({
      projectRoot,
      env,
      homedir: () => fakeHome,
      knowledgeStore: store,
      scope: "project",
    });
    assert.equal(scopeResult.ok, true);
    assert.equal(scopeResult.totalReturned, 1);
    assert.equal(scopeResult.items[0]?.id, "frame-episodic-project");
  });

  it("validates --limit and applies limit behavior", async () => {
    const invalid = runAmpKnowledgeList({ limit: "0" });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error ?? "", /positive integer/);

    const { projectRoot, env, fakeHome } = await initProject("limit-behavior");
    const store = new InMemoryKnowledgeStore();
    store.write(
      Array.from({ length: 5 }, (_, index) =>
        makeFrame({
          id: `frame-${index}`,
          kind: "semantic",
          scope: { kind: "user" },
          content: `content-${index}`,
        }),
      ),
    );

    const result = runAmpKnowledgeList({
      projectRoot,
      env,
      homedir: () => fakeHome,
      knowledgeStore: store,
      limit: "2",
    });

    assert.equal(result.ok, true);
    assert.equal(result.filters.limit, 2);
    assert.equal(result.totalReturned, 2);
    assert.equal(result.items.length, 2);
  });

  it("JSON output is parseable and includes paths, filters, and items", async () => {
    const { projectRoot, env, fakeHome } = await initProject("json-output");
    const result = runAmpKnowledgeList({
      projectRoot,
      env,
      homedir: () => fakeHome,
      limit: "5",
    });

    const parsed = JSON.parse(formatAmpKnowledgeListJson(result));
    assert.equal(parsed.ok, true);
    assert.equal(typeof parsed.projectRoot, "string");
    assert.equal(typeof parsed.runtimeDbPath, "string");
    assert.equal(typeof parsed.knowledgeDbPath, "string");
    assert.equal(typeof parsed.knowledgeDbExists, "boolean");
    assert.equal(typeof parsed.filters, "object");
    assert.equal(parsed.filters.limit, 5);
    assert.equal(typeof parsed.totalReturned, "number");
    assert.ok(Array.isArray(parsed.items));
    assert.equal(parsed.error, null);
  });

  it("human output truncates large content instead of dumping it", async () => {
    const { projectRoot, env, fakeHome } = await initProject("human-truncate");
    const store = new InMemoryKnowledgeStore();
    const huge = "secret-value-".repeat(30);
    store.write([
      makeFrame({
        id: "frame-huge",
        kind: "semantic",
        scope: { kind: "user" },
        content: huge,
      }),
    ]);

    const result = runAmpKnowledgeList({
      projectRoot,
      env,
      homedir: () => fakeHome,
      knowledgeStore: store,
    });
    const output = formatAmpKnowledgeListReport(result).join("\n");

    assert.match(output, /frame-huge/);
    assert.doesNotMatch(output, new RegExp(huge));
    assert.match(output, /…/);
  });

  it("ignores AMP_KNOWLEDGE_BACKEND=gbrain and still reads local SQLite", async () => {
    const { projectRoot, env, fakeHome } = await initProject("ignore-gbrain-env");
    const result = runAmpKnowledgeList({
      projectRoot,
      env: { ...env, AMP_KNOWLEDGE_BACKEND: "gbrain" },
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.knowledgeDbExists, false);
    assert.equal(result.totalReturned, 0);
  });

  it("rejects invalid kind and scope filters", () => {
    const kindResult = runAmpKnowledgeList({ kind: "procedural" });
    assert.equal(kindResult.ok, false);
    assert.match(kindResult.error ?? "", /Invalid frame kind/);

    const scopeResult = runAmpKnowledgeList({ scope: "global" });
    assert.equal(scopeResult.ok, false);
    assert.match(scopeResult.error ?? "", /Invalid scope kind/);
  });
});

describe("amp knowledge list command registration", () => {
  it("registers knowledge list under amp command group", () => {
    const program = new Command();
    registerAmpCommands(program);

    const amp = program.commands.find((command) => command.name() === "amp");
    assert.ok(amp, "amp command group should be registered");

    const knowledge = amp!.commands.find((command) => command.name() === "knowledge");
    assert.ok(knowledge, "knowledge subcommand should be registered");

    const list = knowledge!.commands.find((command) => command.name() === "list");
    assert.ok(list, "list subcommand should be registered under knowledge");
  });

  it("help text mentions read-only and no gbrain", () => {
    const program = new Command();
    registerAmpCommands(program);

    const amp = program.commands.find((command) => command.name() === "amp")!;
    const knowledge = amp.commands.find((command) => command.name() === "knowledge")!;
    const list = knowledge.commands.find((command) => command.name() === "list")!;

    const description = list.description();
    assert.match(description, /read-only/);
    assert.match(description, /no gbrain/);
  });
});
