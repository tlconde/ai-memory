import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";

type SourceKind = "file" | "directory" | "glob";
type SourceStatus = "present" | "missing" | "disabled" | "configure";

export interface ImportSource {
  id: string;
  tool: "claude" | "cursor" | "codex" | "generic";
  kind: SourceKind;
  path: string;
  enabled: boolean;
  description: string;
  documented?: boolean;
  note?: string;
}

export interface ImportConfig {
  version: 1;
  generated_at: string;
  sources: ImportSource[];
}

export interface ImportScanResult {
  source: ImportSource;
  resolvedPath: string;
  status: SourceStatus;
  detail: string;
}

export const IMPORT_CONFIG_REL = ".ai/import-sources.json";
export const IMPORT_TEMP_REL = ".ai/temp/import";

function nowIso(): string {
  return new Date().toISOString();
}

function stamp(): string {
  return nowIso().replace(/[:.]/g, "-");
}

function resolveProjectRoot(dirOpt?: string): string {
  return resolve(dirOpt ?? process.cwd());
}

function expandVariables(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)(:-([^}]*))?\}/gi, (_match, key: string, _fallbackPart: string, fallback: string | undefined) => {
    return process.env[key] ?? fallback ?? "";
  });
}

export function resolveImportPath(projectRoot: string, rawPath: string): string {
  const expanded = expandVariables(rawPath);
  const tildeExpanded = expanded === "~" ? homedir() : expanded.replace(/^~(?=\/|\\)/, homedir());
  if (tildeExpanded.includes("<") || tildeExpanded.includes(">")) return tildeExpanded;
  return resolve(projectRoot, tildeExpanded);
}

export function defaultImportConfig(): ImportConfig {
  return {
    version: 1,
    generated_at: nowIso(),
    sources: [
      {
        id: "claude-project-memory",
        tool: "claude",
        kind: "file",
        path: "CLAUDE.md",
        enabled: true,
        documented: true,
        description: "Project CLAUDE.md instructions loaded by Claude Code.",
      },
      {
        id: "claude-project-rules",
        tool: "claude",
        kind: "directory",
        path: ".claude/rules",
        enabled: true,
        documented: true,
        description: "Project-scoped Claude Code rule files.",
      },
      {
        id: "claude-auto-memory",
        tool: "claude",
        kind: "directory",
        path: "${CLAUDE_CODE_AUTO_MEMORY_DIR:-~/.claude/projects/<project>/memory}",
        enabled: false,
        documented: true,
        description: "Claude Code auto memory directory. Enable after replacing <project> or setting CLAUDE_CODE_AUTO_MEMORY_DIR.",
        note: "Claude documents this as ~/.claude/projects/<project>/memory/ or autoMemoryDirectory in settings.",
      },
      {
        id: "cursor-project-rules",
        tool: "cursor",
        kind: "directory",
        path: ".cursor/rules",
        enabled: true,
        documented: true,
        description: "Cursor project rules included in agent context.",
      },
      {
        id: "cursor-legacy-rules",
        tool: "cursor",
        kind: "file",
        path: ".cursorrules",
        enabled: true,
        documented: true,
        description: "Legacy Cursor project rule file.",
      },
      {
        id: "cursor-chat-exports",
        tool: "cursor",
        kind: "directory",
        path: ".ai/temp/import/cursor-chat-exports",
        enabled: false,
        documented: false,
        description: "Optional user-provided Cursor chat exports or transcript files.",
        note: "Cursor public docs do not define a stable local chat transcript path; put exports here or configure a known path.",
      },
      {
        id: "codex-project-agents",
        tool: "codex",
        kind: "file",
        path: "AGENTS.md",
        enabled: true,
        documented: true,
        description: "Project AGENTS.md instructions used by Codex and other agents.",
      },
      {
        id: "codex-memories",
        tool: "codex",
        kind: "directory",
        path: "${CODEX_HOME:-~/.codex}/memories",
        enabled: true,
        documented: true,
        description: "Codex memory files under CODEX_HOME.",
      },
      {
        id: "codex-history",
        tool: "codex",
        kind: "file",
        path: "${CODEX_HOME:-~/.codex}/history.jsonl",
        enabled: false,
        documented: true,
        description: "Codex prompt history, when history persistence is enabled.",
        note: "Enable only when you intentionally want an agent to inspect prompt history.",
      },
    ],
  };
}

