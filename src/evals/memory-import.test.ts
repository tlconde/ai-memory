import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { scaffoldImportConfig } from "../cli/memory-import.js";
import { evalMemoryImport } from "./memory-import.js";

describe("memory import eval", () => {
  it("warns when import sources are not configured", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-import-eval-missing-"));
    try {
      await mkdir(join(projectRoot, ".ai"), { recursive: true });
      const metric = await evalMemoryImport(join(projectRoot, ".ai"));
      assert.equal(metric.status, "warn");
      assert.equal(metric.value, "not configured");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("reports good when at least one enabled source is present", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-import-eval-good-"));
    try {
      await scaffoldImportConfig(projectRoot);
      await writeFile(join(projectRoot, "AGENTS.md"), "Keep durable project memory in .ai/.\n");

      const metric = await evalMemoryImport(join(projectRoot, ".ai"));
      assert.equal(metric.status, "good");
      assert.match(String(metric.value), /^[1-9]\d*\//);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
