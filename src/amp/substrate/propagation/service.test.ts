import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCanonicalProcedure } from "../../procedural/schema.js";
import { ProcedureRegistry } from "../../procedural/registry.js";
import { propagateProcedures } from "./service.js";

describe("propagateProcedures", () => {
  let projectRoot = "";
  const syncedAt = "2026-05-25T15:00:00.000Z";

  before(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "amp-propagation-"));
  });

  after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("writes cursor artifacts and records lastSyncedAt", async () => {
    const registry = new ProcedureRegistry();
    registry.register(
      createCanonicalProcedure({
        name: "cursor-only",
        harness_compatibility: {
          supported_harnesses: ["cursor"],
          injection_path: "filesystem-native",
        },
        harness_overlays: { cursor: { globs: ["**/*.ts"], alwaysApply: false } },
        body: "# Cursor rule\n",
      })
    );

    const result = await propagateProcedures({
      registry,
      roots: { projectRoot },
      targets: ["cursor"],
      syncedAt,
    });

    const written = result.writes.filter((record) => record.status === "written");
    assert.equal(written.length, 1);
    assert.equal(written[0]?.harness, "cursor");
    assert.ok(written[0]?.outputPath?.includes("from-amp"));
    assert.ok(written[0]?.outputPath?.endsWith("cursor-only.mdc"));

    const content = await readFile(written[0]!.outputPath!, "utf8");
    assert.match(content, /# Cursor rule/);

    assert.equal(registry.get("cursor-only")?.lastSyncedAt.cursor, syncedAt);
    assert.equal(result.unsupportedTargets.length, 0);
  });

  it("propagates to cursor, claude-code, and hermes from-amp roots", async () => {
    const registry = new ProcedureRegistry();
    registry.register(
      createCanonicalProcedure({
        name: "multi-harness",
        harness_compatibility: {
          supported_harnesses: ["cursor", "claude-code", "hermes"],
          injection_path: "filesystem-native",
        },
        body: "# Shared skill\n",
      })
    );

    const result = await propagateProcedures({
      registry,
      roots: {
        projectRoot,
        claudeCodeBasePath: join(projectRoot, ".claude", "skills"),
      },
      syncedAt,
    });

    const written = result.writes.filter((record) => record.status === "written");
    assert.equal(written.length, 3);
    assert.deepEqual(
      written.map((record) => record.harness).sort(),
      ["claude-code", "cursor", "hermes"]
    );

    assert.ok(
      written.find((record) => record.harness === "cursor")?.outputPath?.includes(
        join(".cursor", "rules", "from-amp")
      )
    );
    assert.ok(
      written.find((record) => record.harness === "claude-code")?.outputPath?.includes(
        join(".claude", "skills", "from-amp", "multi-harness", "SKILL.md")
      )
    );
    assert.ok(
      written.find((record) => record.harness === "hermes")?.outputPath?.includes(
        join("skills", "from-amp", "multi-harness", "SKILL.md")
      )
    );

    const synced = registry.get("multi-harness")?.lastSyncedAt;
    assert.equal(synced?.cursor, syncedAt);
    assert.equal(synced?.["claude-code"], syncedAt);
    assert.equal(synced?.hermes, syncedAt);
  });

  it("skips targets not declared in supported_harnesses", async () => {
    const registry = new ProcedureRegistry();
    registry.register(
      createCanonicalProcedure({
        name: "cursor-skip-others",
        harness_compatibility: {
          supported_harnesses: ["cursor"],
          injection_path: "filesystem-native",
        },
      })
    );

    const result = await propagateProcedures({
      registry,
      roots: { projectRoot },
      syncedAt,
    });

    const skipped = result.writes.filter((record) => record.status === "skipped");
    assert.equal(skipped.length, 2);
    assert.ok(skipped.every((record) => record.harness === "claude-code" || record.harness === "hermes"));
  });

  it("reports unsupported declared harness targets", async () => {
    const registry = new ProcedureRegistry();
    registry.register(
      createCanonicalProcedure({
        name: "gbrain-target",
        harness_compatibility: {
          supported_harnesses: ["cursor", "gbrain"],
          injection_path: "filesystem-native",
        },
      })
    );

    const result = await propagateProcedures({
      registry,
      roots: { projectRoot },
      targets: ["cursor"],
      syncedAt,
    });

    assert.equal(result.unsupportedTargets.length, 1);
    assert.equal(result.unsupportedTargets[0]?.harness, "gbrain");
    assert.match(result.unsupportedTargets[0]?.reason ?? "", /not a verified v1 propagation target/);
    assert.equal(result.writes.filter((record) => record.status === "written").length, 1);
  });

  it("reports mcp-only injection_path as unsupported for verified harnesses", async () => {
    const registry = new ProcedureRegistry();
    registry.register(
      createCanonicalProcedure({
        name: "mcp-only",
        harness_compatibility: {
          supported_harnesses: ["cursor"],
          injection_path: "mcp",
        },
      })
    );

    const result = await propagateProcedures({
      registry,
      roots: { projectRoot },
      targets: ["cursor"],
      syncedAt,
    });

    assert.equal(result.unsupportedTargets.length, 1);
    assert.match(result.unsupportedTargets[0]?.reason ?? "", /filesystem propagation requires/);
    assert.equal(result.writes[0]?.status, "failed");
    assert.equal(registry.get("mcp-only")?.lastSyncedAt.cursor, undefined);
  });
});
