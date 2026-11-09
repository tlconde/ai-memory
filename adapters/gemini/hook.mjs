#!/usr/bin/env node
// Gemini CLI hook ("hooks" in .gemini/settings.json or ~/.gemini/settings.json). SessionStart injects
// INDEX.md as hookSpecificOutput.additionalContext; Gemini requires stdout to be JSON only. See README.md.
import { clip, isMain, readable, run } from '../_shared/emit.mjs';

// A shell failure has no `error` field: Gemini reports it as "Exit Code: N" inside llmContent.
const failed = (r) => Boolean(r?.error) || /\nExit Code: [1-9]/.test(String(r?.llmContent ?? ''));
const unwrap = (s) => String(s).replace(/<\/?untrusted_context>\n?/g, '').replace(/\nProcess Group PGID: \d+\n?/, '').trim();
// The prompt Gemini passes to BeforeAgent already carries our injected index as a <hook_context> prefix.
const prompt = (s) => String(s ?? '').replace(/^<hook_context>[\s\S]*?<\/hook_context>\n*/, '');

export function gemini(p, env) {
  const cwd = env.GEMINI_PROJECT_DIR || p.cwd || process.cwd();
  const tool = p.tool_name;
  const path = p.tool_input?.file_path ?? p.tool_input?.absolute_path ?? p.tool_input?.path;
  const r = p.tool_response;
  const out = (events, inject) => ({ host: 'gemini', session: p.session_id, cwd, events, inject });
  switch (p.hook_event_name) {
    case 'SessionStart':
      return out([{ kind: 'session_start', text: String(p.source ?? '') }], (index) =>
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: index } }),
      );
    case 'BeforeAgent':
      return out([{ kind: 'user', text: clip(prompt(p.prompt)) }]);
    case 'BeforeTool':
      return out([{ kind: 'tool_call', tool, text: clip(p.tool_input), ...(typeof path === 'string' && { refs: [path] }) }]);
    case 'AfterTool':
      // returnDisplay is the clean text the user saw; llmContent adds wrappers and the exit code.
      return failed(r)
        ? out([{ kind: 'error', tool, text: clip(unwrap(readable(r.error ?? r.llmContent))) }])
        : out([{ kind: 'tool_result', tool, text: readable(r?.returnDisplay ?? r?.llmContent) }]);
    case 'AfterAgent':
      return out([{ kind: 'assistant', text: clip(p.prompt_response) }]);
    case 'SessionEnd':
      return out([{ kind: 'session_end', text: String(p.reason ?? '') }]);
    default:
      return null;
  }
}

if (isMain(import.meta.url)) run(gemini);
