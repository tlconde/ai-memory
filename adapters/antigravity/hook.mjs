#!/usr/bin/env node
// Antigravity hook (.agents/hooks.json). The first PreInvocation of a conversation injects INDEX.md as an
// ephemeral step. Hooks carry the prompt and tool calls but no tool output or reply text, so Stop reads
// the new steps of the conversation's transcript for those. See README.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clip, isMain, run, safeId, stateDir } from '../_shared/emit.mjs';

const load = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { injected: false, step: -1 });

// Transcript lines are steps: PLANNER_RESPONSE (model text and tool_calls), then one step per call with
// its output (GENERIC for run_command: "Command exited with code N.\n\nCommand output:\n...").
function fromTranscript(path, after) {
  const events = [];
  const pending = [];
  let last = after;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const s = JSON.parse(line);
    if (s.step_index <= after) continue;
    last = Math.max(last, s.step_index);
    if (s.type === 'PLANNER_RESPONSE') {
      if (s.content) events.push({ kind: 'assistant', text: clip(s.content) });
      pending.push(...(s.tool_calls ?? []).map((c) => c.name));
    } else if (s.type !== 'USER_INPUT' && pending.length && typeof s.content === 'string') {
      const code = Number(s.content.match(/Command exited with code (\d+)/)?.[1] ?? 0);
      const text = s.content.replace(/^Created At: .*\nCompleted At: .*\n/, '');
      events.push({ kind: code ? 'error' : 'tool_result', tool: pending.shift(), text: clip(text) });
    }
  }
  return { events, last };
}

// Payloads carry no event name, so hooks.json passes it as the first argument.
export function antigravity(p, env, event = process.argv[2]) {
  const cwd = p.workspacePaths?.[0] || process.cwd(); // hooks run in the directory holding hooks.json
  const file = join(stateDir(cwd), `agy-${safeId(p.conversationId)}.json`);
  const state = load(file);
  const save = () => writeFileSync(file, JSON.stringify(state));
  const tool = p.toolCall?.name;
  const args = p.toolCall?.args;
  const path = args?.AbsolutePath ?? args?.TargetFile ?? args?.FilePath;
  // HostName has no 'antigravity' yet: it logs as gemini, the closest adapter, with the real host in refs.
  const out = (events, inject) => ({ host: 'antigravity', session: p.conversationId, cwd, events, inject });
  switch (event) {
    case 'PreInvocation': {
      // invocationNum restarts at 0 for each user turn; lastUserInput is that turn's prompt.
      const events = p.invocationNum === 0 && p.lastUserInput ? [{ kind: 'user', text: clip(p.lastUserInput) }] : [];
      if (state.injected) return out(events);
      state.injected = true;
      save();
      return out([{ kind: 'session_start', text: '' }, ...events], (index) => JSON.stringify({ injectSteps: [{ ephemeralMessage: index }] }));
    }
    case 'PreToolUse':
      return out([{ kind: 'tool_call', tool, text: clip(args), ...(typeof path === 'string' && { refs: [path] }) }]);
    case 'PostToolUse': // no output in the payload; the transcript supplies it at Stop
      return p.error ? out([{ kind: 'error', tool, text: clip(p.error) }]) : null;
    case 'Stop': {
      const t = p.transcriptPath && existsSync(p.transcriptPath) ? fromTranscript(p.transcriptPath, state.step) : { events: [], last: state.step };
      state.step = t.last;
      save();
      return out([...t.events, ...(p.error ? [{ kind: 'error', text: clip(p.error) }] : [])]);
    }
    default:
      return null;
  }
}

if (isMain(import.meta.url)) run(antigravity);
