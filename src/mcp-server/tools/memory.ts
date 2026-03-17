import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { hybridSearch, getSearchMode } from "../../hybrid-search/index.js";
import { assertPathWithinAiDir } from "../../utils/fs.js";
import {
  isImmutable, ALWAYS_IMMUTABLE, FRONTMATTER_CONTROLLED,
  generateSessionId, acquireClaim, releaseClaim,
  MAX_COMMIT_CONTENT_BYTES, AI_PATHS, textResponse, type McpResponse,
} from "./shared.js";

type SearchOptsWithoutMode = Omit<Parameters<typeof hybridSearch>[2], "mode">;

async function searchWithFallback(aiDir: string, query: string, opts: SearchOptsWithoutMode) {
  const mode = getSearchMode();
  let fallbackNote = "";
  let resp: Awaited<ReturnType<typeof hybridSearch>>;
  try {
    resp = await hybridSearch(aiDir, query, { ...opts, mode });
  } catch {
    if (mode !== "keyword") {
      resp = await hybridSearch(aiDir, query, { ...opts, mode: "keyword" });
      fallbackNote = "Note: Hybrid/semantic search failed. Using keyword-only. Set AI_SEARCH=keyword or AI_SEARCH_WASM=1.\n\n";
    } else {
      throw new McpError(ErrorCode.InternalError, "Search failed.");
    }
  }
  return { ...resp, fallbackNote };
}

export async function handleSearchMemory(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const query = args.query;
  if (typeof query !== "string" || !query.trim()) {
    throw new McpError(ErrorCode.InvalidParams, "query is required and must be a non-empty string.");
  }
  const tags = args.tags as string[] | undefined;
  const userLimit = Math.min(Number(args.limit) || 10, 20);
  const includeDeprecated = (args.include_deprecated as boolean) ?? false;
  const { results, backend, fallbackNote } = await searchWithFallback(aiDir, query, { limit: userLimit, tags, includeDeprecated });
  if (results.length === 0) return textResponse("No results found.");
  const backendLabel = backend === "keyword" ? "Keyword-only" : backend === "native" ? "Hybrid (Native)" : "Hybrid (WASM)";
  const text = fallbackNote + `Search backend: ${backendLabel}\n\n` +
    results.map((r, i) => {
      const excerpt = r.excerpt.length > 200 ? r.excerpt.slice(0, 200) + "…" : r.excerpt;
      return `${i + 1}. **${r.file}** (score: ${r.score})\n   ${excerpt}`;
    }).join("\n\n");
  return textResponse(text);
}

export async function handleGetMemory(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const topic = args.topic;
  if (typeof topic !== "string" || !topic.trim()) {
    throw new McpError(ErrorCode.InvalidParams, "topic is required and must be a non-empty string.");
  }
  const { results, backend, fallbackNote } = await searchWithFallback(aiDir, topic, { limit: 5 });
  if (results.length === 0) return textResponse(`No memory found for topic: ${topic}`);
  const backendLabel = backend === "keyword" ? "Keyword-only" : backend === "native" ? "Hybrid (Native)" : "Hybrid (WASM)";
  const text = fallbackNote + `Search backend: ${backendLabel}\n\nMemory for "${topic}":\n\n` +
    results.map((r) => `**${r.file}**: ${r.excerpt}`).join("\n\n");
  return textResponse(text);
}

export async function handleCommitMemory(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const memPath = args.path;
  const memContent = args.content;
  if (typeof memPath !== "string" || !memPath.trim()) {
    throw new McpError(ErrorCode.InvalidParams, "path is required and must be a non-empty string.");
  }
  if (typeof memContent !== "string") {
    throw new McpError(ErrorCode.InvalidParams, "content is required and must be a string.");
  }
  const contentBytes = Buffer.byteLength(memContent, "utf-8");
  if (contentBytes > MAX_COMMIT_CONTENT_BYTES) {
    throw new McpError(ErrorCode.InvalidParams, `content exceeds ${MAX_COMMIT_CONTENT_BYTES / 1024 / 1024}MB limit (got ${Math.round(contentBytes / 1024)}KB). Split into smaller entries.`);
  }
  const append = (args.append as boolean) ?? true;
  const sessionId = (typeof args.session_id === "string" && args.session_id) || generateSessionId();

  if (await isImmutable(memPath, aiDir)) {
    const reason = FRONTMATTER_CONTROLLED.includes(memPath)
      ? `${memPath} is immutable (set \`writable: true\` in its frontmatter to allow AI writes).`
      : `${memPath} is in a structurally immutable path (${ALWAYS_IMMUTABLE.join(", ")}).`;
    throw new McpError(ErrorCode.InvalidRequest, reason);
  }

  const fullPath = assertPathWithinAiDir(aiDir, memPath);
  await acquireClaim(aiDir, memPath, sessionId);

  try {
    await mkdir(dirname(fullPath), { recursive: true });
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

  return textResponse(`✓ Written to ${memPath} (session: ${sessionId})`);
}

export async function handlePruneMemory(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const dryRun = (args.dry_run as boolean) ?? true;
  const memDir = join(aiDir, "memory");
  const candidates: string[] = [];

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

  if (candidates.length === 0) return textResponse("No candidates for pruning found.");

  const report = candidates.map((c) => `• ${c}`).join("\n");
  if (dryRun) {
    return textResponse(`Prune candidates (dry run — no changes made):\n\n${report}\n\nRun with dry_run: false to archive these entries.`);
  }
  return textResponse(`Flagged for archiving:\n\n${report}\n\nReview and move to sessions/archive/ manually, or run \`ai-memory prune\` from the CLI.`);
}

export async function handleGetOpenItems(aiDir: string): Promise<McpResponse> {
  const openItemsPath = join(aiDir, AI_PATHS.OPEN_ITEMS);
  try {
    const content = await readFile(openItemsPath, "utf-8");
    return textResponse(content);
  } catch {
    return textResponse("No open-items.md found. Initialize with `ai-memory init`.");
  }
}

export async function handleGetEvals(aiDir: string): Promise<McpResponse> {
  const evalPath = join(aiDir, AI_PATHS.EVAL_REPORT);
  try {
    const content = await readFile(evalPath, "utf-8");
    return textResponse(content);
  } catch {
    return textResponse("No eval report found. Run `ai-memory eval` to generate one.");
  }
}
