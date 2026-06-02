import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { scaffoldContextPack } from "../cli/context-pack.js";
import { evalContextPack } from "./context-pack.js";
import { runEvals } from "./index.js";

describe("evalContextPack", () => {
  it("warns when the optional context pack is not configured", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-context-eval-missing-"));
    try {
      await mkdir(join(projectRoot, ".ai"), { recursive: true });
      const metric = await evalContextPack(join(projectRoot, ".ai"));
      assert.equal(metric.name, "Context pack");
      assert.equal(metric.status, "warn");
      assert.equal(metric.value, "not configured");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("reports good when the context pack verifies cleanly", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-context-eval-good-"));
    try {
      await mkdir(join(projectRoot, ".ai"), { recursive: true });
      await scaffoldContextPack(projectRoot);
      const metric = await evalContextPack(join(projectRoot, ".ai"));
      assert.equal(metric.status, "good");
      assert.match(String(metric.value), /checks passing/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("reports bad when context search paths are broken", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-context-eval-bad-"));
    try {
      await mkdir(join(projectRoot, ".ai"), { recursive: true });
      await scaffoldContextPack(projectRoot);
      await writeFile(
        join(projectRoot, ".ai", "context", "search-scope.json"),
        JSON.stringify({ task_scopes: { default: { search_directories: ["missing"] } } }, null, 2)
      );

      const metric = await evalContextPack(join(projectRoot, ".ai"));
      assert.equal(metric.status, "bad");
      assert.match(metric.note ?? "", /failing check/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("is included in the built-in eval report", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-context-eval-report-"));
    try {
      const aiDir = join(projectRoot, ".ai");
      await mkdir(join(aiDir, "memory"), { recursive: true });
      await mkdir(join(aiDir, "sessions", "archive"), { recursive: true });
      await writeFile(join(aiDir, "memory", "decisions.md"), "---\nid: d\ntype: decision\nstatus: active\n---\n# Decisions\n");
      await writeFile(join(aiDir, "sessions", "open-items.md"), "---\nid: o\ntype: decision\nstatus: active\n---\n# Open Items\n");
      await writeFile(join(aiDir, "sessions", "archive", "thread-archive.md"), "---\nid: t\ntype: decision\nstatus: active\n---\n# Archive\n");

      const report = await runEvals(aiDir);
      assert.ok(report.metrics.some((metric) => metric.name === "Context pack"));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
