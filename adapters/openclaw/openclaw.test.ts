import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogEvent } from '../../src/types.ts';
// @ts-expect-error plain JS plugin without type declarations
import plugin from './ai-memory/index.js';

const dir = import.meta.dirname;
const FAKE_MEM = join(dir, 'fixtures/fake-mem.mjs');

type Handler = (event: unknown, ctx: unknown) => unknown;
interface MemCall { args: string[]; stdin: string }

/** A stand-in for OpenClawPluginApi that records what the plugin registers. */
function load(pluginConfig: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  const out = join(mkdtempSync(join(tmpdir(), 'mem-openclaw-')), 'calls.jsonl');
  for (const k of ['FAKE_MEM_INDEX', 'FAKE_MEM_FAIL', 'FAKE_MEM_HANG']) delete process.env[k];
  Object.assign(process.env, { MEM_BIN: FAKE_MEM, FAKE_MEM_OUT: out }, env);
  const handlers = new Map<string, Handler>();
  const opts = new Map<string, unknown>();
  const warnings: string[] = [];
  plugin.register({
    id: 'ai-memory',
    pluginConfig,
    logger: { info() {}, warn: (m: string) => warnings.push(m), error() {} },
    on(name: string, handler: Handler, o?: unknown) {
      handlers.set(name, handler);
      opts.set(name, o);
    },
  });
  const fire = (name: string, event: unknown, ctx: unknown) => handlers.get(name)!(event, ctx);
  const calls = (): MemCall[] => (existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const logged = () => calls().filter((c) => c.args.at(-1) === 'log').flatMap((c) => c.stdin.trim().split('\n').map((l) => JSON.parse(l) as LogEvent));
  /** Waits until `n` events reached the fake mem; logging is fire-and-forget in the plugin. */
  async function events(n: number) {
    for (let i = 0; i < 100 && logged().length < n; i++) await new Promise((r) => setTimeout(r, 50));
    return logged().map(({ ts, ...rest }) => {
      assert.ok(!Number.isNaN(Date.parse(ts)), ts);
      return rest;
    });
  }
  return { handlers, opts, warnings, fire, calls, events };
}

// Payloads follow openclaw 2026.7.1-2 dist/hook-types-*.d.ts: PluginHook<Name>Event plus its context type.
const sessionCtx = { agentId: 'main', sessionId: 's-1', sessionKey: 'agent:main:main' };
const agentCtx = { runId: 'run-1', agentId: 'main', sessionKey: 'agent:main:main', sessionId: 's-1', workspaceDir: '/work', trigger: 'user', channel: 'telegram' };
const toolCtx = { agentId: 'main', sessionKey: 'agent:main:main', sessionId: 's-1', runId: 'run-1', toolName: 'read', toolCallId: 'call-1' };
const readParams = { path: '/work/notes.txt' };
const base = { session: 's-1', host: 'openclaw' } as const;

test('registers the hooks it maps, with a bounded prompt-build budget', () => {
  const { handlers, opts } = load();
  assert.deepEqual([...handlers.keys()].sort(), ['after_tool_call', 'before_prompt_build', 'before_tool_call', 'llm_output', 'session_end', 'session_start']);
  assert.deepEqual(opts.get('before_prompt_build'), { timeoutMs: 2500 });
});

test('maps each hook payload to the LogEvents sent to mem log', async () => {
  const { fire, events, calls } = load({}, { FAKE_MEM_INDEX: '# Index\n- fact\n' });
  fire('session_start', { sessionId: 's-1', sessionKey: 'agent:main:main' }, sessionCtx);
  assert.deepEqual(await fire('before_prompt_build', { prompt: 'What is in notes.txt?', messages: [] }, agentCtx), { prependSystemContext: '# Index\n- fact' });
  // A retried attempt of the same run: the prompt is not logged twice and the index is not re-read.
  assert.deepEqual(await fire('before_prompt_build', { prompt: 'What is in notes.txt?', messages: [] }, agentCtx), { prependSystemContext: '# Index\n- fact' });
  assert.equal(fire('before_tool_call', { toolName: 'read', params: readParams, runId: 'run-1', toolCallId: 'call-1' }, toolCtx), undefined);
  fire('after_tool_call', { toolName: 'read', params: readParams, runId: 'run-1', toolCallId: 'call-1', result: { content: [{ type: 'text', text: 'alpha beta' }], details: { bytes: 10 } }, durationMs: 4 }, toolCtx);
  fire('before_tool_call', { toolName: 'apply_patch', params: { input: '*** Begin Patch' }, derivedPaths: ['/work/a.ts'], runId: 'run-1', toolCallId: 'call-2' }, { ...toolCtx, toolName: 'apply_patch' });
  fire('after_tool_call', { toolName: 'exec', params: { command: 'false' }, runId: 'run-1', toolCallId: 'call-3', error: 'exit code 1', durationMs: 9 }, { ...toolCtx, toolName: 'exec' });
  fire('llm_output', { runId: 'run-1', sessionId: 's-1', provider: 'openai', model: 'gpt-5.4', assistantTexts: ['It says', 'alpha beta.'], usage: { input: 10, output: 4 } }, agentCtx);
  fire('session_end', { sessionId: 's-1', sessionKey: 'agent:main:main', messageCount: 4, durationMs: 1000, reason: 'new', nextSessionId: 's-2' }, sessionCtx);
  assert.deepEqual(await events(8), [
    { ...base, kind: 'session_start', text: '' },
    { ...base, kind: 'user', text: 'What is in notes.txt?' },
    { ...base, kind: 'tool_call', tool: 'read', text: '{"path":"/work/notes.txt"}', refs: ['/work/notes.txt'] },
    { ...base, kind: 'tool_result', tool: 'read', text: 'alpha beta' },
    { ...base, kind: 'tool_call', tool: 'apply_patch', text: '{"input":"*** Begin Patch"}', refs: ['/work/a.ts'] },
    { ...base, kind: 'error', tool: 'exec', text: 'exit code 1' },
    { ...base, kind: 'assistant', text: 'It says\n\nalpha beta.' },
    { ...base, kind: 'session_end', text: 'new' },
  ]);
  assert.equal(calls().filter((c) => c.args.at(-1) === 'index').length, 1);
});

test('skips heartbeat prompts, makes session ids filename-safe and truncates oversized text', async () => {
  const { fire, events } = load();
  await fire('before_prompt_build', { prompt: 'HEARTBEAT', messages: [] }, { ...agentCtx, runId: 'run-hb', trigger: 'heartbeat' });
  fire('after_tool_call', { toolName: 'exec', params: {}, result: { content: [{ type: 'text', text: 'x'.repeat(50_000) }] } }, { toolName: 'exec', sessionKey: '../agent:main/x' });
  const [e] = await events(1);
  assert.equal(e?.session, 'agent_main_x');
  assert.equal(e?.text.length, 8000);
});

test('passes the configured root to mem', async () => {
  const { fire, events, calls } = load({ root: '/data/.memory' });
  fire('session_start', { sessionId: 's-1' }, sessionCtx);
  await events(1);
  assert.deepEqual(calls()[0]?.args, ['--root', '/data/.memory', 'log']);
});

test('a missing, failing or hung mem never throws or blocks the host', async () => {
  const envs: Record<string, string>[] = [{ MEM_BIN: join(dir, 'missing-mem') }, { FAKE_MEM_FAIL: '1' }, { FAKE_MEM_HANG: '1' }];
  for (const env of envs) {
    const { fire, warnings } = load({}, env);
    const started = Date.now();
    assert.equal(await fire('before_prompt_build', { prompt: 'hi', messages: [] }, { ...agentCtx, runId: `run-${started}` }), undefined);
    assert.ok(Date.now() - started < 4000, 'bounded by the mem timeout');
    assert.equal(fire('before_tool_call', { toolName: 'read', params: readParams }, toolCtx), undefined);
    for (let i = 0; i < 100 && warnings.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.match(warnings[0] ?? '', /^ai-memory: mem (log|index) failed/);
  }
  // A handler that receives a malformed payload logs a warning instead of throwing into the hook runner.
  const { fire } = load();
  assert.doesNotThrow(() => fire('after_tool_call', undefined, undefined));
});
