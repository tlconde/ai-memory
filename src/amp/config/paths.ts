/**
 * Platform-default AMP config and runtime paths.
 *
 * Falsifiable claim: macOS and Linux defaults resolve to stable user-data
 * locations unless overridden by env or config files.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const AMP_RUNTIME_PATH_ENV = "AMP_RUNTIME_PATH";
export const AMP_PROJECT_CONFIG_PATH_ENV = "AMP_PROJECT_CONFIG_PATH";
export const AMP_USER_CONFIG_PATH_ENV = "AMP_USER_CONFIG_PATH";

export const PROJECT_CONFIG_DIR = ".amp";
export const PROJECT_CONFIG_FILENAME = "config.yaml";
export const PROJECT_CONFIG_REL = join(PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);

export interface PathContext {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

function ctx(options: PathContext = {}) {
  return {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    homedir: options.homedir ?? homedir,
  };
}

/** Default runtime SQLite path for the current platform. */
export function defaultRuntimeDbPath(options: PathContext = {}): string {
  const { env, platform, homedir: home } = ctx(options);
  const override = env[AMP_RUNTIME_PATH_ENV]?.trim();
  if (override) return override;

  if (platform === "darwin") {
    return join(home(), "Library", "Application Support", "amp", "runtime.db");
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  const base = xdgDataHome && xdgDataHome.length > 0 ? xdgDataHome : join(home(), ".local", "share");
  return join(base, "amp", "runtime.db");
}

/** Default user-level AMP config file path. */
export function defaultUserConfigPath(options: PathContext = {}): string {
  const { env, platform, homedir: home } = ctx(options);
  const override = env[AMP_USER_CONFIG_PATH_ENV]?.trim();
  if (override) return override;

  if (platform === "darwin") {
    return join(home(), "Library", "Application Support", "amp", PROJECT_CONFIG_FILENAME);
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  const base = xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : join(home(), ".config");
  return join(base, "amp", PROJECT_CONFIG_FILENAME);
}

/** Resolve project-level config path under a project root. */
export function projectConfigPath(projectRoot: string, options: PathContext = {}): string {
  const override = options.env?.[AMP_PROJECT_CONFIG_PATH_ENV]?.trim();
  if (override) return override;
  return join(projectRoot, PROJECT_CONFIG_REL);
}
