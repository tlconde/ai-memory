#!/usr/bin/env node
// Claude Code hook: maps each hook event to LogEvents for `mem log` and, at session start, injects
// `mem index` as additionalContext. The same Claude settings hooks also run inside cursor-agent
// (Cursor-shaped payloads, delegated to the Cursor adapter) and Grok CLI (camelCase plus snake_case
// aliases). The Codex adapter reuses claude() because Codex payloads have the Claude shape. See README.md.
import { existsSync } from 'node:fs';
import { clip, isMain, readable, run } from '../_shared/emit.mjs';
import { cursor } from '../cursor/hook.mjs';
import { rulesFile, writeRule } from '../grok/sync-index.mjs';

const isGrok = (p, env) => Boolean(env.GROK_HOOK_EVENT || env.GROK_SESSION_ID || p.workspaceRoot || p.hookEventName);

// Grok's shell result carries its output as a byte array beside `output_for_prompt` and `exit_code`,
// and a non-zero exit arrives as PostToolUse, where Claude Code would fire PostToolUseFailure.
function result(p, tool, grok) {
  const r = p.tool_response;
  if (grok && r && typeof r.output_for_prompt === 'string') {
    return { kind: r.exit_code ? 'error' : 'tool_result', tool, text: clip(r.output_for_prompt) };
  }
  return { kind: 'tool_result', tool, text: readable(r) };
}

/** Claude-shaped payload -> adapter result. `host` is 'codex' when called by the Codex adapter. */
export function claude(p, env, host = 'claude-code') {
  const grok = host === 'claude-code' && isGrok(p, env);
  // The memory root is <cwd>/.memory, so anchor it at the project even after the agent changes directory.
  const cwd = (grok && env.GROK_WORKSPACE_ROOT) || env.CLAUDE_PROJECT_DIR || p.cwd || process.cwd();
  const tool = p.tool_name;
  const path = p.tool_input?.file_path ?? p.tool_input?.notebook_path;
  const one = (e) => [e];
  const events = (() => {
    switch (p.hook_event_name) {
      case 'SessionStart':
        return one({ kind: 'session_start', text: String(p.source ?? '') });
      case 'SessionEnd':
        return one({ kind: 'session_end', text: String(p.reason ?? '') });
      case 'UserPromptSubmit':
        return one({ kind: 'user', text: clip(p.prompt) });
      case 'PreToolUse':
        return one({ kind: 'tool_call', tool, text: clip(p.tool_input), ...(typeof path === 'string' && { refs: [path] }) });
      case 'PostToolUse':
        return one(result(p, tool, grok));
      case 'PostToolUseFailure':
        return one({ kind: 'error', tool, text: clip(p.error) });
      case 'PermissionDenied':
        return one({ kind: 'error', tool, text: clip(`permission denied: ${p.reason ?? ''}`) });
      // Use last_assistant_message rather than the transcript, which may lag at Stop time. Grok also fires
      // a Stop without it at shutdown, which logs nothing.
      case 'Stop':
        return p.last_assistant_message ? one({ kind: 'assistant', text: clip(p.last_assistant_message) }) : [];
      default:
        return [];
    }
  })();
  // JSON rather than plain stdout: plain text that happens to start with `{` would be parsed as JSON.
  // Grok reads only systemMessage from SessionStart, so its index is a rule file (adapters/grok); once the
  // user has created that file, each session start refreshes it for the next session.
  const start = p.hook_event_name === 'SessionStart';
  const inject = !start
    ? undefined
    : grok
      ? existsSync(rulesFile(cwd)) && ((index) => (writeRule(cwd, index), ''))
      : (index) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: index } });
  return { host: grok ? 'grok' : host, session: p.session_id, cwd, events, inject };
}

export const map = (p, env) => (p.cursor_version ? cursor(p, env) : claude(p, env));

if (isMain(import.meta.url)) run(map);
