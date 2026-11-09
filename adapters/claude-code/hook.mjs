#!/usr/bin/env node
// Claude Code hook: appends each hook event to the ai-memory log through `mem log`,
// and at session start injects `mem index` as context. See README.md for installation.
// A memory failure must never disturb the session, so this always exits 0 and reports on stderr.
import { spawnSync } from 'node:child_process';

// The store truncates to BUDGETS.maxEventChars as well; cutting here keeps multi-megabyte
// Read results off the pipe.
const MAX_TEXT = 8000;
// SessionEnd hooks get 1.5 s in total by default, and the hook pays Node startup twice.
const MEM_TIMEOUT_MS = 1000;

const clip = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? null)).slice(0, MAX_TEXT);
// Tool responses are objects such as {stdout, stderr} or {file: {content}}. Their string fields are
// joined rather than JSON-encoded, because escaped newlines would glue words together for full-text search.
const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
const readable = (v) => clip(strings(v).filter(Boolean).join('\n') || v);

function toEvents(p) {
  const base = {
    ts: new Date().toISOString(),
    session: String(p.session_id || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_'),
    host: 'claude-code',
  };
  const tool = p.tool_name;
  const path = p.tool_input?.file_path ?? p.tool_input?.notebook_path;
  switch (p.hook_event_name) {
    case 'SessionStart':
      return [{ ...base, kind: 'session_start', text: String(p.source ?? '') }];
    case 'SessionEnd':
      return [{ ...base, kind: 'session_end', text: String(p.reason ?? '') }];
    case 'UserPromptSubmit':
      return [{ ...base, kind: 'user', text: clip(p.prompt) }];
    case 'PreToolUse':
      return [{ ...base, kind: 'tool_call', tool, text: clip(p.tool_input), ...(typeof path === 'string' && { refs: [path] }) }];
    case 'PostToolUse':
      return [{ ...base, kind: 'tool_result', tool, text: readable(p.tool_response) }];
    case 'PostToolUseFailure':
      return [{ ...base, kind: 'error', tool, text: clip(p.error) }];
    case 'PermissionDenied':
      return [{ ...base, kind: 'error', tool, text: clip(`permission denied: ${p.reason ?? ''}`) }];
    // The docs say to use last_assistant_message rather than the transcript, which may lag at Stop time.
    case 'Stop':
      return p.last_assistant_message ? [{ ...base, kind: 'assistant', text: clip(p.last_assistant_message) }] : [];
    default:
      return [];
  }
}

function mem(args, input, cwd) {
  const r = spawnSync(process.env.MEM_BIN || 'mem', args, { input, cwd, encoding: 'utf8', timeout: MEM_TIMEOUT_MS });
  if (r.error || r.status !== 0) {
    process.stderr.write(`ai-memory: mem ${args[0]} failed: ${r.error?.message ?? (r.stderr.trim() || `exit ${r.status}`)}\n`);
    return null;
  }
  return r.stdout;
}

try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const p = JSON.parse(raw);
  // The memory root is <cwd>/.memory, so anchor it at the project even after Claude changes directory.
  const cwd = process.env.CLAUDE_PROJECT_DIR || p.cwd || process.cwd();
  const events = toEvents(p);
  if (events.length) mem(['log'], events.map((e) => JSON.stringify(e)).join('\n') + '\n', cwd);
  if (p.hook_event_name === 'SessionStart') {
    const index = mem(['index'], '', cwd)?.trim();
    // JSON rather than plain stdout: plain text that happens to start with `{` would be parsed as JSON.
    if (index) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: index } }));
  }
} catch (e) {
  process.stderr.write(`ai-memory: ${e instanceof Error ? e.message : String(e)}\n`);
}
