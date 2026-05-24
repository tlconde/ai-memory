/**
 * Shared AMP CLI project/runtime resolution via config discovery.
 */

import { join, resolve } from "node:path";

import { discoverAmpConfig } from "../config/discovery.js";
import { AMP_USER_CONFIG_PATH_ENV } from "../config/paths.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";

export interface ResolveCliProjectContextOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

export interface ResolvedCliProjectContext {
  projectRoot: string;
  projectRef?: string;
  runtimeDbPath: string;
}

/** Resolve project root, project_ref, and runtime DB path for CLI commands. */
export function resolveCliProjectContext(
  options: ResolveCliProjectContextOptions = {}
): ResolvedCliProjectContext {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;

  const resolved = discoverAmpConfig({
    projectRoot,
    env: {
      ...env,
      [AMP_USER_CONFIG_PATH_ENV]:
        env[AMP_USER_CONFIG_PATH_ENV] ?? join(projectRoot, ".amp", "missing-user-config.yaml"),
    },
    platform: options.platform,
    homedir: options.homedir ?? (() => join(projectRoot, "home")),
  });

  return {
    projectRoot,
    projectRef: resolved.projectRef,
    runtimeDbPath: resolved.runtime.dbPath,
  };
}

/** Open a runtime store at the resolved DB path. */
export function openRuntimeStore(dbPath: string): RuntimeStore {
  return new RuntimeStore({ dbPath });
}
