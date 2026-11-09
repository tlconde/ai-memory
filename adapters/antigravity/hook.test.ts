import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures, runHook, tempDir } from '../_shared/harness.ts';

const dir = import.meta.dirname;
const HOOK = join(dir, 'hook.mjs');
// Recorded from agy 1.1.12 -p runs (paths anonymised; PreToolUse comes from a second run, given the first
// run's conversation id). transcript.json is the first run's transcript_full.jsonl.
const p = fixtures(dir);
const TRANSCRIPT = join(dir, 'fixtures/transcript.json');
const at = (payload: unknown, project: string) => ({ ...(payload as object), workspacePaths: [project], transcriptPath: TRANSCRIPT });
const run = (event: string, payload: unknown, project: string, env: Record<string, string> = {}) => runHook(HOOK, at(payload, project), env, [event]);
const base = { session: p.PreInvocation!.conversationId as string, host: 'gemini', refs: ['host:antigravity'] } as const;
const PROMPT = p.PreInvocation!.lastUserInput as string;

test('the first PreInvocation starts the session, logs the prompt and injects the index once', () => {
  const project = tempDir();
  const first = run('PreInvocation', p.PreInvocation, project, { FAKE_MEM_INDEX: '# Index\n' });
  assert.deepEqual(first.logged, [{ ...base, kind: 'session_start', text: '' }, { ...base, kind: 'user', text: PROMPT }]);
  assert.deepEqual(JSON.parse(first.stdout), { injectSteps: [{ ephemeralMessage: '# Index' }] });
  const later = run('PreInvocation', p['PreInvocation:1'], project, { FAKE_MEM_INDEX: '# Index\n' });
  assert.deepEqual([later.logged, later.stdout], [[], '']);
  // A new user turn restarts invocationNum at 0: its prompt is logged, the index is not injected again.
  const next = run('PreInvocation', { ...p.PreInvocation, lastUserInput: 'and now?' }, project, { FAKE_MEM_INDEX: '# Index\n' });
  assert.deepEqual([next.logged, next.stdout], [[{ ...base, kind: 'user', text: 'and now?' }], '']);
});

test('PreToolUse logs the call; PostToolUse logs only an error; Stop recovers output and replies from the transcript once', () => {
  const project = tempDir();
  assert.deepEqual(run('PreToolUse', p.PreToolUse, project).logged, [{ ...base, kind: 'tool_call', tool: 'run_command', text: JSON.stringify((p.PreToolUse as { toolCall: { args: unknown } }).toolCall.args) }]);
  assert.deepEqual(run('PostToolUse', p.PostToolUse, project).logged, []);
  assert.deepEqual(run('PostToolUse', { ...p.PostToolUse, error: 'exit status 1' }, project).logged, [{ ...base, kind: 'error', tool: 'run_command', text: 'exit status 1' }]);
  const stop = run('Stop', p.Stop, project).logged;
  assert.deepEqual(stop.map((e) => [e.kind, e.tool]), [['tool_result', 'run_command'], ['tool_result', 'run_command'], ['error', 'run_command'], ['assistant', undefined]]);
  assert.equal(stop[0]?.text, 'Command exited with code 0.\n\nCommand output:\nalpha beta\r\ngamma\r\n');
  assert.equal(stop[3]?.text, 'The project codename is marten-7705.');
  assert.deepEqual(run('Stop', p.Stop, project).logged, [], 'steps already logged are not logged again');
});

test('a failing mem, a missing transcript or bad input never fails the hook', () => {
  const r = run('PreInvocation', p.PreInvocation, tempDir(), { FAKE_MEM_FAIL: '1', FAKE_MEM_INDEX: '# I' });
  assert.deepEqual([r.status, r.stdout], [0, '']);
  assert.match(r.stderr, /^ai-memory: /);
  const gone = runHook(HOOK, { ...p.Stop, workspacePaths: [tempDir()], transcriptPath: '/nonexistent.jsonl' }, {}, ['Stop']);
  assert.deepEqual([gone.status, gone.logged, gone.stderr], [0, [], '']);
  assert.equal(runHook(HOOK, 'not json', {}, ['Stop']).status, 0);
});

test('hooks.json passes the event name and uses grouped form only for tool events', () => {
  const spec = JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8'))['ai-memory'];
  assert.deepEqual(Object.keys(spec), ['PreInvocation', 'PreToolUse', 'PostToolUse', 'Stop']);
  assert.match(spec.PreInvocation[0].command, / PreInvocation$/);
  assert.match(spec.PreToolUse[0].hooks[0].command, / PreToolUse$/);
  assert.match(spec.Stop[0].command, / Stop$/);
});
