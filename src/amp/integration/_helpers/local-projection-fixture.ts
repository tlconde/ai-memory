/**
 * Shared fixtures for offline local projection materialization E2E tests.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../../adapters/ssa/in-memory-knowledge-store.js";
import { runAmpCapture } from "../../cli/capture.js";
import { openRuntimeStore, resolveCliProjectContext } from "../../cli/cli-context.js";
import { runAmpInit } from "../../cli/init.js";
import { runAmpProjectionRender } from "../../cli/projection.js";
import { PROJECTION_FILE_KINDS } from "../../projection/constants.js";
import { consolidateNow } from "../../substrate/storage/consolidation-minimal.js";
import { initGitRepo } from "./invariant-6-git.js";

export interface IsolatedAmpTestEnv {
  env: NodeJS.ProcessEnv;
  fakeHome: string;
  ampUserRoot: string;
  rejectRealHomedir: () => string;
}

export function createIsolatedAmpTestEnv(
  tempRoot: string,
  label: string,
  options?: { knowledgeBackend?: string | false },
): IsolatedAmpTestEnv {
  const fakeHome = join(tempRoot, `${label}-home`);
  const ampUserRoot = join(tempRoot, `${label}-amp-user-root`);
  const env: NodeJS.ProcessEnv = {
    HOME: fakeHome,
    AMP_USER_ROOT: ampUserRoot,
  };
  if (options?.knowledgeBackend !== false) {
    env.AMP_KNOWLEDGE_BACKEND = options?.knowledgeBackend ?? "in-memory";
  }
  const rejectRealHomedir = (): string => {
    throw new Error(`must not resolve real homedir during ${label} E2E`);
  };
  return { env, fakeHome, ampUserRoot, rejectRealHomedir };
}

export async function prepareGitProjectWithAmpInit(
  projectRoot: string,
  env: NodeJS.ProcessEnv
) {
  await mkdir(projectRoot, { recursive: true });
  initGitRepo(projectRoot);
  return runAmpInit({ projectRoot, env });
}

export type LocalProjectionCapturePattern = "consolidate-between" | "consolidate-after";

export interface SeedLocalProjectionContentOptions {
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  preference: string;
  runtimeNote: string;
  capturePattern?: LocalProjectionCapturePattern;
  knowledge?: InMemoryKnowledgeStore;
}

export async function seedLocalProjectionContent(
  options: SeedLocalProjectionContentOptions
): Promise<InMemoryKnowledgeStore> {
  const {
    projectRoot,
    env,
    homedir,
    preference,
    runtimeNote,
    capturePattern = "consolidate-between",
    knowledge = new InMemoryKnowledgeStore(),
  } = options;

  runAmpCapture({
    projectRoot,
    content: preference,
    scope: "project",
    env,
    homedir,
  });

  if (capturePattern === "consolidate-between") {
    const context = resolveCliProjectContext({ projectRoot, env, homedir });
    const runtime = openRuntimeStore(context.runtimeDbPath);
    consolidateNow(runtime, knowledge);
    runtime.close();

    runAmpCapture({
      projectRoot,
      content: runtimeNote,
      scope: "project",
      env,
      homedir,
    });
    return knowledge;
  }

  runAmpCapture({
    projectRoot,
    content: runtimeNote,
    scope: "project",
    env,
    homedir,
  });

  const context = resolveCliProjectContext({ projectRoot, env, homedir });
  const runtime = openRuntimeStore(context.runtimeDbPath);
  try {
    consolidateNow(runtime, knowledge);
  } finally {
    runtime.close();
  }

  return knowledge;
}

export function canonicalLocalProjectionPaths(projectRoot: string, ampUserRoot: string): string[] {
  return [
    join(ampUserRoot, "projection", "global.md"),
    join(ampUserRoot, "runtime", "global.md"),
    join(projectRoot, ".amp", "local", "projection.md"),
    join(projectRoot, ".amp", "local", "runtime.md"),
  ];
}

export async function applyLocalProjectionsForTest(options: {
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  knowledge: InMemoryKnowledgeStore;
}) {
  return runAmpProjectionRender({
    projectRoot: options.projectRoot,
    source: "local",
    apply: true,
    env: options.env,
    homedir: options.homedir,
    knowledgeStore: options.knowledge,
  });
}

export async function dryRunLocalProjectionsForTest(options: {
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  knowledge: InMemoryKnowledgeStore;
}) {
  return runAmpProjectionRender({
    projectRoot: options.projectRoot,
    source: "local",
    dryRun: true,
    env: options.env,
    homedir: options.homedir,
    knowledgeStore: options.knowledge,
  });
}

export { PROJECTION_FILE_KINDS };
