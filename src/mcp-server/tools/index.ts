import { resolve } from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { getRepoRoot, textResponse } from "./shared.js";
import { handleSearchMemory, handleGetMemory, handleCommitMemory, handlePruneMemory, handleGetOpenItems, handleGetEvals } from "./memory.js";
import { handleValidateContext, handleValidateSchema, handleGenerateHarness } from "./governance.js";
import { handleClaimTask, handlePublishResult, handleSyncMemory } from "./collaboration.js";
import { handleGetDocPath, handleValidateDocPlacement, handleListDocTypes } from "./docs.js";
import { detectTools, readToolConfig, syncTools } from "./tool-inspect.js";

// Re-export ValidationResult for consumers that need the type
export type { ValidationResult } from "./governance.js";

export function registerTools(server: Server, aiDir: string): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_memory",
        description:
          "Searches across .ai/ memory files (memory/, sessions/, agents/, skills/) and returns ranked results with excerpts. " +
          "Uses hybrid search (keyword + semantic + RRF) by default. AI_SEARCH=keyword|semantic|hybrid. " +
          "On Windows, onnxruntime-node may fail; set AI_SEARCH=keyword for keyword-only, or AI_SEARCH_WASM=1 to try WASM. " +
          "Semantic/hybrid requires Linux or macOS for native; Windows uses keyword-only or WASM. " +
          "Each result includes: file path (relative to .ai/), excerpt, and score. " +
          "For best results: use specific terms from the task (e.g. 'MCP launcher Windows', 'claim locking'); optionally filter by tags if the query mentions them.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query — use specific terms relevant to the task" },
            tags: { type: "array", items: { type: "string" }, description: "Filter by tags (optional). Only files containing all tags are returned." },
            limit: { type: "number", description: "Max results to return (default 10, max 20). Use lower values for focused queries." },
            include_deprecated: { type: "boolean", description: "Include [DEPRECATED] entries in results (default false). Set true for auditing or history review." },
          },
          required: ["query"],
        },
      },
      {
        name: "get_repo_root",
        description:
          "Returns the git repository root (absolute path) via `git rev-parse --show-toplevel`. " +
          "Use to resolve paths for validate_context, path traversal checks, or when the agent runs from a subdirectory. " +
          "Returns null if not in a git repo.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "validate_context",
        description:
          "Validates a git diff against active [P0] constraint rules. Returns violations as errors — hard blocks if any P0 rule is triggered. " +
          "You MUST run generate_harness first (or use init --full) to create .ai/temp/harness.json. " +
          "Each violation includes: rule_id, message, severity (P0/P1/P2). P0 violations cause a hard block; P1/P2 return warnings. " +
          "For best results: pass the full output of `git diff` (staged or unstaged) before committing.",
        inputSchema: {
          type: "object",
          properties: {
            git_diff: { type: "string", description: "Output of git diff (e.g. git diff or git diff --cached)" },
          },
          required: ["git_diff"],
        },
      },
      {
        name: "validate_schema",
        description:
          "Validates a proposed memory entry's frontmatter against the canonical schema. Returns validation errors. " +
          "Required fields: id, type, status. Valid types: identity, project-status, decision, pattern, debugging, improvement, index, session, reference, agent, skill, rule, acp, toolbox, docs-schema. Valid statuses: active, deprecated, experimental. " +
          "Use before commit_memory when constructing entries programmatically to catch schema errors early.",
        inputSchema: {
          type: "object",
          properties: {
            entry: { type: "object", description: "Memory entry frontmatter fields to validate (id, type, status, etc.)" },
          },
          required: ["entry"],
        },
      },
      {
        name: "commit_memory",
        description:
          "Writes a memory entry to .ai/. Enforces immutability: IDENTITY.md is immutable by default; PROJECT_STATUS.md is writable by default (configurable via frontmatter `writable`). Hard-blocks writes to toolbox/, acp/, rules/. Uses claim-based locking for multi-agent safety — if another session holds a claim on the path, wait for the 5-minute TTL or close the other session. " +
          "Each write appends a session header for traceability. Use append: false to overwrite (creates new file or replaces). " +
          "For best results: use validate_schema first when constructing entries; pass session_id when coordinating with claim_task or publish_result. When work is done: break down into atomic tasks that fit RALPH loops and avoid conflicts when agents work in parallel.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path within .ai/ (e.g. memory/decisions.md, memory/patterns.md)" },
            content: { type: "string", description: "Content to append or write (include frontmatter for memory entries)" },
            append: { type: "boolean", description: "Append to existing file (true) or overwrite (false). Default: true." },
            session_id: { type: "string", description: "Optional session identifier for multi-agent tracking. Auto-generated if not provided." },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "generate_harness",
        description:
          "Compiles harness.json from current [P0] entries in memory/decisions.md. Writes .ai/temp/harness.json and rule tests to .ai/temp/rule-tests/tests.json. " +
          "Required before validate_context. Run after adding or changing [P0] entries to refresh the rule set.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_open_items",
        description:
          "Returns the current open and closed items from sessions/open-items.md. " +
          "Use at session start to see pending tasks, or before claim_task to avoid duplicate work.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_memory",
        description:
          "Returns a summary of memory for a specific topic. Searches .ai/ and returns top 5 matches with file path and excerpt. " +
          "Use for quick lookups when you need a focused answer (e.g. 'authentication', 'MCP config'). " +
          "For broader exploration, use search_memory instead.",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string", description: "Topic to summarize (e.g. 'authentication', 'database patterns', 'project status')" },
          },
          required: ["topic"],
        },
      },
      {
        name: "prune_memory",
        description:
          "Identifies stale or deprecated memory entries for archiving. Scans memory/*.md for [DEPRECATED] entries. " +
          "Returns a list of candidates with file and entry count. Use dry_run: true (default) to report without modifying; dry_run: false to flag for manual archiving. " +
          "For best results: run periodically to keep memory lean; review candidates before archiving.",
        inputSchema: {
          type: "object",
          properties: {
            dry_run: { type: "boolean", description: "If true, report candidates without modifying files. Default: true." },
          },
        },
      },
      {
        name: "get_evals",
        description:
          "Returns the latest eval report from .ai/temp/eval-report.json. " +
          "Use to check memory health and governance metrics. Run `ai-memory eval` to generate the report.",
        inputSchema: { type: "object", properties: {} },
      },
      // ─── Autoresearch collaboration tools ────────────────────────────────
      {
        name: "claim_task",
        description:
          "Claims a task before starting work. Searches the task source file (open-items.md by default, or PROJECT_STATUS.md) for a matching unclaimed item and marks it [CLAIMED:session_id]. Prevents duplicate work across concurrent agents. Claims expire after 5 minutes. " +
          "If no match is found, creates a new claimed task in open-items.md. " +
          "For best results: use task_description that matches the wording in the source (e.g. 'Add Context7 MCP'); specify source when the task lives in PROJECT_STATUS.md.",
        inputSchema: {
          type: "object",
          properties: {
            task_description: { type: "string", description: "Description of the task to claim (match wording in source for best match)" },
            source: { type: "string", description: "Relative path to task source within .ai/ (default: sessions/open-items.md). Can be PROJECT_STATUS.md or another task list file." },
            session_id: { type: "string", description: "Session identifier. Auto-generated if not provided. Use same ID for publish_result to link result to claim." },
          },
          required: ["task_description"],
        },
      },
      {
        name: "publish_result",
        description:
          "Publishes an experiment or task result (success, failure, or partial) to sessions/archive/thread-archive.md. Every result is recorded for collective learning. " +
          "If the task was claimed via claim_task with the same session_id, marks the task complete (success) or reopened (failure) in open-items.md. " +
          "Each entry includes: date, outcome icon, summary, learnings (optional), session_id. " +
          "For best results: include learnings (patterns, anti-patterns, decisions) to enrich the archive.",
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "What was attempted and what happened" },
            outcome: { type: "string", enum: ["success", "failure", "partial"], description: "Outcome: success, failure, or partial" },
            learnings: { type: "string", description: "What was learned (patterns, anti-patterns, decisions). Optional but recommended." },
            session_id: { type: "string", description: "Session identifier. Auto-generated if not provided. Use same ID as claim_task to link." },
          },
          required: ["summary", "outcome"],
        },
      },
      {
        name: "sync_memory",
        description:
          "Persists all .ai/ changes to git. Stages .ai/, commits with a message, and optionally pushes. Essential for ephemeral environments (worktrees, cloud agents, sandbox). " +
          "Requires a git repository. Returns the commit message and list of files committed. " +
          "For best results: run after commit_memory or other .ai/ writes; use push: true when in a cloud agent or worktree to persist to remote.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Commit message. Auto-generated if not provided." },
            push: { type: "boolean", description: "Push to remote after commit. Default: false." },
          },
        },
      },
      // ─── Documentation management ───────────────────────────────────────────
      {
        name: "get_doc_path",
        description:
          "Returns the canonical path for a documentation type from .ai/docs-schema.json. Use before creating or updating docs — do not infer paths. " +
          "Types: design-system, adr, api-spec, api-guide, model-card, prompts, backlog, decisions-archive, changelog. " +
          "Returns null if schema missing or type unknown. Pass slug for types with * in pattern (e.g. design-system slug=<Project>).",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string", description: "Doc type (e.g. design-system, backlog, changelog)" },
            slug: { type: "string", description: "Optional slug for parameterized types (e.g. project name for design-system)" },
          },
          required: ["type"],
        },
      },
      {
        name: "validate_doc_placement",
        description:
          "Validates a file path against .ai/docs-schema.json. Checks naming convention (SCREAMING_SNAKE by default) and path. " +
          "Returns valid: boolean and errors: string[]. Use before writing docs; run in background during compound. " +
          "If schema missing, returns valid: true.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path to validate (e.g. docs/BACKLOG.md)" },
            paths: { type: "array", items: { type: "string" }, description: "Multiple paths to validate" },
          },
        },
      },
      {
        name: "list_doc_types",
        description:
          "Lists all doc types from .ai/docs-schema.json with their path and pattern. " +
          "Use to discover available types before get_doc_path. Returns empty if schema missing.",
        inputSchema: { type: "object", properties: {} },
      },
      // ─── Tool inspection (cross-tool orchestration) ────────────────────────
      {
        name: "detect_tools",
        description:
          "Detects which AI tools are configured in the project. Scans for .cursor/, .claude/, .agents/, etc. " +
          "Returns list of tools with id, name, and paths that triggered detection. " +
          "Use before read_tool_config or sync_tools to know which tools are present.",
        inputSchema: {
          type: "object",
          properties: {
            project_root: { type: "string", description: "Project root (default: parent of .ai/)" },
          },
        },
      },
      {
        name: "read_tool_config",
        description:
          "Reads rules, skills, and MCP servers for a specific tool. " +
          "Returns rules (file names), skills (subdir names with SKILL.md), mcpServers (from mcp.json). " +
          "Use after detect_tools to inspect a tool's configuration.",
        inputSchema: {
          type: "object",
          properties: {
            tool_id: { type: "string", description: "Tool ID (cursor, claude-code, antigravity)" },
            project_root: { type: "string", description: "Project root (default: parent of .ai/)" },
          },
          required: ["tool_id"],
        },
      },
      {
        name: "sync_tools",
        description:
          "Compares .ai/skills/ against each detected tool's skills dir. Reports drift (missing skills). " +
          "If write: true, copies missing skill stubs from .ai/skills/ to tool dirs (e.g. .cursor/skills/). " +
          "Writes only to tool dirs, never to .ai/ immutable paths.",
        inputSchema: {
          type: "object",
          properties: {
            write: { type: "boolean", description: "If true, write missing skills to tool dirs. Default: false." },
            project_root: { type: "string", description: "Project root (default: parent of .ai/)" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    switch (name) {
      case "search_memory": return handleSearchMemory(aiDir, args);
      case "get_memory": return handleGetMemory(aiDir, args);
      case "commit_memory": return handleCommitMemory(aiDir, args);
      case "prune_memory": return handlePruneMemory(aiDir, args);
      case "get_open_items": return handleGetOpenItems(aiDir);
      case "get_evals": return handleGetEvals(aiDir);

      case "validate_context": return handleValidateContext(aiDir, args);
      case "validate_schema": return handleValidateSchema(aiDir, args);
      case "generate_harness": return handleGenerateHarness(aiDir);

      case "claim_task": return handleClaimTask(aiDir, args);
      case "publish_result": return handlePublishResult(aiDir, args);
      case "sync_memory": return handleSyncMemory(aiDir, args);

      case "get_doc_path": return handleGetDocPath(aiDir, args);
      case "validate_doc_placement": return handleValidateDocPlacement(aiDir, args);
      case "list_doc_types": return handleListDocTypes(aiDir);

      case "detect_tools": {
        const projectRoot = args.project_root
          ? String(args.project_root)
          : resolve(aiDir, "..");
        const tools = detectTools(projectRoot);
        return textResponse(JSON.stringify({ tools }, null, 2));
      }
      case "read_tool_config": {
        const toolId = args.tool_id;
        if (typeof toolId !== "string" || !toolId.trim()) {
          throw new McpError(ErrorCode.InvalidParams, "tool_id is required.");
        }
        const projectRoot = args.project_root
          ? String(args.project_root)
          : resolve(aiDir, "..");
        const config = await readToolConfig(projectRoot, toolId);
        if (!config) return textResponse(`Unknown tool or no config: ${toolId}`);
        return textResponse(JSON.stringify(config, null, 2));
      }
      case "sync_tools": {
        const projectRoot = args.project_root
          ? String(args.project_root)
          : resolve(aiDir, "..");
        const write = (args.write as boolean) ?? false;
        return syncTools(projectRoot, aiDir, { write });
      }

      case "get_repo_root": {
        const cwd = resolve(aiDir, "..");
        const root = getRepoRoot(cwd);
        return textResponse(root ?? "null (not a git repository)");
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  });
}
