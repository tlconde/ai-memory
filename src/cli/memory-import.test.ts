import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createImportRequest,
  scaffoldImportConfig,
  scanImportSources,
} from "./memory-import.js";

describe("memory import", () => {
  it("scaffolds configurable import sources without requiring hidden chat paths", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-import-init-"));
    try {
      const added = await scaffoldImportConfig(projectRoot);
      assert.deepEqual(added, [".ai/import-sources.json"]);
      assert.equal(existsSync(join(projectRoot, ".ai", "temp", "import", "requests")), true);

      const config = JSON.parse(await readFile(join(projectRoot, ".ai", "import-sources.json"), "utf8"));
      const cursorExports = config.sources.find((source: { id: string }) => source.id === "cursor-chat-exports");
      assert.equal(cursorExports.enabled, false);
      assert.match(cursorExports.note, /do not define a stable local chat transcript path/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("scans configured source paths without reading source contents", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-import-scan-"));
    try {
      await scaffoldImportConfig(projectRoot);
      await writeFile(join(projectRoot, "AGENTS.md"), "SECRET_TRANSCRIPT_TOKEN\n");

      const scan = await scanImportSources(projectRoot, ["codex-project-agents"]);
      assert.equal(scan.length, 1);
      assert.equal(scan[0].status, "present");
      assert.equal(JSON.stringify(scan).includes("SECRET_TRANSCRIPT_TOKEN"), false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("writes a pending request that asks the active agent to distill durable learnings", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "ai-memory-import-request-"));
    try {
      await mkdir(join(projectRoot, ".ai", "memory"), { recursive: true });
      await writeFile(join(projectRoot, ".ai", "memory", "memory-index.md"), "# Index\n");
      await writeFile(join(projectRoot, "AGENTS.md"), "Use pnpm for tests.\n");

      const requestPath = await createImportRequest(projectRoot, "codex", ["codex-project-agents"]);
      const request = await readFile(requestPath, "utf8");
      const latest = await readFile(join(projectRoot, ".ai", "temp", "import", "latest-request.md"), "utf8");

      assert.equal(request, latest);
      assert.match(request, /Active agent: codex/);
      assert.match(request, /codex-project-agents/);
      assert.match(request, /Do not bulk-copy raw chat text/);
      assert.match(request, /commit_memory\/search_memory/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
