// OpenClaw plugin: appends hook events to the ai-memory log through `mem log`, and puts
// `mem index` into the system prompt. See ../README.md for enabling it.
// It runs inside the Gateway process, so `mem` is spawned asynchronously, bounded by a timeout,
// and every failure goes to the plugin logger; no handler throws or returns a decision.
import { spawn } from 'node:child_process';

// The store truncates to BUDGETS.maxEventChars as well; cutting here keeps huge tool output off the pipe.
const MAX_TEXT = 8000;
const MEM_TIMEOUT_MS = 2000;

const clip = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? null) ?? '').slice(0, MAX_TEXT);
// Tool results are { content: [{ type: 'text', text }], details }; keep the model-visible text.
const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
const resultText = (r) => clip(Array.isArray(r?.content) ? r.content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : strings(r).join('\n') || r);
// `mem log` requires [A-Za-z0-9._-], alphanumeric first, at most 128 characters.
const safe = (id) => String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 128) || 'unknown';

export default {
  id: 'ai-memory',
  name: 'ai-memory',
  description: 'Logs sessions to the ai-memory transcript log and injects the memory index.',
  register(api) {
    const warn = (msg) => {
      try { api.logger?.warn?.(`ai-memory: ${msg}`); } catch { /* the logger must not break the host either */ }
    };
    const root = typeof api.pluginConfig?.root === 'string' ? ['--root', api.pluginConfig.root] : [];

    const mem = (args, input) => new Promise((resolve) => {
      const done = (out, err) => { if (err) warn(`mem ${args[0]} failed: ${err}`); resolve(out); };
      try {
        const child = spawn(process.env.MEM_BIN || 'mem', [...root, ...args], { timeout: MEM_TIMEOUT_MS, stdio: 'pipe' });
        let out = '', err = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.stdin.on('error', () => {}); // EPIPE when mem exits early; reported through 'close'
        child.on('error', (e) => done(null, e.message));
        child.on('close', (code, signal) => (code === 0 ? done(out) : done(null, err.trim() || signal || `exit ${code}`)));
        child.stdin.end(input);
      } catch (e) {
        done(null, e instanceof Error ? e.message : String(e));
      }
    });

    // One `mem log` at a time, so lines land in the order the hooks fired.
    let queue = Promise.resolve();
    const log = (session, kind, text, extra = {}) => {
      const line = JSON.stringify({ ts: new Date().toISOString(), session: safe(session), host: 'openclaw', kind, ...extra, text: clip(text) });
      queue = queue.then(() => mem(['log'], line + '\n'));
    };
    const sessionOf = (ctx, event) => event?.sessionId ?? ctx?.sessionId ?? ctx?.sessionKey ?? event?.sessionKey;

    const indexBySession = new Map(); // session -> Promise<string>, read once per session
    const seenRuns = new Set(); // runs whose prompt was logged; before_prompt_build fires per attempt

    const on = (hook, handler, opts) => api.on(hook, (event, ctx) => {
      const fail = (e) => warn(`${hook}: ${e instanceof Error ? e.message : String(e)}`);
      try {
        const r = handler(event ?? {}, ctx ?? {});
        return r instanceof Promise ? r.catch(fail) : r;
      } catch (e) {
        fail(e);
      }
    }, opts);

    on('session_start', (e, ctx) => { log(sessionOf(ctx, e), 'session_start', e.resumedFrom ? `resumed from ${e.resumedFrom}` : ''); });
    on('session_end', (e, ctx) => {
      const session = sessionOf(ctx, e);
      indexBySession.delete(session);
      log(session, 'session_end', e.reason ?? '');
    });
    on('before_prompt_build', async (e, ctx) => {
      const session = sessionOf(ctx, e);
      const run = ctx.runId ?? '';
      if (!run || !seenRuns.has(run)) {
        if (run) seenRuns.add(run);
        if (seenRuns.size > 1000) seenRuns.delete(seenRuns.values().next().value);
        if (ctx.trigger !== 'heartbeat') log(session, 'user', e.prompt ?? '');
      }
      // The same text every turn keeps the system prompt cacheable; it is re-read in the next session.
      if (!indexBySession.has(session)) indexBySession.set(session, mem(['index'], '').then((s) => (s ?? '').trim()));
      const index = await indexBySession.get(session);
      return index ? { prependSystemContext: index } : undefined;
    }, { timeoutMs: MEM_TIMEOUT_MS + 500 });
    on('before_tool_call', (e, ctx) => {
      const paths = e.derivedPaths?.length ? [...e.derivedPaths] : [e.params?.path ?? e.params?.file_path].filter((p) => typeof p === 'string');
      log(sessionOf(ctx), 'tool_call', e.params ?? {}, { tool: e.toolName, ...(paths.length && { refs: paths }) });
    });
    on('after_tool_call', (e, ctx) => {
      if (e.error) log(sessionOf(ctx), 'error', e.error, { tool: e.toolName });
      else log(sessionOf(ctx), 'tool_result', resultText(e.result), { tool: e.toolName });
    });
    // Needs plugins.entries.ai-memory.hooks.allowConversationAccess=true; without it OpenClaw skips this hook.
    on('llm_output', (e, ctx) => {
      const text = (e.assistantTexts ?? []).join('\n\n').trim();
      if (text) log(sessionOf(ctx, e), 'assistant', text);
    });
  },
};
