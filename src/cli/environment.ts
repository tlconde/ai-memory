/**
 * Environment detection and capability injection for ai-memory install.
 * Reads capability-specs.json and environment-specs.json from templates or .ai/reference/.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

export interface EnvironmentSpec {
  id: string;
  name: string;
  detect: { paths: string[] };
  capabilities?: Record<string, unknown>;
}

export interface CapabilitySpec {
  description?: string;
  environments?: Record<string, unknown>;
  platforms?: Record<string, unknown>;
}

/** Resolve path to specs. Prefer project .ai/reference/, fallback to package templates. */
function getSpecsPath(projectRoot: string, packageRoot: string, filename: string): string {
  const projectRef = join(projectRoot, ".ai", "reference", filename);
  if (existsSync(projectRef)) return projectRef;
  return join(packageRoot, "templates", ".ai", "reference", filename);
}

/** Load and parse JSON spec file. Returns null if missing or invalid. */
function loadSpec<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Detect which environments are present in the project.
 * Checks detect.paths for each env in environment-specs.json.
 */
export function detectEnvironments(projectRoot: string, packageRoot: string): string[] {
  const envPath = getSpecsPath(projectRoot, packageRoot, "environment-specs.json");
  const spec = loadSpec<{ environments?: EnvironmentSpec[] }>(envPath);
  const envs = spec?.environments ?? [];
  const found: string[] = [];
  for (const env of envs) {
    const paths = env.detect?.paths ?? [];
    const present = paths.some((p) => existsSync(join(projectRoot, p)));
    if (present) found.push(env.id);
  }
  return found;
}

/**
 * Get capability config for a given capability and environment.
 * Reads from capability-specs.json → environments[envId].
 */
export function getCapabilityConfig(
  capability: string,
  envId: string,
  projectRoot: string,
  packageRoot: string
): unknown {
  const capPath = getSpecsPath(projectRoot, packageRoot, "capability-specs.json");
  const spec = loadSpec<{ capabilities?: Record<string, CapabilitySpec> }>(capPath);
  const cap = spec?.capabilities?.[capability];
  if (!cap) return null;
  const envConfig = cap.environments?.[envId];
  return envConfig ?? null;
}

/** Get manual setup instructions when capability has manual config for an environment. */
export function getCapabilityManualInstructions(
  capability: string,
  envId: string,
  projectRoot: string,
  packageRoot: string
): string | null {
  const config = getCapabilityConfig(capability, envId, projectRoot, packageRoot) as Record<string, unknown> | null;
  if (!config || typeof config !== "object") return null;
  const manual = config.manual;
  return typeof manual === "string" ? manual : null;
}

/** MCP config paths per environment (relative to project root). Matches install adapter mcpPath. */
const ENV_MCP_PATHS: Record<string, string> = {
  cursor: ".cursor/mcp.json",
  "claude-code": ".mcp.json",
  windsurf: ".mcp.json",
  cline: ".mcp.json",
  antigravity: ".mcp.json", // Antigravity uses global config; project path unused for injection
};

/**
 * Inject MCP config for a capability into the environment's config file.
 * Merges new server entry into mcpServers; does not overwrite existing ai-memory.
 * Returns true if config was written, false if skipped (e.g. native capability).
 */
export function injectCapabilityConfig(
  projectRoot: string,
  envId: string,
  capability: string,
  packageRoot: string
): boolean {
  const configPath = join(projectRoot, ENV_MCP_PATHS[envId] ?? ".mcp.json");
  const config = loadMcpConfig(configPath);

  const capConfig = getCapabilityConfig(capability, envId, projectRoot, packageRoot);
  if (!capConfig || typeof capConfig !== "object") return false;

  const entry = mcpEntryFromCapConfig(capability, capConfig as Record<string, unknown>);
  if (!entry) return false;

  const merged = mergeMcpConfig(config ?? { mcpServers: {} }, capability, entry);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
  return true;
}

function loadMcpConfig(path: string): { mcpServers?: Record<string, unknown> } | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as { mcpServers?: Record<string, unknown> };
  } catch {
    return null;
  }
}

function mcpEntryFromCapConfig(capability: string, config: Record<string, unknown>): unknown {
  if (config.native === true) return null; // Cursor has browser natively; no injection
  if (config.manual !== undefined) return null; // Manual setup (e.g. Antigravity global MCP)
  const mcp = config.mcp as Record<string, unknown> | undefined;
  if (!mcp || typeof mcp !== "object") return null;
  const type = mcp.type as string;
  if (type === "stdio") {
    const command = mcp.command as string;
    const args = mcp.args as string[] | undefined;
    if (!command) return null;
    return {
      type: "stdio",
      command,
      args: args ?? ["-y", "@anthropic-ai/cursor-ide-browser"],
    };
  }
  return null;
}

const CAPABILITY_MCP_KEYS: Record<string, string> = {
  browser: "cursor-ide-browser",
  desktop_automation: "computer-control-mcp",
};

function mergeMcpConfig(
  existing: { mcpServers?: Record<string, unknown> },
  capability: string,
  entry: unknown
): Record<string, unknown> {
  const servers = { ...(existing.mcpServers ?? {}) };
  const key = CAPABILITY_MCP_KEYS[capability] ?? `capability-${capability}`;
  if (!servers[key]) servers[key] = entry;
  return { ...existing, mcpServers: servers };
}
