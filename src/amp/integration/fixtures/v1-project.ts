/**
 * v1 fixture project scaffolding for AMP integration tests.
 *
 * Falsifiable claim: createV1FixtureProject materializes an isolated project
 * tree with AMP config, temp runtime path, harness roots, and selectable
 * knowledge mode without asserting live gbrain or harness E2E success.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverAmpConfig } from "../../config/discovery.js";
import {
  AMP_PROJECT_CONFIG_PATH_ENV,
  AMP_USER_CONFIG_PATH_ENV,
  PROJECT_CONFIG_REL,
} from "../../config/paths.js";

export type V1KnowledgeMode = "in-memory" | "local-gbrain";

export interface V1FixtureHarnessRoots {
  cursorFromAmp: string;
  claudeCodeFromAmp: string;
  hermesFromAmp: string;
}

export interface V1FixtureProject {
  root: string;
  runtimeDbPath: string;
  projectConfigPath: string;
  harnessRoots: V1FixtureHarnessRoots;
  knowledgeMode: V1KnowledgeMode;
}

export interface CreateV1FixtureProjectOptions {
  knowledgeMode?: V1KnowledgeMode;
  projectRef?: string;
}

const DEFAULT_PROJECT_REF = "amp-v1-fixture";

/** Create an isolated on-disk fixture project under a temp directory. */
export async function createV1FixtureProject(
  options: CreateV1FixtureProjectOptions = {}
): Promise<V1FixtureProject> {
  const knowledgeMode = options.knowledgeMode ?? "in-memory";
  const projectRef = options.projectRef ?? DEFAULT_PROJECT_REF;
  const root = await mkdtemp(join(tmpdir(), "amp-v1-fixture-"));
  const runtimeDbPath = join(root, ".amp", "runtime", "runtime.db");
  const projectConfigPath = join(root, PROJECT_CONFIG_REL);

  const harnessRoots: V1FixtureHarnessRoots = {
    cursorFromAmp: join(root, ".cursor", "rules", "from-amp"),
    claudeCodeFromAmp: join(root, ".claude", "skills", "from-amp"),
    hermesFromAmp: join(root, "skills", "from-amp"),
  };

  await mkdir(join(root, ".amp", "runtime"), { recursive: true });
  await mkdir(harnessRoots.cursorFromAmp, { recursive: true });
  await mkdir(harnessRoots.claudeCodeFromAmp, { recursive: true });
  await mkdir(harnessRoots.hermesFromAmp, { recursive: true });

  await writeFile(
    projectConfigPath,
    [
      "amp_config_version: '1.0'",
      `project_ref: ${projectRef}`,
      "runtime:",
      `  db_path: ${runtimeDbPath}`,
      "",
    ].join("\n")
  );

  return {
    root,
    runtimeDbPath,
    projectConfigPath,
    harnessRoots,
    knowledgeMode,
  };
}

/** Remove a fixture project temp tree. */
export async function destroyV1FixtureProject(fixture: V1FixtureProject): Promise<void> {
  await rm(fixture.root, { recursive: true, force: true });
}

/** Resolve AMP config for a fixture using isolated env overrides. */
export function discoverFixtureAmpConfig(fixture: V1FixtureProject) {
  return discoverAmpConfig({
    projectRoot: fixture.root,
    env: {
      [AMP_PROJECT_CONFIG_PATH_ENV]: fixture.projectConfigPath,
      [AMP_USER_CONFIG_PATH_ENV]: join(fixture.root, "missing-user-config.yaml"),
    },
    platform: "linux",
    homedir: () => join(fixture.root, "home"),
  });
}

/** Whether the fixture expects a live local gbrain instance (scaffolding only). */
export function fixtureUsesLocalGbrain(fixture: V1FixtureProject): boolean {
  return fixture.knowledgeMode === "local-gbrain";
}
