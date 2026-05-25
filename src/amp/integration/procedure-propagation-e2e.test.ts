/**
 * Procedure propagation E2E — canonical registry through verified harness adapters.
 *
 * Falsifiable claim: a canonical procedure registered in ProcedureRegistry
 * propagates to Cursor, Claude Code, and Hermes from-amp roots only, records
 * lastSyncedAt per harness, and round-trips via adapter filesystem readback
 * without live harness sessions.
 *
 * Live harness session load (Cursor rule picker, Claude skill discovery,
 * `hermes -s <skill>`) is PROVISIONAL/UNKNOWN unless verified separately.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { ClaudeCodeAdapter } from "../adapters/sas/claude-code/adapter.js";
import { CursorAdapter } from "../adapters/sas/cursor/adapter.js";
import { HermesAdapter } from "../adapters/sas/hermes/adapter.js";
import { createCanonicalProcedure } from "../procedural/schema.js";
import { ProcedureRegistry } from "../procedural/registry.js";
import { propagateProcedures } from "../substrate/propagation/service.js";
import type { HarnessWriterRegistry } from "../substrate/propagation/types.js";
import {
  createV1FixtureProject,
  destroyV1FixtureProject,
  type V1FixtureProject,
} from "./fixtures/v1-project.js";

const PROCEDURE_NAME = "propagation-e2e-skill";
const SYNCED_AT = "2026-05-25T18:30:00.000Z";
const PROCEDURE_BODY = "# Propagation E2E\n\nShared procedure body for harness readback.\n";

async function listFilesRecursively(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

function isUnderFromAmpRoot(filePath: string, fromAmpRoots: readonly string[]): boolean {
  return fromAmpRoots.some(
    (root) => filePath === root || filePath.startsWith(`${root}/`)
  );
}

function createFixtureWriters(fixture: V1FixtureProject): HarnessWriterRegistry {
  const cursor = new CursorAdapter({ projectRoot: fixture.root });
  const claudeCode = new ClaudeCodeAdapter({
    basePath: join(fixture.root, ".claude", "skills"),
  });
  const hermes = new HermesAdapter({ projectRoot: fixture.root });

  return {
    cursor: { writeProcedure: (procedure) => cursor.writeCompiledRule(procedure) },
    "claude-code": { writeProcedure: (procedure) => claudeCode.writeCompiledProcedure(procedure) },
    hermes: { writeProcedure: (procedure) => hermes.writeCompiledProcedure(procedure) },
  };
}

describe("procedure propagation E2E", () => {
  let fixture: V1FixtureProject;

  before(async () => {
    fixture = await createV1FixtureProject({ projectRef: "amp-v1-propagation-e2e" });
  });

  after(async () => {
    await destroyV1FixtureProject(fixture);
  });

  it("propagates registry procedures to from-amp artifacts with adapter readback", async () => {
    const registry = new ProcedureRegistry();
    registry.register(
      createCanonicalProcedure({
        name: PROCEDURE_NAME,
        description: "End-to-end procedure propagation fixture.",
        harness_compatibility: {
          supported_harnesses: ["cursor", "claude-code", "hermes"],
          injection_path: "filesystem-native",
        },
        harness_overlays: {
          cursor: { globs: ["**/*.ts"], alwaysApply: false },
        },
        body: PROCEDURE_BODY,
      })
    );

    const beforeFiles = new Set(await listFilesRecursively(fixture.root));
    assert.ok(beforeFiles.size > 0, "fixture should materialize scaffold files");

    const result = await propagateProcedures({
      registry,
      writers: createFixtureWriters(fixture),
      syncedAt: SYNCED_AT,
    });

    const written = result.writes.filter((record) => record.status === "written");
    assert.equal(written.length, 3);
    assert.equal(result.unsupportedTargets.length, 0);

    const fromAmpRoots = [
      fixture.harnessRoots.cursorFromAmp,
      fixture.harnessRoots.claudeCodeFromAmp,
      fixture.harnessRoots.hermesFromAmp,
    ];

    for (const record of written) {
      assert.ok(record.outputPath, "written records should include outputPath");
      assert.ok(
        isUnderFromAmpRoot(record.outputPath!, fromAmpRoots),
        `expected from-amp write, got ${record.outputPath}`
      );
    }

    const afterFiles = await listFilesRecursively(fixture.root);
    const newFiles = afterFiles.filter((path) => !beforeFiles.has(path));
    assert.ok(newFiles.length >= 3, "propagation should emit harness artifacts");
    assert.ok(
      newFiles.every((path) => isUnderFromAmpRoot(path, fromAmpRoots)),
      "propagation must not write outside from-amp harness roots"
    );

    const synced = registry.get(PROCEDURE_NAME)?.lastSyncedAt;
    assert.equal(synced?.cursor, SYNCED_AT);
    assert.equal(synced?.["claude-code"], SYNCED_AT);
    assert.equal(synced?.hermes, SYNCED_AT);

    const cursorAdapter = new CursorAdapter({ projectRoot: fixture.root });
    const claudeAdapter = new ClaudeCodeAdapter({
      basePath: join(fixture.root, ".claude", "skills"),
    });
    const hermesAdapter = new HermesAdapter({ projectRoot: fixture.root });

    const cursorPath = cursorAdapter.resolveWritePath(`${PROCEDURE_NAME}.mdc`);
    const cursorContent = await readFile(cursorPath, "utf8");
    assert.match(cursorContent, /# Propagation E2E/);
    assert.match(cursorContent, /alwaysApply: false/);
    await assertPathExists(cursorPath);

    const claudePath = claudeAdapter.resolveSkillWritePath(PROCEDURE_NAME);
    const claudeContent = await readFile(claudePath, "utf8");
    assert.match(claudeContent, /^---\nname: propagation-e2e-skill/);
    assert.match(claudeContent, /# Propagation E2E/);
    await assertPathExists(claudePath);

    const hermesContent = await hermesAdapter.readEmittedSkill(PROCEDURE_NAME);
    assert.match(hermesContent, /^---\nname: propagation-e2e-skill/);
    assert.match(hermesContent, /# Propagation E2E/);

    const listed = await hermesAdapter.listEmittedSkills();
    assert.ok(listed.some((entry) => entry.skillName === PROCEDURE_NAME));
  });
});

async function assertPathExists(path: string): Promise<void> {
  const info = await stat(path);
  assert.ok(info.isFile(), `expected file at ${relative(process.cwd(), path)}`);
}
