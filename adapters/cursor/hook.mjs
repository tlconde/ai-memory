#!/usr/bin/env node
// Cursor hook (IDE and cursor-agent), registered as flat entries in .cursor/hooks.json. cursor-agent also
// runs Claude settings hooks with this same payload, so the Claude Code adapter delegates here.
// sessionStart injects INDEX.md as `additional_context`. See README.md.
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clip, firstTime, isMain, readable, run, safeId, stateDir } from '../_shared/emit.mjs';

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
const textOf = (m) =>
  (m.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').replace(/\s*\[REDACTED\]/g, '').trim();
const unwrap = (t) => (t.match(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/)?.[1] ?? t.replace(/<timestamp>[\s\S]*?<\/timestamp>/, '')).trim();

// cursor-agent -p never fires beforeSubmitPrompt or afterAgentResponse (the server does not request them),
// so at sessionEnd the prompts and each turn's last reply are read back from the transcript instead.
function fromTranscript(path) {
  const events = [];
  let reply = '';
  const flush = () => reply && events.push({ kind: 'assistant', text: clip(reply) }) && (reply = '');
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.role === 'user') flush(), events.push({ kind: 'user', text: clip(unwrap(textOf(m))) });
    else if (m.role === 'assistant') reply = textOf(m) || reply;
    else if (m.type === 'turn_ended') flush();
  }
  flush();
  return events;
}

export function cursor(p, env) {
  const cwd = env.CURSOR_PROJECT_DIR || p.workspace_roots?.[0] || p.cwd || process.cwd();
  // Registered in both .cursor/hooks.json and Claude settings, cursor-agent fires each hook twice with
  // byte-identical payloads (it removes only identical command strings). The payload is the dedupe key.
  if (!firstTime(cwd, `cursor:${JSON.stringify(p)}`)) return null;
  const session = p.session_id || p.conversation_id;
  const live = join(stateDir(cwd), `live-${safeId(session)}`);
  const tool = p.tool_name;
  const path = p.tool_input?.file_path ?? p.tool_input?.path ?? p.tool_input?.target_file;
  const out = (events, inject) => ({ host: 'cursor', session, cwd, events, inject });
  switch (p.hook_event_name) {
    case 'sessionStart':
      return out([{ kind: 'session_start', text: '' }], (index) => JSON.stringify({ additional_context: index }));
    case 'beforeSubmitPrompt':
      closeSync(openSync(live, 'a')); // prompts arrive live in this session: skip transcript recovery
      return out([{ kind: 'user', text: clip(p.prompt) }]);
    case 'preToolUse':
      return out([{ kind: 'tool_call', tool, text: clip(p.tool_input), ...(typeof path === 'string' && { refs: [path] }) }]);
    case 'postToolUse':
      return out([{ kind: 'tool_result', tool, text: readable(parse(p.tool_output)) }]);
    case 'postToolUseFailure':
      return out([{ kind: 'error', tool, text: clip(p.error_message) }]);
    case 'afterAgentResponse':
      return out([{ kind: 'assistant', text: clip(p.text) }]);
    case 'sessionEnd': {
      const recovered = !existsSync(live) && p.transcript_path && existsSync(p.transcript_path) ? fromTranscript(p.transcript_path) : [];
      return out([...recovered, { kind: 'session_end', text: String(p.reason ?? '') }]);
    }
    default:
      return null;
  }
}

if (isMain(import.meta.url)) run(cursor);
