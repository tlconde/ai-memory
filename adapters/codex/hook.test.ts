import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures, runHook, tempDir, type Logged } from '../_shared/harness.ts';

const dir = import.meta.dirname;
const HOOK = join(dir, 'hook.mjs');
// Recorded from a codex exec run on Codex CLI 0.166.0 (paths anonymised).
const p = fixtures(dir);
const run = (payload: unknown, env: Record<string, string> = {}) => runHook(HOOK, { ...(payload as object), cwd: tempDir() }, env);
const base = { session: p.SessionStart!.session_id as string, host: 'codex' } as const;

test('maps each Codex hook payload to LogEvents (a failed command is a tool_result: Codex has no failure event)', () => {
  const cases: [string, Logged[]][] = [
    ['SessionStart', [{ ...base, kind: 'session_start', text: 'startup' }]],
    ['UserPromptSubmit', [{ ...base, kind: 'user', text: p.UserPromptSubmit!.prompt as string }]],
    ['PreToolUse', [{ ...base, kind: 'tool_call', tool: 'Bash', text: '{"command":"cat notes.txt"}' }]],
    ['PostToolUse', [{ ...base, kind: 'tool_result', tool: 'Bash', text: 'alpha beta\ngamma\n' }]],
    ['PostToolUse:fail', [{ ...base, kind: 'tool_result', tool: 'Bash', text: 'ls: /definitely-missing-dir: No such file or directory\n' }]],
    ['Stop', [{ ...base, kind: 'assistant', text: p.Stop!.last_assistant_message as string }]],
    ['SessionEnd', [{ ...base, kind: 'session_end', text: 'other' }]],
  ];
  for (const [name, expected] of cases) {
    const r = run(p[name]);
    assert.equal(r.stderr, '');
    assert.deepEqual(r.logged, expected, name);
  }
});

test('runs mem in the payload cwd, ignoring a CLAUDE_PROJECT_DIR inherited from a parent session', () => {
  const project = tempDir();
  const r = runHook(HOOK, { ...p.SessionEnd, cwd: project }, { CLAUDE_PROJECT_DIR: tempDir() });
  assert.equal(r.calls[0]?.cwd, project);
});

test('SessionStart injects the index as hookSpecificOutput.additionalContext; other events print nothing', () => {
  const r = run(p.SessionStart, { FAKE_MEM_INDEX: '# Index\n' });
  assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '# Index' } });
  assert.equal(run(p.Stop, { FAKE_MEM_INDEX: '# Index' }).stdout, '');
});

test('a failing mem never fails the hook', () => {
  const r = run(p.SessionStart, { FAKE_MEM_FAIL: '1', FAKE_MEM_INDEX: '# I' });
  assert.deepEqual([r.status, r.stdout], [0, '']);
  assert.match(r.stderr, /^ai-memory: /);
});

test('hooks.json registers every mapped event, with SessionEnd inside Codex 3 s cap', () => {
  const hooks = JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd']);
  assert.ok(hooks.SessionEnd[0].hooks[0].timeout <= 3);
});
