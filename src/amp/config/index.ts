/**
 * AMP v1 configuration schema and discovery.
 *
 * @module amp/config
 */

export const AMP_CONFIG_MODULE_VERSION = "1.0.0";

export {
  AMP_CONFIG_VERSION,
  AmpConfigFileSchema,
  RuntimeConfigSchema,
  parseAmpConfigFile,
  safeParseAmpConfigFile,
  type AmpConfigFile,
  type RuntimeConfig,
} from "./schema.js";

export {
  AMP_PROJECT_CONFIG_PATH_ENV,
  AMP_USER_CONFIG_PATH_ENV,
  PROJECT_CONFIG_DIR,
  PROJECT_CONFIG_FILENAME,
  PROJECT_CONFIG_REL,
  defaultRuntimeDbPath,
  defaultUserConfigPath,
  projectConfigPath,
  type PathContext,
} from "./paths.js";

export {
  discoverAmpConfig,
  type DiscoverAmpConfigOptions,
  type ResolvedAmpConfig,
  type RuntimePathSource,
} from "./discovery.js";
