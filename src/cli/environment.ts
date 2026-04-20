/**
 * Environment detection, capability injection, and migration scanning for ai-memory.
 * Reads capability-specs.json and environment-specs.json from templates or .ai/reference/.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { basename, dirname, join, relative } from "path";

export interface MigrateSpec {
  directories?: string[];
  knownSubdirs?: string[];
  rootFiles?: string[];
  crossToolPaths?: string[];
}

export interface EnvironmentSpec {
  id: string;
  name: string;
  detect: { paths: string[] };
  migrate?: MigrateSpec;
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
  const tools = getDetectedToolsWithPaths(projectRoot, packageRoot);
  return tools.map((t) => t.id);
}

/** Detected tool with paths that triggered detection. Used by tool-inspect MCP. */
export interface DetectedToolWithPaths {
  id: string;
  name: string;
  paths: string[];
}

/**
 * Detect which environments are present and which paths triggered detection.
 */
export function getDetectedToolsWithPaths(
  projectRoot: string,
  packageRoot: string
): DetectedToolWithPaths[] {
  const envPath = getSpecsPath(projectRoot, packageRoot, "environment-specs.json");
  const spec = loadSpec<{ environments?: EnvironmentSpec[] }>(envPath);
  const envs = spec?.environments ?? [];
  const found: DetectedToolWithPaths[] = [];
  for (const env of envs) {
    const paths = env.detect?.paths ?? [];
    const present = paths.filter((p) => existsSync(join(projectRoot, p)));
    if (present.length > 0) {
      found.push({ id: env.id, name: env.name, paths: present });
    }
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
  // windsurf: ".mcp.json",
  // cline: ".mcp.json",
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
    const env = mcp.env as Record<string, string> | undefined;
    if (!command) return null;
    const entry: Record<string, unknown> = {
      type: "stdio",
      command,
      args: args ?? ["-y", "@anthropic-ai/cursor-ide-browser"],
    };
    if (env && typeof env === "object") entry.env = env;
    return entry;
  }
  return null;
}

const CAPABILITY_MCP_KEYS: Record<string, string> = {
  browser: "cursor-ide-browser",
  desktop_automation: "ai-memory-desktop-automation",
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

// ─── Migration scanning ────────────────────────────────────────────────────

/** Files managed by ai-memory per tool — excluded from migration scan. */
const AI_MEMORY_MANAGED: Record<string, string[]> = {
  cursor: [
    ".cursor/rules/00-load-ai-memory.mdc",
    ".cursor/mcp.json",
  ],
  "claude-code": [
    "CLAUDE.md",
    ".claude/hooks/SessionStart.js",
    ".claude/hooks/PreCompact.js",
    ".claude/hooks/memory-hygiene.js",
    ".claude/settings.local.json",
    ".mcp.json",
  ],
  antigravity: [
    ".agents/rules/00-load-ai-memory.md",
  ],
  copilot: [
    ".github/copilot-instructions.md",
  ],
};

/** ai-memory's own skill stub names — only these are excluded from migration scan. */
const AI_MEMORY_SKILL_NAMES = new Set([
  "mem-compound",
  "mem-session-close",
  "mem-validate",
  "mem-init",
  "browser",
  "screen-capture",
  "desktop-automation",
  "mem-auto-review",
]);

/** Check if a path is an ai-memory managed skill stub (not a user-created skill). */
function isManagedSkillStub(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const match = normalized.match(/^\.(cursor|claude|agents)\/skills\/([^/]+)\/SKILL\.md$/);
  if (!match) return false;
  return AI_MEMORY_SKILL_NAMES.has(match[2]);
}

/** Config files — reported as "config" category, not skipped. */
const CONFIG_FILE_PATTERNS = [
  /mcp\.json$/,
  /settings\.json$/,
  /settings\.local\.json$/,
  /config\.json$/,
];

/** Files to truly skip (not content, not config — just noise). */
const SKIP_FILE_PATTERNS = [
  /\.gitkeep$/,
];

function isConfigFile(filename: string): boolean {
  return CONFIG_FILE_PATTERNS.some((p) => p.test(filename));
}

function isSkipFile(filename: string): boolean {
  return SKIP_FILE_PATTERNS.some((p) => p.test(filename));
}

/** Result of scanning a tool's directories for migratable files. */
export interface MigrationScanResult {
  toolId: string;
  toolName: string;
  /** Files found in tool directories (not managed by ai-memory, not config files). */
  files: MigratableFile[];
  /** Root files found (e.g. .cursorrules). */
  rootFiles: string[];
  /** Cross-tool paths found (e.g. .claude/agents/ found during cursor scan). */
  crossToolFiles: MigratableFile[];
}

export interface MigratableFile {
  /** Relative path from project root. */
  path: string;
  /** Inferred category: rules, skills, agents, commands, hooks, config, or other. */
  category: "rules" | "skills" | "agents" | "commands" | "hooks" | "config" | "other";
}

/**
 * Recursively lists all files under a directory, returning paths relative to projectRoot.
 */
function listFilesRecursive(dir: string, projectRoot: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full, projectRoot));
    } else if (entry.isFile()) {
      results.push(relative(projectRoot, full).replace(/\\/g, "/"));
    }
  }
  return results;
}

/**
 * Infer category from a file's relative path based on known subdirectory names.
 */
