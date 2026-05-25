/**
 * Local agent setup E2E — projection materialization plus harness wiring.
 *
 * Falsifiable claim: after init and local projection apply, agent setup writes
 * only CLAUDE.md marker imports and flattened Cursor from-amp mdc while keeping
 * git status clean for AMP-managed project-local paths.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir as realHomedir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { CURSOR_FROM_AMP_REL } from "../adapters/sas/cursor/adapter.js";
import { CURSOR_PROJECTION_RULE_FILENAME } from "../agent-setup/cursor.js";
import { CLAUDE_PROJECT_FILENAME } from "../agent-setup/claude-code.js";
import { runAmpAgentSetup } from "../cli/agent-setup.js";
import { runAmpCapture } from "../cli/capture.js";
import { openRuntimeStore, resolveCliProjectContext } from "../cli/cli-context.js";
import { runAmpDoctor } from "../cli/doctor.js";
import { runAmpInit } from "../cli/init.js";
import { runAmpProjectionRender } from "../cli/projection.js";
import { consolidateNow } from "../substrate/storage/consolidation-minimal.js";
import {
  assertCleanAmpGitStatus,
  initGitRepo,
} from "./_helpers/invariant-6-git.js";

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
    const fakeHome = join(tempRoot, "isolated-home");
    const ampUserRoot = join(tempRoot, "injected-amp-user-root");
    const env = {
      HOME: fakeHome,
      AMP_USER_ROOT: ampUserRoot,
      AMP_KNOWLEDGE_BACKEND: "in-memory",
    };
    const rejectRealHomedir = (): string => {
      throw new Error("must not resolve real homedir during agent setup E2E");
    };

    await mkdir(projectRoot, { recursive: true });
    initGitRepo(projectRoot);
    await writeFile(
      join(projectRoot, CLAUDE_PROJECT_FILENAME),
      "# Operator notes\n\nKeep this paragraph.\n",
      "utf8"
    );

    await runAmpInit({ projectRoot, env });
    assertCleanAmpGitStatus(projectRoot, "after init");

    runAmpCapture({
      projectRoot,
      content: "Prefer explicit return types on exported AMP functions.",
      scope: "project",
      env,
      homedir: () => fakeHome,
    });
    runAmpCapture({
      projectRoot,
      content: "Queued runtime note for agent setup.",
      scope: "project",
      env,
      homedir: () => fakeHome,
    });

    const knowledge = new InMemoryKnowledgeStore();
    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtime = openRuntimeStore(context.runtimeDbPath);
    try {
      consolidateNow(runtime, knowledge);
    } finally {
      runtime.close();
    }

    const dryRunProjection = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      env,
      homedir: rejectRealHomedir,
      knowledgeStore: knowledge,
    });
    assert.equal(dryRunProjection.ok, true);

    const applyProjection = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      apply: true,
      env,
      homedir: rejectRealHomedir,
      knowledgeStore: knowledge,
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
      setupFindings.some((f) => f.level === "ok" && f.message.includes("projection files present"))
    );

    assert.notEqual(realHomedir(), ampUserRoot);
  });
});
