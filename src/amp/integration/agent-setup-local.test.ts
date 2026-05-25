/**
 * Local agent setup E2E — projection materialization plus harness wiring.
 *
 * Falsifiable claim: after init and local projection apply, agent setup writes
 * only CLAUDE.md marker imports, flattened Cursor from-amp mdc, and inlined Codex
 * AGENTS.md marker content while keeping git status clean for AMP-managed paths.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir as realHomedir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURSOR_FROM_AMP_REL } from "../adapters/sas/cursor/adapter.js";
import { CURSOR_PROJECTION_RULE_FILENAME } from "../agent-setup/cursor.js";
import { CLAUDE_PROJECT_FILENAME } from "../agent-setup/claude-code.js";
import { runAmpAgentSetup } from "../cli/agent-setup.js";
import { runAmpDoctor } from "../cli/doctor.js";
import {
  applyLocalProjectionsForTest,
  createIsolatedAmpTestEnv,
  dryRunLocalProjectionsForTest,
  prepareGitProjectWithAmpInit,
  seedLocalProjectionContent,
} from "./_helpers/local-projection-fixture.js";
import { assertCleanAmpGitStatus } from "./_helpers/invariant-6-git.js";

describe("Local agent setup E2E", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-agent-setup-e2e-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("materializes projections, wires agents, and keeps git clean", async () => {
    const projectRoot = join(tempRoot, "agent-setup-flow");
    const { env, ampUserRoot, fakeHome, rejectRealHomedir } = createIsolatedAmpTestEnv(
      tempRoot,
      "agent-setup-flow"
    );

    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      join(projectRoot, CLAUDE_PROJECT_FILENAME),
      "# Operator notes\n\nKeep this paragraph.\n",
      "utf8"
    );
    await prepareGitProjectWithAmpInit(projectRoot, env);
    assertCleanAmpGitStatus(projectRoot, "after init");

    const knowledge = await seedLocalProjectionContent({
      projectRoot,
      env,
      homedir: () => fakeHome,
      preference: "Prefer explicit return types on exported AMP functions.",
      runtimeNote: "Queued runtime note for agent setup.",
      capturePattern: "consolidate-after",
    });

    const dryRunProjection = await dryRunLocalProjectionsForTest({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
      knowledge,
    });
    assert.equal(dryRunProjection.ok, true);

    const applyProjection = await applyLocalProjectionsForTest({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
      knowledge,
    });
    assert.equal(applyProjection.ok, true);
    assert.equal(existsSync(join(projectRoot, ".amp", "local", "projection.md")), true);
    assert.equal(existsSync(join(projectRoot, ".amp", "local", "runtime.md")), true);

    const claudeDryRun = await runAmpAgentSetup({
      projectRoot,
      target: "claude-code",
    });
    assert.equal(claudeDryRun.ok, true);
    const claudeBefore = await readFile(join(projectRoot, CLAUDE_PROJECT_FILENAME), "utf8");
    assert.doesNotMatch(claudeBefore, /@\.amp\/local\/projection\.md/);

    const claudeApply = await runAmpAgentSetup({
      projectRoot,
      target: "claude-code",
      apply: true,
    });
    assert.equal(claudeApply.ok, true);
    const claudeAfter = await readFile(join(projectRoot, CLAUDE_PROJECT_FILENAME), "utf8");
    assert.match(claudeAfter, /# Operator notes/);
    assert.match(claudeAfter, /Keep this paragraph\./);
    assert.match(claudeAfter, /@\.amp\/local\/projection\.md/);
    assert.match(claudeAfter, /@\.amp\/local\/runtime\.md/);

    const cursorDryRun = await runAmpAgentSetup({
      projectRoot,
      target: "cursor",
    });
    assert.equal(cursorDryRun.ok, true);
    assert.equal(
      existsSync(join(projectRoot, CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME)),
      false
    );

    const cursorApply = await runAmpAgentSetup({
      projectRoot,
      target: "cursor",
      apply: true,
    });
    assert.equal(cursorApply.ok, true);
    const cursorRule = await readFile(
      join(projectRoot, CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME),
      "utf8"
    );
    assert.match(cursorRule, /## AMP Project Projection/);
    assert.match(cursorRule, /Prefer explicit return types on exported AMP functions\./);
    assert.match(cursorRule, /## AMP Project Runtime/);
    assert.match(cursorRule, /Queued runtime note for agent setup\./);
    assert.doesNotMatch(cursorRule, /@\.amp\/local\//);

    const codexDryRun = await runAmpAgentSetup({
      projectRoot,
      target: "codex",
    });
    assert.equal(codexDryRun.ok, true);
    assert.equal(existsSync(join(projectRoot, "AGENTS.md")), false);

    const codexApply = await runAmpAgentSetup({
      projectRoot,
      target: "codex",
      apply: true,
    });
    assert.equal(codexApply.ok, true);
    const agentsMd = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    assert.match(agentsMd, /## AMP Project Projection/);
    assert.match(agentsMd, /Prefer explicit return types on exported AMP functions\./);
    assert.match(agentsMd, /## AMP Project Runtime/);
    assert.match(agentsMd, /Queued runtime note for agent setup\./);
    assert.doesNotMatch(agentsMd, /@\.amp\/local\//);

    assertCleanAmpGitStatus(projectRoot, "after agent setup");

    const doctor = runAmpDoctor({ projectRoot, env, homedir: () => fakeHome });
    const setupFindings = doctor.findings.filter((f) => f.category === "agent-setup");
    assert.ok(
      setupFindings.some((f) => f.level === "ok" && f.message.includes("CLAUDE.md"))
    );
    assert.ok(
      setupFindings.some((f) => f.level === "ok" && f.message.includes("amp-projection.mdc"))
    );
    assert.ok(
      setupFindings.some((f) => f.level === "ok" && f.message.includes("AGENTS.md"))
    );
    assert.ok(
      setupFindings.some((f) => f.level === "ok" && f.message.includes("projection files present"))
    );

    assert.notEqual(realHomedir(), ampUserRoot);
  });
});
