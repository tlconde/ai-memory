import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAmpInit } from "./init.js";
export { ACTIVE_PREFERENCE } from "../runtime-semantics/runtime-semantics.test-fixture.js";

export interface RuntimeSeedTestHarness {
  tempRoot: string;
  initProject: (name: string) => Promise<{
    projectRoot: string;
    env: { HOME: string; AMP_KNOWLEDGE_BACKEND: string };
    fakeHome: string;
  }>;
  cleanup: () => Promise<void>;
}

/** Minimal shared setup for runtime seed CLI tests. */
export async function createRuntimeSeedTestHarness(
  prefix: string,
): Promise<RuntimeSeedTestHarness> {
  const tempRoot = await mkdtemp(join(tmpdir(), prefix));

  return {
    tempRoot,
    async initProject(name: string) {
      const projectRoot = join(tempRoot, name);
      const fakeHome = join(tempRoot, `home-${name}`);
      const env = { HOME: fakeHome, AMP_KNOWLEDGE_BACKEND: "in-memory" };
      await runAmpInit({ projectRoot, env });
      return { projectRoot, env, fakeHome };
    },
    async cleanup() {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}
