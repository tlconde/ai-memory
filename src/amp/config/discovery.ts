/**
 * AMP config discovery: merge user + project config with env overrides.
 *
 * Falsifiable claim: resolved runtime.dbPath follows precedence
 * env > project config > user config > platform default.
 */

import { existsSync, readFileSync } from "node:fs";

import yaml from "js-yaml";

import { frameSchemaMismatch } from "../core/errors.js";
import {
  AMP_RUNTIME_PATH_ENV,
  defaultRuntimeDbPath,
  defaultUserConfigPath,
  projectConfigPath,
} from "./paths.js";
import { safeParseAmpConfigFile, type AmpConfigFile } from "./schema.js";

export type RuntimePathSource = "env" | "project" | "user" | "platform-default";

export interface ResolvedAmpConfig {
  projectRef?: string;
  runtime: {
    dbPath: string;
  };
  sources: {
    projectConfigPath?: string;
    userConfigPath?: string;
    runtimePathSource: RuntimePathSource;
  };
}

export interface DiscoverAmpConfigOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

function readConfigFile(path: string): AmpConfigFile | undefined {
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, "utf8");
  const parsed = yaml.load(raw);
  const validated = safeParseAmpConfigFile(parsed);
  if (!validated.success) {
    throw frameSchemaMismatch({ path, issues: validated.error.issues });
  }
  return validated.data;
}

function resolveRuntimePath(
  env: NodeJS.ProcessEnv,
  project?: AmpConfigFile,
  user?: AmpConfigFile,
  pathContext: DiscoverAmpConfigOptions = {}
): { dbPath: string; source: RuntimePathSource } {
  const envOverride = env[AMP_RUNTIME_PATH_ENV]?.trim();
  if (envOverride) {
    return { dbPath: envOverride, source: "env" };
  }

  const projectPath = project?.runtime?.db_path?.trim();
  if (projectPath) {
    return { dbPath: projectPath, source: "project" };
  }

  const userPath = user?.runtime?.db_path?.trim();
  if (userPath) {
    return { dbPath: userPath, source: "user" };
  }

  return {
    dbPath: defaultRuntimeDbPath(pathContext),
    source: "platform-default",
  };
}

/** Discover and merge AMP config from user, project, and env sources. */
export function discoverAmpConfig(options: DiscoverAmpConfigOptions = {}): ResolvedAmpConfig {
  const env = options.env ?? process.env;
  const pathContext = {
    env,
    platform: options.platform,
    homedir: options.homedir,
  };

  const userConfigPath = defaultUserConfigPath(pathContext);
  const userConfig = readConfigFile(userConfigPath);

  let projectConfigPathValue: string | undefined;
  let projectConfig: AmpConfigFile | undefined;
  if (options.projectRoot) {
    projectConfigPathValue = projectConfigPath(options.projectRoot, pathContext);
    projectConfig = readConfigFile(projectConfigPathValue);
  }

  const runtime = resolveRuntimePath(env, projectConfig, userConfig, pathContext);

  return {
    projectRef: projectConfig?.project_ref ?? userConfig?.project_ref,
    runtime: { dbPath: runtime.dbPath },
    sources: {
      projectConfigPath: projectConfig ? projectConfigPathValue : undefined,
      userConfigPath: userConfig ? userConfigPath : undefined,
      runtimePathSource: runtime.source,
    },
  };
}
