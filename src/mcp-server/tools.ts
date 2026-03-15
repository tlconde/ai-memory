import { readFile, writeFile, readdir, mkdir, unlink } from "fs/promises";
import { join, dirname, resolve, relative } from "path";
import { existsSync } from "fs";
import matter from "gray-matter";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  readP0Entries,
  compileHarnessRules,
  generateRuleTests,
  type HarnessRule,
} from "./p0-parser.js";

// Paths that are ALWAYS immutable (structural, not content)
const ALWAYS_IMMUTABLE = ["toolbox/", "acp/", "rules/"];

// Paths whose immutability is controlled by frontmatter `writable` field
// IDENTITY.md: writable defaults to false (immutable unless opted in)
// DIRECTION.md: writable defaults to true (the AI's evolving program)
const FRONTMATTER_CONTROLLED = ["IDENTITY.md", "DIRECTION.md"];
const WRITABLE_DEFAULTS: Record<string, boolean> = {
  "IDENTITY.md": false,
  "DIRECTION.md": true,
};

async function isImmutable(path: string, aiDir: string): Promise<boolean> {
  // Structural paths are always immutable
  if (ALWAYS_IMMUTABLE.some((p) => path === p || path.startsWith(p))) {
    return true;
  }
  // Frontmatter-controlled files
  for (const controlled of FRONTMATTER_CONTROLLED) {
    if (path === controlled) {
      const fullPath = join(aiDir, controlled);
      try {
        const content = await readFile(fullPath, "utf-8");
        const { data } = matter(content);
        // If frontmatter has `writable`, use that; otherwise use default
        if (typeof data.writable === "boolean") return !data.writable;
        return !WRITABLE_DEFAULTS[controlled];
      } catch {
        return !WRITABLE_DEFAULTS[controlled];
      }
    }
  }
  return false;
}

// ─── Session-aware writes ─────────────────────────────────────────────────────

// Shared path validation: ensures a relative path stays within aiDir
function assertPathWithinAiDir(aiDir: string, relPath: string): string {
  const fullPath = resolve(aiDir, relPath);
  const rel = relative(aiDir, fullPath);
  if (rel.startsWith("..") || rel.startsWith("/") || /\.\.[\\/]/.test(rel)) {
    throw new McpError(ErrorCode.InvalidRequest, "Path traversal not allowed.");
  }
  return fullPath;
}

function generateSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Claim system: prevents concurrent writes to the same path
const CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface Claim {
  session_id: string;
  timestamp: number;
  pid?: number;
}

