import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Command } from "commander";

type CheckStatus = "pass" | "warn" | "fail";

export interface ContextCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface CleanCandidate {
  path: string;
  ageDays: number;
}

const CONTEXT_FILES = [
  "START_HERE.md",
  "CODE_MAP.md",
  "INVARIANTS.md",
  "search-scope.json",
  "manifest.json",
  "acceptance.md",
];

const TEMP_CONTEXT_DIRS = [
  "temp/context/drafts",
  "temp/context/freshness",
  "temp/context/scans",
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveProjectRoot(dirOpt?: string): string {
  return resolve(dirOpt ?? process.cwd());
}

function contextDir(projectRoot: string): string {
  return join(projectRoot, ".ai", "context");
}

function aiDir(projectRoot: string): string {
  return join(projectRoot, ".ai");
}

async function writeIfMissing(path: string, content: string): Promise<boolean> {
  if (existsSync(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return true;
}

function gitHead(projectRoot: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function gitFiles(projectRoot: string): string[] {
  try {
    return execFileSync("git", ["ls-files"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function inferContextSourceRoots(projectRoot: string): string[] {
  const files = gitFiles(projectRoot).filter((file) => {
    if (file.startsWith(".ai/")) return false;
    if (file.startsWith("node_modules/") || file.startsWith("dist/")) return false;
    return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs)$/.test(file);
  });

  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split("/");
    const root = parts.length > 1 ? parts[0] : dirname(file);
    if (!root || root === ".") continue;
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([root]) => root);
}

function defaultSearchScope(projectRoot: string): string {
  const roots = inferContextSourceRoots(projectRoot);
  const searchDirectories = roots.length > 0 ? roots : ["."];
  return JSON.stringify(
    {
      version: 1,
      generated_at: nowIso(),
      task_scopes: {
        default: {
          search_directories: searchDirectories,
          exclude_from_search: [
            "node_modules",
            "dist",
            "build",
            "coverage",
            ".git",
            ".ai/temp",
          ],
          verification_shortcuts: [],
        },
      },
    },
    null,
    2
  );
}

function defaultManifest(projectRoot: string): string {
  return JSON.stringify(
    {
      version: 1,
      kind: "ai-memory-context-pack",
      generated_at: nowIso(),
      git_revision: gitHead(projectRoot),
      files: CONTEXT_FILES,
    },
    null,
    2
  );
}

const DEFAULT_START_HERE = `---
id: context-start-here
type: context
status: active
last_updated: ${today()}
---

# Start Here

Small, checked-in navigation context for agents. Read this before opening source files.

## Fast Facts

- Product:
- Main languages:
- Primary quality gate:
- Highest-risk area:

## Scope Rule

Use \`CODE_MAP.md\` and \`search-scope.json\` to pick starting files. Use Context7 for external library documentation.

## Stop Rules

- Stop and ask before changing architecture, data migrations, production deploys, or security-sensitive behavior.
- When claims depend on code, verify with search or direct file reads before acting.
`;

const DEFAULT_CODE_MAP = `---
id: context-code-map
type: context
status: active
last_updated: ${today()}
---

# Code Map

Document the paths agents should inspect first. Keep entries short and evidence-backed.

| Path | What it owns | Why it matters | Risk |
| --- | --- | --- | --- |
| README.md | Project entrypoint | Explains setup and public surface | low |

## Quick Lookup

- Build/test commands:
- CLI entrypoints:
- Configuration:
- Integration points:

## Not Covered In Detail

List significant areas that exist but are intentionally not described yet.
`;

const DEFAULT_INVARIANTS = `---
id: context-invariants
type: context
status: active
last_updated: ${today()}
---

# Behavioral Invariants

Write only rules that were checked against the repo. Prefer scoped wording over universal claims.

| Invariant | Evidence | Update checklist |
| --- | --- | --- |
| Keep project memory under .ai/ | .ai/ exists and install routes agents there | Update .ai/memory/ and run ai-memory verify |

## Negative Guidance

- Do not use this pack as a substitute for reading relevant source files.
- Do not store external library docs here; use Context7 for current docs.
`;

const DEFAULT_ACCEPTANCE = `---
id: context-acceptance
type: context
status: active
last_updated: ${today()}
---

# Context Acceptance

Record quick checks proving the context pack points agents to the right files.

## Suggested Checks

- Lookup: ask where a known command/config lives, then verify with search.
- Impact: ask which files change for a common task, then verify with \`git ls-files\` or \`rg\`.
- Diagnosis: ask where to start for a common failure mode, then verify the files exist.

## Results

<!-- Add dated results here. -->
`;

export async function scaffoldContextPack(projectRoot: string): Promise<string[]> {
  const root = contextDir(projectRoot);
  const added: string[] = [];
  await mkdir(root, { recursive: true });
  for (const dir of TEMP_CONTEXT_DIRS) {
    await mkdir(join(aiDir(projectRoot), dir), { recursive: true });
  }

  const files: Array<[string, string]> = [
    ["START_HERE.md", DEFAULT_START_HERE],
    ["CODE_MAP.md", DEFAULT_CODE_MAP],
    ["INVARIANTS.md", DEFAULT_INVARIANTS],
    ["search-scope.json", defaultSearchScope(projectRoot)],
    ["manifest.json", defaultManifest(projectRoot)],
    ["acceptance.md", DEFAULT_ACCEPTANCE],
  ];

  for (const [file, content] of files) {
    const fullPath = join(root, file);
    if (await writeIfMissing(fullPath, content)) {
      added.push(`.ai/context/${file}`);
    }
  }

  return added;
}

function pathExistsFromProject(projectRoot: string, relPath: string): boolean {
  const clean = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return false;
  return existsSync(join(projectRoot, clean));
}

export async function verifyContextPack(projectRoot: string): Promise<ContextCheck[]> {
  const checks: ContextCheck[] = [];
  const root = contextDir(projectRoot);

  if (!existsSync(root)) {
    return [{ name: ".ai/context", status: "fail", detail: "Missing. Run `ai-memory context init`." }];
  }

  for (const file of CONTEXT_FILES) {
    const fullPath = join(root, file);
    if (!existsSync(fullPath)) {
      checks.push({ name: file, status: "fail", detail: "Missing" });
      continue;
    }
    const content = await readFile(fullPath, "utf8");
    checks.push({
      name: file,
      status: content.trim().length > 0 ? "pass" : "fail",
      detail: content.trim().length > 0 ? "Found" : "Empty",
    });
  }

  const searchScopePath = join(root, "search-scope.json");
  if (existsSync(searchScopePath)) {
    try {
      const parsed = JSON.parse(await readFile(searchScopePath, "utf8")) as {
        task_scopes?: Record<string, { search_directories?: string[]; verification_shortcuts?: Array<{ path?: string; look_for?: string }> }>;
      };
      const scopes = parsed.task_scopes ?? {};
      let missingPaths = 0;
      let shortcutMisses = 0;
      for (const scope of Object.values(scopes)) {
        for (const dir of scope.search_directories ?? []) {
          if (!pathExistsFromProject(projectRoot, dir)) missingPaths++;
        }
        for (const shortcut of scope.verification_shortcuts ?? []) {
          if (!shortcut.path || !pathExistsFromProject(projectRoot, shortcut.path)) {
            shortcutMisses++;
          } else if (shortcut.look_for) {
            const body = await readFile(join(projectRoot, shortcut.path), "utf8").catch(() => "");
            if (!body.includes(shortcut.look_for)) shortcutMisses++;
          }
        }
      }
      checks.push({
        name: "search scope paths",
        status: missingPaths === 0 ? "pass" : "fail",
        detail: missingPaths === 0 ? "All search directories exist" : `${missingPaths} search path(s) missing`,
      });
      checks.push({
        name: "verification shortcuts",
        status: shortcutMisses === 0 ? "pass" : "warn",
        detail: shortcutMisses === 0 ? "All shortcuts resolve" : `${shortcutMisses} shortcut(s) missing or stale`,
      });
    } catch (error) {
      checks.push({ name: "search-scope.json parse", status: "fail", detail: (error as Error).message });
    }
  }

  const manifestPath = join(root, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { git_revision?: string };
      const currentHead = gitHead(projectRoot);
      checks.push({
        name: "manifest freshness",
        status: currentHead === "unknown" || manifest.git_revision === currentHead ? "pass" : "warn",
        detail:
          currentHead === "unknown"
            ? "Not a git repo"
            : manifest.git_revision === currentHead
              ? "Matches current HEAD"
              : "HEAD changed since context pack was generated",
      });
    } catch (error) {
      checks.push({ name: "manifest.json parse", status: "fail", detail: (error as Error).message });
    }
  }

  const codeMap = existsSync(join(root, "CODE_MAP.md"))
    ? await readFile(join(root, "CODE_MAP.md"), "utf8")
    : "";
  const roots = inferContextSourceRoots(projectRoot);
  const uncovered = roots.filter((sourceRoot) => !codeMap.includes(sourceRoot));
  checks.push({
    name: "source root coverage",
    status: uncovered.length === 0 ? "pass" : uncovered.length <= Math.max(1, Math.ceil(roots.length / 2)) ? "warn" : "fail",
    detail: roots.length === 0 ? "No source roots inferred" : uncovered.length === 0 ? "Major roots covered" : `Missing: ${uncovered.join(", ")}`,
  });

  return checks;
}

export function parseDurationDays(input: string | undefined): number {
  if (!input) return 7;
  const match = input.trim().match(/^(\d+)\s*(d|day|days)?$/i);
  if (!match) throw new Error(`Invalid duration "${input}". Use days, e.g. 7d or 14.`);
  return Number(match[1]);
}

async function collectFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

export async function cleanContextTemp(projectRoot: string, olderThanDays: number, apply: boolean): Promise<CleanCandidate[]> {
  const cutoffMs = olderThanDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const candidates: CleanCandidate[] = [];
  for (const dir of TEMP_CONTEXT_DIRS) {
    const fullDir = join(aiDir(projectRoot), dir);
    for (const file of await collectFiles(fullDir)) {
      const stat = statSync(file);
      if (now - stat.mtimeMs < cutoffMs) continue;
      const candidate = {
        path: relative(projectRoot, file).replace(/\\/g, "/"),
        ageDays: Math.floor((now - stat.mtimeMs) / (24 * 60 * 60 * 1000)),
      };
      candidates.push(candidate);
      if (apply) await rm(file, { force: true });
    }
  }
  return candidates.sort((a, b) => a.path.localeCompare(b.path));
}

function printChecks(checks: ContextCheck[]): void {
  for (const check of checks) {
    const icon = check.status === "pass" ? "✓" : check.status === "fail" ? "✗" : "⚠";
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }
}

export function registerContextCommands(program: Command): void {
  const context = new Command("context")
    .description("Manage the small checked-in .ai/context navigation pack");

  context
    .command("init")
    .description("Scaffold .ai/context and .ai/temp/context")
    .option("--dir <dir>", "Project root (default: current directory)")
    .action(async (opts: { dir?: string }) => {
      const projectRoot = resolveProjectRoot(opts.dir);
      await mkdir(aiDir(projectRoot), { recursive: true });
      const added = await scaffoldContextPack(projectRoot);
      if (added.length === 0) {
        console.log("✓ .ai/context already exists. Nothing to add.");
        return;
      }
      for (const path of added) console.log(`  + ${path}`);
      console.log("✓ Context pack scaffolded. Fill the placeholders, then run `ai-memory context verify`.");
    });

  context
    .command("verify")
    .description("Verify .ai/context structure, search paths, and freshness")
    .option("--dir <dir>", "Project root (default: current directory)")
    .option("--json", "Output as JSON")
    .action(async (opts: { dir?: string; json?: boolean }) => {
      const projectRoot = resolveProjectRoot(opts.dir);
      const checks = await verifyContextPack(projectRoot);
      const summary = {
        total: checks.length,
        passed: checks.filter((c) => c.status === "pass").length,
        failed: checks.filter((c) => c.status === "fail").length,
        warnings: checks.filter((c) => c.status === "warn").length,
      };
      if (opts.json) {
        console.log(JSON.stringify({ checks, summary }, null, 2));
      } else {
        console.log("=== ai-memory context verify ===\n");
        printChecks(checks);
        console.log(`\n  ${summary.passed} passed, ${summary.failed} failed, ${summary.warnings} warnings`);
      }
      if (summary.failed > 0) process.exit(1);
    });

  program.addCommand(context);

  program
    .command("clean")
    .description("Clean disposable .ai/temp scratch files")
    .option("--dir <dir>", "Project root (default: current directory)")
    .option("--older-than <duration>", "Only clean files older than N days (default: 7d)", "7d")
    .option("--apply", "Delete candidates. Without this, clean is a dry run.")
    .action(async (opts: { dir?: string; olderThan?: string; apply?: boolean }) => {
      const projectRoot = resolveProjectRoot(opts.dir);
      const olderThanDays = parseDurationDays(opts.olderThan);
      const candidates = await cleanContextTemp(projectRoot, olderThanDays, opts.apply === true);
      if (candidates.length === 0) {
        console.log(`✓ No .ai/temp/context files older than ${olderThanDays} day(s).`);
        return;
      }
      for (const candidate of candidates) {
        console.log(`  ${opts.apply ? "deleted" : "would delete"} ${candidate.path} (${candidate.ageDays}d old)`);
      }
      console.log(opts.apply ? `✓ Deleted ${candidates.length} file(s).` : `\nDry run. Re-run with --apply to delete ${candidates.length} file(s).`);
    });
}
