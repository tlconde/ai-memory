import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCanonicalProcedure } from "../procedural/schema.js";
import { ProcedureRegistry } from "../procedural/registry.js";
import { runAmpInit } from "./init.js";
import {
  defaultProjectProceduresDir,
  derivePropagationHarnessRoots,
  formatAmpPropagateReport,
  parseVerifiedHarnessTargets,
  runAmpPropagate,
} from "./propagate.js";

describe("runAmpPropagate", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-propagate-cli-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("propagates injected registry procedures to cursor from-amp root", async () => {
    const projectRoot = join(tempRoot, "cursor-propagate");
    await runAmpInit({ projectRoot });

    const registry = new ProcedureRegistry();
    registry.register(
      createCanonicalProcedure({
        name: "cli-cursor-rule",
        harness_compatibility: {
          supported_harnesses: ["cursor"],
          injection_path: "filesystem-native",
        },
        body: "# CLI cursor rule\n",
      })
    );

    const result = await runAmpPropagate({
      projectRoot,
      targets: "cursor",
      registry,
      syncedAt: "2026-05-25T16:00:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(result.registryProcedureCount, 1);
    assert.deepEqual(result.targets, ["cursor"]);

    const written = result.propagation.writes.filter((record) => record.status === "written");
    assert.equal(written.length, 1);
    assert.ok(written[0]?.outputPath?.includes(join(".cursor", "rules", "from-amp")));
    assert.ok(existsSync(written[0]!.outputPath!));

    const content = await readFile(written[0]!.outputPath!, "utf8");
    assert.match(content, /# CLI cursor rule/);
  });

  it("propagates to all verified harness from-amp roots", async () => {
    const projectRoot = join(tempRoot, "multi-harness-propagate");
    await runAmpInit({ projectRoot });

    const registry = new ProcedureRegistry();
    registry.register(
      createCanonicalProcedure({
        name: "cli-multi-harness",
        harness_compatibility: {
          supported_harnesses: ["cursor", "claude-code", "hermes"],
          injection_path: "filesystem-native",
        },
        body: "# Shared CLI skill\n",
      })
    );

    const result = await runAmpPropagate({
      projectRoot,
      registry,
      syncedAt: "2026-05-25T16:00:00.000Z",
    });

    assert.equal(result.ok, true);
    const written = result.propagation.writes.filter((record) => record.status === "written");
    assert.equal(written.length, 3);
    assert.deepEqual(
      written.map((record) => record.harness).sort(),
      ["claude-code", "cursor", "hermes"]
    );

    const roots = derivePropagationHarnessRoots(projectRoot);
    assert.equal(roots.claudeCodeBasePath, join(projectRoot, ".claude", "skills"));
  });

  it("loads procedures from .amp/procedures when registry is not injected", async () => {
    const projectRoot = join(tempRoot, "disk-registry");
    await runAmpInit({ projectRoot });

    const proceduresDir = defaultProjectProceduresDir(projectRoot);
    await mkdir(proceduresDir, { recursive: true });
    await writeFile(
      join(proceduresDir, "disk-procedure.json"),
      JSON.stringify(
        createCanonicalProcedure({
          name: "disk-procedure",
          harness_compatibility: {
            supported_harnesses: ["hermes"],
            injection_path: "filesystem-native",
          },
          body: "# From disk\n",
        }),
        null,
        2
      ),
      "utf8"
    );

    const result = await runAmpPropagate({
      projectRoot,
      targets: "hermes",
    });

    assert.equal(result.registryProcedureCount, 1);
    assert.equal(result.propagation.writes.filter((record) => record.status === "written").length, 1);
  });

  it("reports unsupported declared harness targets", async () => {
    const projectRoot = join(tempRoot, "unsupported-declared");
    await runAmpInit({ projectRoot });

    const registry = new ProcedureRegistry();
    registry.register(
      createCanonicalProcedure({
        name: "gbrain-declared",
        harness_compatibility: {
          supported_harnesses: ["cursor", "gbrain"],
          injection_path: "filesystem-native",
        },
      })
    );

    const result = await runAmpPropagate({
      projectRoot,
      targets: "cursor",
      registry,
    });

    assert.equal(result.propagation.unsupportedTargets.length, 1);
    assert.equal(result.propagation.unsupportedTargets[0]?.harness, "gbrain");
    assert.equal(result.ok, true);
  });

  it("rejects unknown harness targets", async () => {
    const projectRoot = join(tempRoot, "invalid-target");
    await runAmpInit({ projectRoot });

    const result = await runAmpPropagate({
      projectRoot,
      targets: "cursor,gbrain",
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Unknown harness target/);
  });

  it("requires project AMP config before propagation", async () => {
    const projectRoot = join(tempRoot, "missing-config");
    await mkdir(projectRoot, { recursive: true });

    const result = await runAmpPropagate({ projectRoot });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /amp init/i);
  });
});

describe("parseVerifiedHarnessTargets", () => {
  it("defaults to all verified harness targets", () => {
    const parsed = parseVerifiedHarnessTargets(undefined);
    assert.ok(!("error" in parsed));
    assert.deepEqual(parsed, ["cursor", "claude-code", "hermes"]);
  });

  it("parses comma-separated targets", () => {
    const parsed = parseVerifiedHarnessTargets("cursor, hermes");
    assert.ok(!("error" in parsed));
    assert.deepEqual(parsed, ["cursor", "hermes"]);
  });
});

describe("formatAmpPropagateReport", () => {
  it("renders human-readable propagation lines", () => {
    const lines = formatAmpPropagateReport({
      projectRoot: "/tmp/project",
      targets: ["cursor"],
      registryProcedureCount: 1,
      proceduresDir: "/tmp/project/.amp/procedures",
      propagation: {
        writes: [
          {
            procedureName: "example",
            harness: "cursor",
            status: "written",
            outputPath: "/tmp/project/.cursor/rules/from-amp/example.mdc",
          },
        ],
        unsupportedTargets: [
          {
            procedureName: "example",
            harness: "gbrain",
            reason: "not verified",
          },
        ],
      },
      ok: true,
    });

    const text = lines.join("\n");
    assert.match(text, /AMP propagate/);
    assert.match(text, /\[written\]/);
    assert.match(text, /\[unsupported\]/);
    assert.match(text, /OK Propagation finished/);
  });
});
