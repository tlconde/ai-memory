import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAmpInit } from "./init.js";

const ISO = "2026-05-26T12:00:00.000Z";

export const ACTIVE_PREFERENCE = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded" as const,
  scope: "user" as const,
  context: {},
  status: "active" as const,
  expires_at: ISO,
  first_observed_at: ISO,
  last_observed_at: ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium" as const,
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

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