async function acquireClaim(aiDir: string, path: string, sessionId: string): Promise<void> {
  const locksDir = join(aiDir, "temp", "locks");
  await mkdir(locksDir, { recursive: true });
  const lockFile = join(locksDir, path.replace(/[/\\]/g, "_") + ".lock");

  if (existsSync(lockFile)) {
    try {
      const existing: Claim = JSON.parse(await readFile(lockFile, "utf-8"));
      const age = Date.now() - existing.timestamp;
      if (age < CLAIM_TTL_MS && existing.session_id !== sessionId) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Path "${path}" is claimed by another session (${existing.session_id}, ${Math.round(age / 1000)}s ago). ` +
          `Wait for the claim to expire (${Math.round(CLAIM_TTL_MS / 1000)}s TTL) or close the other session.`
        );
      }
    } catch (err) {
      if (err instanceof McpError) throw err;
      // Corrupt lock file — overwrite
    }
  }

  const claim: Claim = { session_id: sessionId, timestamp: Date.now(), pid: process.pid };
  await writeFile(lockFile, JSON.stringify(claim));
}

async function releaseClaim(aiDir: string, path: string): Promise<void> {
  const lockFile = join(aiDir, "temp", "locks", path.replace(/[/\\]/g, "_") + ".lock");
  try { await unlink(lockFile); } catch { /* already gone */ }
}

// BM25-style keyword search across .ai/ files
async function keywordSearch(
  aiDir: string,
  query: string,
  tags?: string[]
): Promise<Array<{ file: string; excerpt: string; score: number }>> {
  const results: Array<{ file: string; excerpt: string; score: number }> = [];
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (queryTerms.length === 0) return [];

  async function searchDir(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      // Skip temp/ — auto-generated files
      if (entry.name === "temp") continue;
      if (entry.isDirectory()) {
        await searchDir(full);
      } else if (entry.name.endsWith(".md")) {
        try {
          const content = await readFile(full, "utf-8");
          const lower = content.toLowerCase();

          // Tag filter: if tags provided, file must mention all tags
          if (tags && tags.length > 0) {
            const hasAllTags = tags.every((tag) => lower.includes(tag.toLowerCase()));
            if (!hasAllTags) continue;
          }

          // Score: count term occurrences
          let score = 0;
          for (const term of queryTerms) {
            const matches = lower.split(term).length - 1;
            score += matches;
          }
          if (score === 0) continue;

          // Extract best excerpt: find line with most term hits
          const lines = content.split("\n");
          let bestLine = "";
          let bestLineScore = 0;
          for (const line of lines) {
            let lineScore = 0;
            for (const term of queryTerms) {
              if (line.toLowerCase().includes(term)) lineScore++;
            }
            if (lineScore > bestLineScore) {
              bestLineScore = lineScore;
              bestLine = line;
            }
          }

          const relativePath = relative(aiDir, full);
          results.push({ file: relativePath, excerpt: bestLine.trim(), score });
        } catch {
          // unreadable file — skip
        }
      }
    }
  }

  await searchDir(aiDir);
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

// Validate a git diff against harness rules using ast-grep and regex
async function validateDiff(
  diff: string,
  rules: HarnessRule[],
  aiDir: string
): Promise<Array<{ rule_id: string; message: string; severity: string }>> {
  const violations: Array<{ rule_id: string; message: string; severity: string }> = [];

  for (const rule of rules) {
    if (rule.type === "regex") {
      let regex: RegExp;
      try {
        regex = new RegExp(rule.pattern, "gm");
      } catch {
        violations.push({ rule_id: rule.id, message: `Invalid regex pattern: ${rule.pattern}`, severity: rule.severity });
        continue;
      }
      // Check lines added in the diff (lines starting with +)
      const addedLines = diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1))
        .join("\n");

      if (regex.test(addedLines)) {
        violations.push({
          rule_id: rule.id,
          message: rule.message,
          severity: rule.severity,
        });
      }
    } else if (rule.type === "ast") {
      // ast-grep: lazy import so it only loads when needed (Full tier)
      try {
        const { Lang, parse } = await import("@ast-grep/napi");
        const langKey = (rule.language ?? "typescript").toLowerCase();
        const langMap: Record<string, unknown> = {
          typescript: Lang.TypeScript,
          javascript: Lang.JavaScript,
          python: Lang.Python,
          go: Lang.Go,
          rust: Lang.Rust,
        };
        const lang = langMap[langKey] ?? Lang.TypeScript;

        // Extract added code blocks from diff for the relevant file paths
        const diffSections = diff.split(/^diff --git/m).slice(1);
        for (const section of diffSections) {
          // Check if this diff section matches the rule's path pattern
          const fileMatch = section.match(/^[^\n]*b\/(.+)$/m);
          if (!fileMatch) continue;

          // Only process added lines
          const addedCode = section
            .split("\n")
            .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
            .map((l) => l.slice(1))
            .join("\n");

          if (!addedCode.trim()) continue;

          const tree = parse(lang as Parameters<typeof parse>[0], addedCode);
          const root = tree.root();
          const matches = root.findAll(rule.pattern);
          if (matches.length > 0) {
            violations.push({
              rule_id: rule.id,
              message: rule.message,
              severity: rule.severity,
            });
            break;
          }
        }
      } catch {
        // ast-grep not available or parse error — fall back to regex hint
        violations.push({
          rule_id: rule.id,
          message: `${rule.message} (ast-grep unavailable — manual review required)`,
          severity: rule.severity,
        });
      }
    }
  }

  return violations;
}

// Validate memory entry frontmatter against canonical schema
function validateEntrySchema(entry: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const required = ["id", "type", "status"];
  const validTypes = ["identity", "direction", "decision", "pattern", "debugging", "skill", "toolbox", "rule", "agent", "index"];
  const validStatuses = ["active", "deprecated", "experimental"];

  for (const field of required) {
    if (!entry[field]) errors.push(`Missing required field: ${field}`);
  }
  if (entry.type && !validTypes.includes(entry.type as string)) {
    errors.push(`Invalid type: ${entry.type}. Must be one of: ${validTypes.join(", ")}`);
  }
  if (entry.status && !validStatuses.includes(entry.status as string)) {
    errors.push(`Invalid status: ${entry.status}. Must be one of: ${validStatuses.join(", ")}`);
  }
  return errors;
}

export function registerTools(server: Server, aiDir: string): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_memory",
        description: "Search across .ai/ memory files. Returns ranked results with excerpts.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            tags: { type: "array", items: { type: "string" }, description: "Filter by tags (optional)" },
          },
          required: ["query"],
        },
      },
      {
        name: "validate_context",
        description: "Check a git diff against active [P0] rules. Returns violations as errors — hard block if any P0 rule is triggered.",
        inputSchema: {
          type: "object",
          properties: {
            git_diff: { type: "string", description: "Output of git diff" },
          },
          required: ["git_diff"],
        },
      },
      {
        name: "validate_schema",
        description: "Check a proposed memory entry against the canonical schema. Returns validation errors.",
        inputSchema: {
          type: "object",
          properties: {
            entry: { type: "object", description: "Memory entry frontmatter fields to validate" },
          },
          required: ["entry"],
        },
      },
      {
        name: "commit_memory",
        description: "Write a memory entry to .ai/. Enforces immutability (IDENTITY.md immutable by default, DIRECTION.md writable by default — configurable via frontmatter `writable` field). Hard-blocks writes to toolbox/, acp/, rules/. Uses claim-based locking for multi-agent safety.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path within .ai/ (e.g. memory/decisions.md)" },
            content: { type: "string", description: "Content to append or write" },
            append: { type: "boolean", description: "Append to existing file (true) or overwrite (false). Default: true." },
            session_id: { type: "string", description: "Optional session identifier for multi-agent tracking. Auto-generated if not provided." },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "generate_harness",
        description: "Compile harness.json from current [P0] entries. Writes .ai/temp/harness.json and rule tests.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_open_items",
        description: "Returns current open and closed items from sessions/open-items.md.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_memory",
        description: "Get a summary of a specific memory topic.",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string", description: "Topic to summarize (e.g. 'authentication', 'database patterns')" },
          },
          required: ["topic"],
        },
      },
      {
        name: "prune_memory",
        description: "Identify stale or deprecated memory entries for archiving.",
        inputSchema: {
          type: "object",
          properties: {
            dry_run: { type: "boolean", description: "If true, report candidates without modifying files. Default: true." },
          },
        },
      },
      {
        name: "get_evals",
        description: "Returns the latest eval report from .ai/temp/eval-report.json.",
        inputSchema: { type: "object", properties: {} },
      },
      // ─── Autoresearch collaboration tools ────────────────────────────────
      {
        name: "claim_task",
        description: "Claim a task before starting work. Searches any task source file (open-items.md, implementation plans, DIRECTION.md) for matching items. Prevents duplicate work across concurrent agents. Claims expire after 5 minutes.",
        inputSchema: {
          type: "object",
          properties: {
            task_description: { type: "string", description: "Description of the task to claim" },
            source: { type: "string", description: "Relative path to task source file within .ai/ (default: sessions/open-items.md). Can be any file with task lists — e.g. a plan file, DIRECTION.md, etc." },
            session_id: { type: "string", description: "Session identifier. Auto-generated if not provided." },
          },
          required: ["task_description"],
        },
      },
      {
        name: "publish_result",
        description: "Publish an experiment/task result (success or failure) to thread-archive. Every result is recorded for collective learning.",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "What was attempted and what happened" },
            outcome: { type: "string", enum: ["success", "failure", "partial"], description: "Outcome of the work" },
            learnings: { type: "string", description: "What was learned (patterns, anti-patterns, decisions)" },
            session_id: { type: "string", description: "Session identifier. Auto-generated if not provided." },
          },
          required: ["summary", "outcome"],
        },
      },
      {
        name: "sync_memory",
        description: "Persist all .ai/ changes to git. Essential for ephemeral environments (worktrees, cloud agents, sandbox). Stages, commits, and optionally pushes.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Commit message. Auto-generated if not provided." },
            push: { type: "boolean", description: "Push to remote after commit. Default: false." },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    switch (name) {
      case "search_memory": {
        const query = args.query;
        if (typeof query !== "string" || !query.trim()) {
          throw new McpError(ErrorCode.InvalidParams, "query is required and must be a non-empty string.");
        }
        const tags = args.tags as string[] | undefined;
        const results = await keywordSearch(aiDir, query, tags);
        if (results.length === 0) {
          return { content: [{ type: "text", text: "No results found." }] };
        }
        const text = results
          .map((r, i) => `${i + 1}. **${r.file}** (score: ${r.score})\n   ${r.excerpt}`)
          .join("\n\n");
        return { content: [{ type: "text", text }] };
      }

      case "validate_context": {
        const gitDiff = args.git_diff;
        if (typeof gitDiff !== "string" || !gitDiff.trim()) {
          throw new McpError(ErrorCode.InvalidParams, "git_diff is required and must be a non-empty string.");
        }
        const harnessPath = join(aiDir, "temp/harness.json");
        if (!existsSync(harnessPath)) {
          return {
            content: [{ type: "text", text: "No harness.json found. Run generate_harness to create one, or initialize with --full." }],
          };
        }
        let rules: HarnessRule[];
        try {
          const harnessRaw = await readFile(harnessPath, "utf-8");
          rules = JSON.parse(harnessRaw);
        } catch {
          throw new McpError(ErrorCode.InternalError, "Failed to parse harness.json. Run `ai-memory generate-harness` to regenerate.");
        }
        const violations = await validateDiff(gitDiff, rules, aiDir);

        if (violations.length === 0) {
          return { content: [{ type: "text", text: "✓ No constraint violations found." }] };
        }

        // Hard error on P0 violations
        const p0Violations = violations.filter((v) => v.severity === "P0");
        if (p0Violations.length > 0) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `[HARD BLOCK] ${p0Violations.length} P0 constraint violation(s):\n\n` +
              p0Violations.map((v) => `• ${v.message}`).join("\n")
          );
        }

        const text = violations
          .map((v) => `[${v.severity}] ${v.message}`)
          .join("\n");
        return { content: [{ type: "text", text: `Constraint warnings:\n\n${text}` }], isError: true };
      }

      case "validate_schema": {
        const entry = args.entry;
        if (!entry || typeof entry !== "object") {
          throw new McpError(ErrorCode.InvalidParams, "entry is required and must be an object.");
        }
        const errors = validateEntrySchema(entry as Record<string, unknown>);
        if (errors.length === 0) {
          return { content: [{ type: "text", text: "✓ Schema valid." }] };
        }
        throw new McpError(
          ErrorCode.InvalidParams,
          `Schema validation failed:\n\n${errors.map((e) => `• ${e}`).join("\n")}`
        );
      }

      case "commit_memory": {
        const memPath = args.path;
        const memContent = args.content;
        if (typeof memPath !== "string" || !memPath.trim()) {
          throw new McpError(ErrorCode.InvalidParams, "path is required and must be a non-empty string.");
        }
        if (typeof memContent !== "string") {
          throw new McpError(ErrorCode.InvalidParams, "content is required and must be a string.");
        }
        const append = (args.append as boolean) ?? true;
        const sessionId = (typeof args.session_id === "string" && args.session_id) || generateSessionId();

        // Check immutability (reads frontmatter for IDENTITY.md/DIRECTION.md)
        if (await isImmutable(memPath, aiDir)) {
          const reason = FRONTMATTER_CONTROLLED.includes(memPath)
            ? `${memPath} is immutable (set \`writable: true\` in its frontmatter to allow AI writes).`
            : `${memPath} is in a structurally immutable path (${ALWAYS_IMMUTABLE.join(", ")}).`;
          throw new McpError(ErrorCode.InvalidRequest, reason);
        }

        const fullPath = assertPathWithinAiDir(aiDir, memPath);

        // Claim-based locking for multi-agent safety
        await acquireClaim(aiDir, memPath, sessionId);

        try {
          await mkdir(dirname(fullPath), { recursive: true });

          // Session-attributed write header for traceability
          const header = `<!-- session:${sessionId} at:${new Date().toISOString()} -->`;

          if (append && existsSync(fullPath)) {
            const existing = await readFile(fullPath, "utf-8");
            await writeFile(fullPath, existing.trimEnd() + "\n\n" + header + "\n" + memContent);
          } else {
            await writeFile(fullPath, header + "\n" + memContent);
          }
        } finally {
          await releaseClaim(aiDir, memPath);
        }

        return { content: [{ type: "text", text: `✓ Written to ${memPath} (session: ${sessionId})` }] };
      }

      case "generate_harness": {
        const entries = await readP0Entries(aiDir);
        const rules = compileHarnessRules(entries);
        const tests = generateRuleTests(entries);

        const tempDir = join(aiDir, "temp");
        await mkdir(tempDir, { recursive: true });

        await writeFile(join(tempDir, "harness.json"), JSON.stringify(rules, null, 2));

        if (tests.length > 0) {
          const testsDir = join(tempDir, "rule-tests");
          await mkdir(testsDir, { recursive: true });
          await writeFile(join(testsDir, "tests.json"), JSON.stringify(tests, null, 2));
        }

        return {
          content: [
            {
              type: "text",
              text: `✓ Harness generated: ${rules.length} rule(s) compiled from ${entries.length} [P0] entries.\n${
                tests.length > 0 ? `${tests.length} rule test(s) written to temp/rule-tests/tests.json` : "No rule tests found — add **Should trigger:** and **Should not trigger:** examples to [P0] entries."
              }`,
            },
          ],
        };
      }

      case "get_open_items": {
        const openItemsPath = join(aiDir, "sessions/open-items.md");
        try {
          const content = await readFile(openItemsPath, "utf-8");
          return { content: [{ type: "text", text: content }] };
        } catch {
          return { content: [{ type: "text", text: "No open-items.md found. Initialize with `ai-memory init`." }] };
        }
      }

      case "get_memory": {
        const topic = args.topic;
        if (typeof topic !== "string" || !topic.trim()) {
          throw new McpError(ErrorCode.InvalidParams, "topic is required and must be a non-empty string.");
        }
        // Use search as the underlying mechanism
        const results = await keywordSearch(aiDir, topic);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No memory found for topic: ${topic}` }] };
        }
        const text = `Memory for "${topic}":\n\n` +
          results
            .slice(0, 5)
            .map((r) => `**${r.file}**: ${r.excerpt}`)
            .join("\n\n");
        return { content: [{ type: "text", text }] };
      }

      case "prune_memory": {
        const dryRun = (args.dry_run as boolean) ?? true;
        const memDir = join(aiDir, "memory");
        const candidates: string[] = [];

        // Find [DEPRECATED] entries
        if (existsSync(memDir)) {
          const files = await readdir(memDir);
          for (const file of files) {
            if (!file.endsWith(".md")) continue;
            const content = await readFile(join(memDir, file), "utf-8");
            const deprecatedMatches = content.match(/### \[P[0-2]\].+\[DEPRECATED\]/g);
            if (deprecatedMatches) {
              candidates.push(`${file}: ${deprecatedMatches.length} deprecated entry/entries`);
            }
          }
        }

        if (candidates.length === 0) {
          return { content: [{ type: "text", text: "No candidates for pruning found." }] };
        }

        const report = candidates.map((c) => `• ${c}`).join("\n");
        if (dryRun) {
          return {
            content: [
              { type: "text", text: `Prune candidates (dry run — no changes made):\n\n${report}\n\nRun with dry_run: false to archive these entries.` },
            ],
          };
        }

        // Actual prune: move deprecated entries to sessions/archive
        // (simplified: flag for manual review)
        return {
          content: [
            { type: "text", text: `Flagged for archiving:\n\n${report}\n\nReview and move to sessions/archive/ manually, or run \`ai-memory prune\` from the CLI.` },
          ],
        };
      }

      case "get_evals": {
        const evalPath = join(aiDir, "temp/eval-report.json");
        try {
          const content = await readFile(evalPath, "utf-8");
          return { content: [{ type: "text", text: content }] };
        } catch {
          return { content: [{ type: "text", text: "No eval report found. Run `ai-memory eval` to generate one." }] };
        }
      }

      // ─── Autoresearch collaboration handlers ─────────────────────────────

      case "claim_task": {
        const taskDesc = args.task_description;
        if (typeof taskDesc !== "string" || !taskDesc.trim()) {
          throw new McpError(ErrorCode.InvalidParams, "task_description is required.");
        }
        const sessionId = (typeof args.session_id === "string" && args.session_id) || generateSessionId();
        const sourcePath = typeof args.source === "string" && args.source
          ? args.source
          : "sessions/open-items.md";

        // Validate source path stays within aiDir
        const sourceFullPath = assertPathWithinAiDir(aiDir, sourcePath);
        let sourceContent = "";
        try { sourceContent = await readFile(sourceFullPath, "utf-8"); } catch { /* no file yet */ }

        // Find matching unclaimed task line (supports: - [ ], - TODO, - task, numbered lists)
        const taskTerms = taskDesc.toLowerCase().split(/\s+/).filter(Boolean);
        const lines = sourceContent.split("\n");
        let matchedLine = -1;
        let bestScore = 0;
        const taskLinePattern = /^(\s*[-*]\s*\[[ ]\]|\s*[-*]\s|\s*\d+\.\s)/;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!taskLinePattern.test(line)) continue;
          // Skip already claimed or completed tasks
          if (line.includes("[CLAIMED:") || line.match(/\[x\]/i)) continue;
          const lower = line.toLowerCase();
          const score = taskTerms.filter((t) => lower.includes(t)).length;
          if (score > bestScore) {
            bestScore = score;
            matchedLine = i;
          }
        }

        // Claim the task: mark it in-progress with session_id
        if (matchedLine >= 0 && bestScore >= Math.min(2, taskTerms.length)) {
          const original = lines[matchedLine];
          // Mark claimed — preserve original format, append claim marker
          lines[matchedLine] = original.replace("- [ ]", "- [~]") + ` [CLAIMED:${sessionId}]`;
          await writeFile(sourceFullPath, lines.join("\n"));
          return { content: [{ type: "text", text: `✓ Claimed task from ${sourcePath} (session ${sessionId}):\n${lines[matchedLine]}` }] };
        }

        // No match in source file — add as new claimed item to open-items.md
        const openItemsPath = join(aiDir, "sessions/open-items.md");
        let openItems = "";
        try { openItems = await readFile(openItemsPath, "utf-8"); } catch { /* */ }
        const newItem = `- [~] ${taskDesc} [CLAIMED:${sessionId}]`;
        const updated = openItems.includes("## Open")
          ? openItems.replace("## Open", `## Open\n\n${newItem}`)
          : openItems + `\n\n## Open\n\n${newItem}`;
        await mkdir(dirname(openItemsPath), { recursive: true });
        await writeFile(openItemsPath, updated);
        return { content: [{ type: "text", text: `✓ No match in ${sourcePath}. Created and claimed new task in open-items.md (session ${sessionId}):\n${newItem}` }] };
      }

      case "publish_result": {
        const summary = args.summary;
        const outcome = args.outcome;
        if (typeof summary !== "string" || !summary.trim()) {
          throw new McpError(ErrorCode.InvalidParams, "summary is required.");
        }
        if (typeof outcome !== "string" || !["success", "failure", "partial"].includes(outcome)) {
          throw new McpError(ErrorCode.InvalidParams, "outcome must be 'success', 'failure', or 'partial'.");
        }
        const learnings = typeof args.learnings === "string" ? args.learnings : "";
        const sessionId = (typeof args.session_id === "string" && args.session_id) || generateSessionId();
        const date = new Date().toISOString().slice(0, 10);
        const icon = outcome === "success" ? "✓" : outcome === "failure" ? "✗" : "~";

        // Write to thread-archive
        const archivePath = join(aiDir, "sessions/archive/thread-archive.md");
        const entry = `[${date}] [${icon} ${outcome}] ${summary}${learnings ? ` — Learnings: ${learnings}` : ""} (session:${sessionId})`;

        try {
          const existing = await readFile(archivePath, "utf-8");
          await writeFile(archivePath, existing.trimEnd() + "\n" + entry + "\n");
        } catch {
          await mkdir(join(aiDir, "sessions/archive"), { recursive: true });
          await writeFile(archivePath, entry + "\n");
        }

        // If task was claimed, mark it done in open-items
        const openItemsPath = join(aiDir, "sessions/open-items.md");
        try {
          let openItems = await readFile(openItemsPath, "utf-8");
          // Find lines claimed by this session and mark complete/failed
          const marker = outcome === "success" ? "- [x]" : "- [ ]";
          openItems = openItems.replace(
            new RegExp(`^- \\[~\\] (.+?)\\[CLAIMED:${sessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "gm"),
            (_, task) => `${marker} ${task.trim()} [${outcome}:${date}]`
          );
          await writeFile(openItemsPath, openItems);
        } catch { /* no open-items yet */ }

        return { content: [{ type: "text", text: `✓ Result published to thread-archive:\n${entry}` }] };
      }

      case "sync_memory": {
        const commitMsg = typeof args.message === "string" && args.message
          ? args.message
          : `ai-memory: auto-sync ${new Date().toISOString().slice(0, 19)}`;
        const shouldPush = args.push === true;

        const { execFileSync } = await import("child_process");
        const execOpts = { cwd: resolve(aiDir, ".."), encoding: "utf-8" as const, timeout: 30000 };

        try {
          execFileSync("git", ["rev-parse", "--git-dir"], execOpts);
        } catch {
          return { content: [{ type: "text", text: "Not a git repository. sync_memory requires git. Commit .ai/ manually." }] };
        }

        try {
          execFileSync("git", ["add", ".ai/"], execOpts);

          const status = execFileSync("git", ["diff", "--cached", "--name-only"], execOpts).trim();
          if (!status) {
            return { content: [{ type: "text", text: "No .ai/ changes to sync." }] };
          }

          execFileSync("git", ["commit", "-m", commitMsg], execOpts);
          let result = `✓ Committed .ai/ changes: ${commitMsg}\nFiles: ${status.split("\n").length} file(s)`;

          if (shouldPush) {
            try {
              execFileSync("git", ["push"], execOpts);
              result += "\n✓ Pushed to remote.";
            } catch (pushErr) {
              const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
              result += `\n⚠ Push failed: ${msg}\nChanges are committed locally. Push manually.`;
            }
          }

          return { content: [{ type: "text", text: result }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new McpError(ErrorCode.InternalError, `sync_memory failed: ${msg}`);
        }
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  });
}