async function writeIfMissing(path: string, content: string): Promise<boolean> {
  if (existsSync(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return true;
}

export async function scaffoldImportConfig(projectRoot: string): Promise<string[]> {
  const added: string[] = [];
  const configPath = join(projectRoot, IMPORT_CONFIG_REL);
  if (await writeIfMissing(configPath, JSON.stringify(defaultImportConfig(), null, 2))) {
    added.push(IMPORT_CONFIG_REL);
  }
  for (const rel of [`${IMPORT_TEMP_REL}/requests`, `${IMPORT_TEMP_REL}/reports`, `${IMPORT_TEMP_REL}/cursor-chat-exports`]) {
    await mkdir(join(projectRoot, rel), { recursive: true });
  }
  return added;
}

export async function readImportConfig(projectRoot: string): Promise<ImportConfig> {
  const configPath = join(projectRoot, IMPORT_CONFIG_REL);
  if (!existsSync(configPath)) return defaultImportConfig();
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as ImportConfig;
  return {
    version: 1,
    generated_at: parsed.generated_at ?? nowIso(),
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
  };
}

function matchesSource(source: ImportSource, selected: string[]): boolean {
  if (selected.length === 0 || selected.includes("all")) return true;
  return selected.includes(source.tool) || selected.includes(source.id);
}

export async function scanImportSources(projectRoot: string, selected: string[] = []): Promise<ImportScanResult[]> {
  const config = await readImportConfig(projectRoot);
  return config.sources
    .filter((source) => matchesSource(source, selected))
    .map((source) => {
      const resolvedPath = resolveImportPath(projectRoot, source.path);
      if (!source.enabled) {
        return { source, resolvedPath, status: "disabled", detail: "Disabled in .ai/import-sources.json" };
      }
      if (resolvedPath.includes("<") || resolvedPath.includes(">")) {
        return { source, resolvedPath, status: "configure", detail: "Replace placeholder path or set the documented environment variable" };
      }
      if (!existsSync(resolvedPath)) {
        return { source, resolvedPath, status: "missing", detail: "Path does not exist" };
      }
      const stat = statSync(resolvedPath);
      const typeOk =
        source.kind === "glob" ||
        (source.kind === "file" && stat.isFile()) ||
        (source.kind === "directory" && stat.isDirectory());
      return {
        source,
        resolvedPath,
        status: typeOk ? "present" : "missing",
        detail: typeOk ? `${source.kind} exists` : `Expected ${source.kind}`,
      };
    });
}

export async function createImportRequest(projectRoot: string, agent: string, selected: string[] = []): Promise<string> {
  await scaffoldImportConfig(projectRoot);
  const scan = await scanImportSources(projectRoot, selected);
  const present = scan.filter((result) => result.status === "present");
  const pending = scan.filter((result) => result.status !== "present");
  const request = buildImportRequest(agent, present, pending);
  const importDir = join(projectRoot, IMPORT_TEMP_REL);
  const requestDir = join(importDir, "requests");
  await mkdir(requestDir, { recursive: true });
  const requestPath = join(requestDir, `${stamp()}-${agent}.md`);
  await writeFile(requestPath, request);
  await writeFile(join(importDir, "latest-request.md"), request);
  return requestPath;
}

export function buildImportRequest(agent: string, present: ImportScanResult[], pending: ImportScanResult[]): string {
  const presentLines = present.length === 0
    ? "- No enabled sources are currently present."
    : present.map((result) => `- ${result.source.id} (${result.source.tool}, ${result.source.kind}): ${result.resolvedPath}`).join("\n");
  const pendingLines = pending.length === 0
    ? "- None."
    : pending.map((result) => `- ${result.source.id}: ${result.status} - ${result.detail} (${result.source.path})`).join("\n");

  return `# ai-memory Import Request

Active agent: ${agent}
Created: ${nowIso()}

Read the enabled source files below and distill only durable project learnings into .ai memory.

## Sources To Inspect

${presentLines}

## Sources Not Ready

${pendingLines}

## Instructions For The Agent

1. Read only the listed present sources. If you need another source, ask the user or add it to .ai/import-sources.json first.
2. Extract durable project facts, decisions, debugging lessons, workflows, and user intent that should survive across tools.
3. Do not bulk-copy raw chat text, secrets, credentials, personal data, or one-off transient chatter.
4. Before writing, inspect .ai/memory/memory-index.md and the relevant .ai/memory/*.md file to avoid duplicates and contradictions.
5. Prefer commit_memory/search_memory when the MCP server is available. If MCP is unavailable, edit the relevant .ai/memory file directly.
6. Update .ai/PROJECT_STATUS.md and .ai/sessions/open-items.md only when the sources reveal current intent or unresolved work.
7. Write a short completion report under .ai/temp/import/reports/ with sources read, memory files changed, and anything skipped.

This request is intentionally a handoff prompt: the hook creates work for a coding agent, and the agent performs the semantic judgment.
`;
}

function printScan(scan: ImportScanResult[]): void {
  for (const result of scan) {
    const icon = result.status === "present" ? "✓" : result.status === "missing" ? "✗" : result.status === "configure" ? "!" : "-";
    console.log(`  ${icon} ${result.source.id}: ${result.detail}`);
  }
}

export function registerImportCommands(program: Command): void {
  const memoryImport = new Command("import")
    .description("Prepare agent-driven imports from tool-native memories and chat exports into .ai memory");

  memoryImport
    .command("init")
    .description("Create .ai/import-sources.json and .ai/temp/import folders")
    .option("--dir <dir>", "Project root (default: current directory)")
    .action(async (opts: { dir?: string }) => {
      const projectRoot = resolveProjectRoot(opts.dir);
      const added = await scaffoldImportConfig(projectRoot);
      if (added.length === 0) {
        console.log("✓ Import sources already configured.");
      } else {
        for (const path of added) console.log(`  + ${path}`);
        console.log("✓ Import sources scaffolded. Enable/configure any private chat export paths before requesting an import.");
      }
    });

  memoryImport
    .command("scan")
    .description("Check configured import source paths without reading their contents")
    .option("--dir <dir>", "Project root (default: current directory)")
    .option("--from <sources>", "Comma-separated tools or source ids (default: all)", "all")
    .option("--json", "Output as JSON")
    .action(async (opts: { dir?: string; from?: string; json?: boolean }) => {
      const projectRoot = resolveProjectRoot(opts.dir);
      const selected = (opts.from ?? "all").split(",").map((part) => part.trim()).filter(Boolean);
      const scan = await scanImportSources(projectRoot, selected);
      if (opts.json) {
        console.log(JSON.stringify({ sources: scan }, null, 2));
      } else {
        console.log("=== ai-memory import scan ===\n");
        printScan(scan);
      }
    });

  memoryImport
    .command("request")
    .description("Write .ai/temp/import/latest-request.md for the active coding agent to process")
    .option("--dir <dir>", "Project root (default: current directory)")
    .option("--agent <agent>", "Active agent name (claude, cursor, codex, generic)", "generic")
    .option("--from <sources>", "Comma-separated tools or source ids (default: all)", "all")
    .action(async (opts: { dir?: string; agent?: string; from?: string }) => {
      const projectRoot = resolveProjectRoot(opts.dir);
      const selected = (opts.from ?? "all").split(",").map((part) => part.trim()).filter(Boolean);
      const requestPath = await createImportRequest(projectRoot, opts.agent ?? "generic", selected);
      console.log(`✓ Wrote ${requestPath}`);
      console.log(`  Ask the active agent to read .ai/temp/import/latest-request.md and perform the import.`);
    });

  program.addCommand(memoryImport);
}