function inferCategory(relPath: string, knownSubdirs?: string[]): MigratableFile["category"] {
  const parts = relPath.replace(/\\/g, "/").split("/");
  // Check known subdirs first (e.g. "rules", "skills"), then fallback to path heuristics
  const allSubdirs = new Set([...(knownSubdirs ?? []), "rules", "skills", "agents", "commands", "hooks"]);
  for (const part of parts) {
    if (allSubdirs.has(part)) {
      return part as MigratableFile["category"];
    }
  }
  // Check file extension / content heuristics
  if (relPath.endsWith(".mdc") || relPath.endsWith("rules")) return "rules";
  return "other";
}

/**
 * Layer 1 — Broad directory scan: scan entire tool directories for user content.
 * Layer 2 — Precise: check known subdirs and root files.
 * Both layers run in parallel and results are merged.
 */
export function scanExistingFiles(
  projectRoot: string,
  packageRoot: string,
  toolId?: string,
): MigrationScanResult[] {
  const envPath = getSpecsPath(projectRoot, packageRoot, "environment-specs.json");
  const spec = loadSpec<{ environments?: (EnvironmentSpec & { migrate?: MigrateSpec })[] }>(envPath);
  const envs = spec?.environments ?? [];

  const results: MigrationScanResult[] = [];

  for (const env of envs) {
    if (toolId && env.id !== toolId) continue;
    if (!env.migrate) continue;

    const managedFiles = new Set(AI_MEMORY_MANAGED[env.id] ?? []);
    const result: MigrationScanResult = {
      toolId: env.id,
      toolName: env.name,
      files: [],
      rootFiles: [],
      crossToolFiles: [],
    };

    // Layer 1: Broad directory scan
    for (const dir of env.migrate.directories ?? []) {
      const absDir = join(projectRoot, dir);
      const allFiles = listFilesRecursive(absDir, projectRoot);
      for (const f of allFiles) {
        if (managedFiles.has(f)) continue;
        if (isManagedSkillStub(f)) continue;
        if (isSkipFile(basename(f))) continue;
        result.files.push({
          path: f,
          category: isConfigFile(basename(f)) ? "config" : inferCategory(f, env.migrate.knownSubdirs),
        });
      }
    }

    // Layer 2: Root files
    for (const rootFile of env.migrate.rootFiles ?? []) {
      const absPath = join(projectRoot, rootFile);
      if (existsSync(absPath)) {
        // Don't double-count if it's also managed
        if (!managedFiles.has(rootFile)) {
          result.rootFiles.push(rootFile);
        }
      }
    }

    // Cross-tool paths
    for (const crossPath of env.migrate.crossToolPaths ?? []) {
      const absPath = join(projectRoot, crossPath);
      if (existsSync(absPath)) {
        const files = listFilesRecursive(absPath, projectRoot);
        for (const f of files) {
          result.crossToolFiles.push({
            path: f,
            category: inferCategory(f, env.migrate.knownSubdirs),
          });
        }
      }
    }

    // Only include tools that have something to report
    if (result.files.length > 0 || result.rootFiles.length > 0 || result.crossToolFiles.length > 0) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Scan root-level *.md files for potential AI-instruction content.
 * Returns files that aren't known non-AI docs (README, CHANGELOG, etc.)
 * and contain AI-instruction patterns in the first 20 lines.
 */
export function scanRootFilesHeuristic(projectRoot: string): string[] {
  const SKIP_FILES = new Set([
    "readme.md",
    "changelog.md",
    "contributing.md",
    "license.md",
    "code_of_conduct.md",
    "security.md",
    "history.md",
    "authors.md",
  ]);

  // Known AI root files — always flag these if found
  const KNOWN_AI_FILES = new Set([
    "claude.md",
    "agents.md",
    "codex.md",
  ]);

  const AI_PATTERNS = [
    /\byou are\b/i,
    /\balways\b/i,
    /\bnever\b/i,
    /\bconstraints?\b/i,
    /\brules?\b:/i,
    /\bpermissions?\b:/i,
    /\bmindset\b/i,
    /\bautonomy\b/i,
    /\balwaysApply\b/i,
    /\bdescription\b:/,
  ];

  const found: string[] = [];

  if (!existsSync(projectRoot)) return found;
  const entries = readdirSync(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    const lower = entry.name.toLowerCase();

    if (SKIP_FILES.has(lower)) continue;

    // Known AI files — always include
    if (KNOWN_AI_FILES.has(lower)) {
      found.push(entry.name);
      continue;
    }

    // Heuristic: check first 20 lines for AI-instruction patterns
    try {
      const content = readFileSync(join(projectRoot, entry.name), "utf-8");
      const lines = content.split("\n").slice(0, 20).join("\n");
      const matchCount = AI_PATTERNS.filter((p) => p.test(lines)).length;
      if (matchCount >= 2) {
        found.push(entry.name);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return found;
}

/**
 * Get the full list of known root files from environment-specs.json.
 */
export function getKnownRootFiles(projectRoot: string, packageRoot: string): string[] {
  const envPath = getSpecsPath(projectRoot, packageRoot, "environment-specs.json");
  const spec = loadSpec<{ knownRootFiles?: string[] }>(envPath);
  return spec?.knownRootFiles ?? [];
}
