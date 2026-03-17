import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname, resolve } from "path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { assertPathWithinAiDir } from "../../utils/fs.js";
import { generateSessionId, getRepoRoot, sanitizeCommitMessage, textResponse, AI_PATHS, type McpResponse } from "./shared.js";

export async function handleClaimTask(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const taskDesc = args.task_description;
  if (typeof taskDesc !== "string" || !taskDesc.trim()) {
    throw new McpError(ErrorCode.InvalidParams, "task_description is required.");
  }
  const sessionId = (typeof args.session_id === "string" && args.session_id) || generateSessionId();
  const sourcePath = typeof args.source === "string" && args.source
    ? args.source
    : AI_PATHS.OPEN_ITEMS;

  const sourceFullPath = assertPathWithinAiDir(aiDir, sourcePath);
  let sourceContent = "";
  try { sourceContent = await readFile(sourceFullPath, "utf-8"); } catch { /* no file yet */ }

  const taskTerms = taskDesc.toLowerCase().split(/\s+/).filter(Boolean);
  const lines = sourceContent.split("\n");
  let matchedLine = -1;
  let bestScore = 0;
  const taskLinePattern = /^(\s*[-*]\s*\[[ ]\]|\s*[-*]\s|\s*\d+\.\s)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!taskLinePattern.test(line)) continue;
    if (line.includes("[CLAIMED:") || line.match(/\[x\]/i)) continue;
    const lower = line.toLowerCase();
    const score = taskTerms.filter((t) => lower.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      matchedLine = i;
    }
  }

  if (matchedLine >= 0 && bestScore >= Math.min(2, taskTerms.length)) {
    const original = lines[matchedLine];
    lines[matchedLine] = original.replace("- [ ]", "- [~]") + ` [CLAIMED:${sessionId}]`;
    await writeFile(sourceFullPath, lines.join("\n"));
    return textResponse(`✓ Claimed task from ${sourcePath} (session ${sessionId}):\n${lines[matchedLine]}`);
  }

  const openItemsPath = join(aiDir, AI_PATHS.OPEN_ITEMS);
  let openItems = "";
  try { openItems = await readFile(openItemsPath, "utf-8"); } catch {}
  const newItem = `- [~] ${taskDesc} [CLAIMED:${sessionId}]`;
  const updated = openItems.includes("## Open")
    ? openItems.replace("## Open", `## Open\n\n${newItem}`)
    : openItems + `\n\n## Open\n\n${newItem}`;
  await mkdir(dirname(openItemsPath), { recursive: true });
  await writeFile(openItemsPath, updated);
  return textResponse(`✓ No match in ${sourcePath}. Created and claimed new task in open-items.md (session ${sessionId}):\n${newItem}`);
}

export async function handlePublishResult(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
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

  const archivePath = join(aiDir, AI_PATHS.THREAD_ARCHIVE);
  const entry = `[${date}] [${icon} ${outcome}] ${summary}${learnings ? ` — Learnings: ${learnings}` : ""} (session:${sessionId})`;

  try {
    const existing = await readFile(archivePath, "utf-8");
    await writeFile(archivePath, existing.trimEnd() + "\n" + entry + "\n");
  } catch {
    await mkdir(join(aiDir, "sessions/archive"), { recursive: true });
    await writeFile(archivePath, entry + "\n");
  }

  const openItemsPath = join(aiDir, AI_PATHS.OPEN_ITEMS);
  try {
    let openItems = await readFile(openItemsPath, "utf-8");
    const marker = outcome === "success" ? "- [x]" : "- [ ]";
    openItems = openItems.replace(
      new RegExp(`^- \\[~\\] (.+?)\\[CLAIMED:${sessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "gm"),
      (_, task) => `${marker} ${task.trim()} [${outcome}:${date}]`
    );
    await writeFile(openItemsPath, openItems);
  } catch { /* no open-items yet */ }

  return textResponse(`✓ Result published to thread-archive:\n${entry}`);
}

export async function handleSyncMemory(aiDir: string, args: Record<string, unknown>): Promise<McpResponse> {
  const rawMsg = typeof args.message === "string" && args.message
    ? args.message
    : `ai-memory: auto-sync ${new Date().toISOString().slice(0, 19)}`;
  const commitMsg = sanitizeCommitMessage(rawMsg);
  const shouldPush = args.push === true;

  const { execFileSync } = await import("child_process");
  const execOpts = { cwd: resolve(aiDir, ".."), encoding: "utf-8" as const, timeout: 30000 };

  try {
    execFileSync("git", ["rev-parse", "--git-dir"], execOpts);
  } catch {
    return textResponse("Not a git repository. sync_memory requires git. Commit .ai/ manually.");
  }

  try {
    execFileSync("git", ["add", ".ai/"], execOpts);
    const status = execFileSync("git", ["diff", "--cached", "--name-only"], execOpts).trim();
    if (!status) return textResponse("No .ai/ changes to sync.");

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

    return textResponse(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new McpError(ErrorCode.InternalError, `sync_memory failed: ${msg}`);
  }
}
