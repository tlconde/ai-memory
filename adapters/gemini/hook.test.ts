import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures, runHook, tempDir, type Logged } from '../_shared/harness.ts';

const dir = import.meta.dirname;
const HOOK = join(dir, 'hook.mjs');
// Recorded from Gemini CLI 0.55.1 hooks (paths anonymised). The model was Gemini's own fake-response
// test mode, because the account's Code Assist tier is no longer served; the hook payloads are real.
const p = fixtures(dir);
const run = (payload: unknown, env: Record<string, string> = {}) => runHook(HOOK, payload, { GEMINI_PROJECT_DIR: tempDir(), ...env });
const base = { session: p.SessionStart!.session_id as string, host: 'gemini' } as const;

test('maps each Gemini hook payload to LogEvents', () => {
  const cases: [string, Logged[]][] = [
    ['SessionStart', [{ ...base, kind: 'session_start', text: 'startup' }]],
    // The recorded prompt carries the injected index as a <hook_context> prefix, which is not the user's text.
    ['BeforeAgent', [{ ...base, kind: 'user', text: 'Step by step: cat notes.txt, echo hello, ls /definitely-missing-dir. Include the project codename.' }]],
    ['BeforeTool', [{ ...base, kind: 'tool_call', tool: 'run_shell_command', text: '{"command":"cat notes.txt"}' }]],
    ['AfterTool', [{ ...base, kind: 'tool_result', tool: 'run_shell_command', text: 'alpha beta\ngamma' }]],
    ['AfterTool:fail', [{ ...base, kind: 'error', tool: 'run_shell_command', text: 'Output: ls: /definitely-missing-dir: No such file or directory\nExit Code: 1' }]],
    ['AfterAgent', [{ ...base, kind: 'assistant', text: p.AfterAgent!.prompt_response as string }]],
    ['SessionEnd', [{ ...base, kind: 'session_end', text: 'exit' }]],
  ];
  for (const [name, expected] of cases) {
    const r = run(p[name]);
    assert.equal(r.stderr, '');
    assert.deepEqual(r.logged, expected, name);
  }
  const failed = { ...p.AfterTool, tool_response: { llmContent: '', returnDisplay: '', error: { message: 'boom' } } };
  assert.equal(run(failed).logged[0]?.kind, 'error');
});

test('SessionStart prints only the JSON injection; other events print nothing', () => {
  const r = run(p.SessionStart, { FAKE_MEM_INDEX: '# Index\n' });
  assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '# Index' } });
  for (const name of Object.keys(p).filter((n) => n !== 'SessionStart')) assert.equal(run(p[name], { FAKE_MEM_INDEX: '# I' }).stdout, '', name);
});

test('runs mem in GEMINI_PROJECT_DIR, else the payload cwd; a failing mem never fails the hook', () => {
  const project = tempDir();
  assert.equal(runHook(HOOK, { ...p.SessionEnd, cwd: project }).calls[0]?.cwd, project);
  const r = run(p.SessionStart, { FAKE_MEM_FAIL: '1', FAKE_MEM_INDEX: '# I' });
  assert.deepEqual([r.status, r.stdout], [0, '']);
  assert.match(r.stderr, /^ai-memory: /);
});

test('settings.json registers every mapped event with a millisecond timeout', () => {
  const hooks = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'AfterAgent', 'SessionEnd']);
  for (const groups of Object.values(hooks) as { hooks: { timeout: number }[] }[][]) assert.ok(groups[0]!.hooks[0]!.timeout >= 1000);
});
