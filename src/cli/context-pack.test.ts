import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import {
  cleanContextTemp,
  parseDurationDays,
  scaffoldContextPack,
  verifyContextPack,
} from "./context-pack.js";

describe("context pack", () => {
  it("scaffolds a minimal .ai/context pack and verifies it", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-context-pack-"));
    try {
      await mkdir(join(projectRoot, "src"), { recursive: true });
      await writeFile(join(projectRoot, "src", "index.ts"), "export const ok = true;\n");

      const added = await scaffoldContextPack(projectRoot);
      assert.ok(added.includes(".ai/context/START_HERE.md"));
      assert.ok(existsSync(join(projectRoot, ".ai", "temp", "context", "drafts")));

      const checks = await verifyContextPack(projectRoot);
      assert.equal(checks.some((check) => check.status === "fail"), false);
      assert.match(await readFile(join(projectRoot, ".ai", "context", "search-scope.json"), "utf8"), /"\."/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails verification when search scope references missing paths", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-context-missing-"));
    try {
      await scaffoldContextPack(projectRoot);
      await writeFile(
        join(projectRoot, ".ai", "context", "search-scope.json"),
        JSON.stringify({
          version: 1,
          task_scopes: {
            default: {
              search_directories: ["missing-src"],
              exclude_from_search: [],
              verification_shortcuts: [],
            },
          },
        }, null, 2)
      );

      const checks = await verifyContextPack(projectRoot);
      assert.equal(checks.find((check) => check.name === "search scope paths")?.status, "fail");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("cleans only old disposable context temp files when apply is true", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-context-clean-"));
    try {
      await scaffoldContextPack(projectRoot);
      const oldFile = join(projectRoot, ".ai", "temp", "context", "drafts", "old.md");
      const freshFile = join(projectRoot, ".ai", "temp", "context", "drafts", "fresh.md");
      await writeFile(oldFile, "old\n");
      await writeFile(freshFile, "fresh\n");

      const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await utimes(oldFile, oldTime, oldTime);

      const dryRun = await cleanContextTemp(projectRoot, 7, false);
      assert.deepEqual(dryRun.map((candidate) => candidate.path), [".ai/temp/context/drafts/old.md"]);
      assert.equal(existsSync(oldFile), true);

      const applied = await cleanContextTemp(projectRoot, 7, true);
      assert.deepEqual(applied.map((candidate) => candidate.path), [".ai/temp/context/drafts/old.md"]);
      assert.equal(existsSync(oldFile), false);
      assert.equal(existsSync(freshFile), true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("parses day durations for clean", () => {
    assert.equal(parseDurationDays(undefined), 7);
    assert.equal(parseDurationDays("14d"), 14);
    assert.equal(parseDurationDays("3 days"), 3);
    assert.throws(() => parseDurationDays("one week"), /Invalid duration/);
  });
});
