import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures, runHook, tempDir, type Logged } from '../_shared/harness.ts';

const dir = import.meta.dirname;
const HOOK = join(dir, 'hook.mjs');
// Recorded from a cursor-agent 2026.11.05 -p run (paths anonymised). cursor-agent -p never fires
// beforeSubmitPrompt or afterAgentResponse, so those two are the documented shapes.
const p = fixtures(dir);
const TRANSCRIPT = join(dir, 'fixtures/transcript.json'); // the same run's agent transcript
const SESSION = p.sessionStart!.session_id as string;
const prompt = { ...p.sessionStart, hook_event_name: 'beforeSubmitPrompt', generation_id: 'g1', prompt: 'hello there' };
const response = { ...p.sessionStart, hook_event_name: 'afterAgentResponse', generation_id: 'g1', text: 'Hi.' };

const run = (payload: unknown, project = tempDir(), env: Record<string, string> = {}) => runHook(HOOK, payload, { CURSOR_PROJECT_DIR: project, ...env });
const base = { session: SESSION, host: 'cursor' } as const;

test('maps each Cursor hook payload to LogEvents', () => {
  const cases: [unknown, Logged[]][] = [
    [p.sessionStart, [{ ...base, kind: 'session_start', text: '' }]],
    [prompt, [{ ...base, kind: 'user', text: 'hello there' }]],
    [p.preToolUse, [{ ...base, kind: 'tool_call', tool: 'Shell', text: JSON.stringify((p.preToolUse as { tool_input: unknown }).tool_input) }]],
    [p.postToolUse, [{ ...base, kind: 'tool_result', tool: 'Shell', text: 'alpha beta\ngamma\n' }]],
    [p.postToolUseFailure, [{ ...base, kind: 'error', tool: 'Shell', text: 'ls: /definitely-missing-dir: No such file or directory' }]],
    [response, [{ ...base, kind: 'assistant', text: 'Hi.' }]],
    [{ ...p.preToolUse, hook_event_name: 'afterAgentThought', text: 'thinking' }, []],
  ];
  for (const [payload, expected] of cases) {
    const r = run(payload);
    assert.equal(r.stderr, '');
    assert.deepEqual(r.logged, expected, (payload as { hook_event_name: string }).hook_event_name);
  }
});

test('sessionStart injects the index as additional_context, and nothing else prints', () => {
  assert.deepEqual(JSON.parse(run(p.sessionStart, tempDir(), { FAKE_MEM_INDEX: '# Index\n' }).stdout), { additional_context: '# Index' });
  assert.equal(run(p.postToolUse, tempDir(), { FAKE_MEM_INDEX: '# Index' }).stdout, '');
});

test('sessionEnd recovers prompts and final replies from the transcript when they did not arrive live', () => {
  const end = { ...p.sessionEnd, transcript_path: TRANSCRIPT };
  assert.deepEqual(run(end).logged, [
    { ...base, kind: 'user', text: 'Step by step, one tool per step: 1) shell: cat notes.txt; 2) shell: echo hello; 3) shell: ls /definitely-missing-dir. Then reply in one line that includes the project codename.' },
    { ...base, kind: 'assistant', text: 'Done: ran `cat notes.txt` (alpha beta / gamma), `echo hello`, and `ls /definitely-missing-dir` (missing) for project **lynx-2093**.' },
    { ...base, kind: 'session_end', text: 'completed' },
  ]);
  // In the IDE the prompt arrives live, so the transcript is not read again.
  const project = tempDir();
  run({ ...prompt, session_id: SESSION }, project);
  assert.deepEqual(run(end, project).logged, [{ ...base, kind: 'session_end', text: 'completed' }]);
});

test('the same payload twice (two registrations) is logged once; distinct payloads are not merged', () => {
  const project = tempDir();
  assert.equal(run(p.postToolUse, project).logged.length, 1);
  assert.equal(run(p.postToolUse, project).logged.length, 0);
  assert.equal(run({ ...p.postToolUse, tool_use_id: 'other' }, project).logged.length, 1);
});

test('hooks.json registers flat entries for exactly the mapped events', () => {
  const hooks = JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8'));
  assert.equal(hooks.version, 1);
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ['afterAgentResponse', 'beforeSubmitPrompt', 'postToolUse', 'postToolUseFailure', 'preToolUse', 'sessionEnd', 'sessionStart']);
  for (const entries of Object.values(hooks.hooks) as { command: string }[][]) assert.match(entries[0]!.command, /adapters\/cursor\/hook\.mjs/);
});

test('a failing mem or bad input never fails the hook', () => {
  for (const [payload, env] of [[p.sessionStart, { FAKE_MEM_FAIL: '1', FAKE_MEM_INDEX: '# I' }], ['not json', {}]] as const) {
    const r = run(payload, tempDir(), env);
    assert.deepEqual([r.status, r.stdout], [0, '']);
    assert.match(r.stderr, /^ai-memory: /);
  }
});
