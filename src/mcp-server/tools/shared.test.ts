import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ALWAYS_IMMUTABLE, isImmutable } from "./shared.js";

describe("ALWAYS_IMMUTABLE", () => {
  it("ALWAYS_IMMUTABLE includes sources/", () => {
    assert.ok(ALWAYS_IMMUTABLE.includes("sources/"));
  });

  it("ALWAYS_IMMUTABLE contains all four required prefixes", () => {
    for (const p of ["toolbox/", "acp/", "rules/", "sources/"]) {
      assert.ok(ALWAYS_IMMUTABLE.includes(p), `missing prefix: ${p}`);
    }
  });
});

describe("isImmutable — ALWAYS_IMMUTABLE prefixes", () => {
  const bogusAiDir = "/nonexistent/ai-dir-for-tests";

  it("toolbox/foo.md → true", async () => {
    assert.equal(await isImmutable("toolbox/foo.md", bogusAiDir), true);
  });

  it("acp/manifest.json → true", async () => {
    assert.equal(await isImmutable("acp/manifest.json", bogusAiDir), true);
  });

  it("rules/anything.md → true", async () => {
    assert.equal(await isImmutable("rules/anything.md", bogusAiDir), true);
  });

  it("sources/paper.md → true", async () => {
    assert.equal(await isImmutable("sources/paper.md", bogusAiDir), true);
  });

  it("sources/assets/doc.pdf → true", async () => {
    assert.equal(await isImmutable("sources/assets/doc.pdf", bogusAiDir), true);
  });

  it("memory/decisions.md → false", async () => {
    assert.equal(await isImmutable("memory/decisions.md", bogusAiDir), false);
  });

  it("wiki/index.md → false (wiki is writable)", async () => {
    assert.equal(await isImmutable("wiki/index.md", bogusAiDir), false);
  });
});

describe("isImmutable — frontmatter-controlled defaults (no file present)", () => {
  it("IDENTITY.md without frontmatter file → true (default not-writable)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shared-test-"));
    try {
      assert.equal(await isImmutable("IDENTITY.md", dir), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("PROJECT_STATUS.md without frontmatter file → false (default writable)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shared-test-"));
    try {
      assert.equal(await isImmutable("PROJECT_STATUS.md", dir), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("IDENTITY.md with writable: true frontmatter → false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shared-test-"));
    try {
      await writeFile(join(dir, "IDENTITY.md"), "---\nwritable: true\n---\nbody\n");
      assert.equal(await isImmutable("IDENTITY.md", dir), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("PROJECT_STATUS.md with writable: false frontmatter → true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shared-test-"));
    try {
      await writeFile(join(dir, "PROJECT_STATUS.md"), "---\nwritable: false\n---\nbody\n");
      assert.equal(await isImmutable("PROJECT_STATUS.md", dir), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
