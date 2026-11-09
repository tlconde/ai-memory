import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogEvent } from '../../src/types.ts';

const dir = import.meta.dirname;
const HOOK = join(dir, 'hook.mjs');
// Real payloads recorded from Claude Code 2.1.319 (paths anonymised); PermissionDenied and
// PreCompact are the documented examples because a default-mode -p run does not fire them.
const payloads: Record<string, Record<string, unknown>> = JSON.parse(readFileSync(join(dir, 'fixtures/payloads.json'), 'utf8'));
const SESSION = 'ce6108b9-2ef1-49fc-869b-7d8cf8b1d3f3';

// realpath because macOS reaches tmpdir() through a /var -> /private/var symlink.
const tempDir = () => realpathSync(mkdtempSync(join(tmpdir(), 'mem-hook-')));

interface MemCall { args: string[]; cwd: string; stdin: string }

function run(payload: unknown, env: Record<string, string> = {}) {
  const out = join(tempDir(), 'calls.jsonl');
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    // A fixed environment, so a test run inside Claude Code does not inherit its CLAUDE_PROJECT_DIR.
    // The default project dir must exist: the recorded payloads' cwd (/work/proj) does not.
    env: { PATH: process.env.PATH ?? '', MEM_BIN: join(dir, 'fixtures/fake-mem.mjs'), FAKE_MEM_OUT: out, CLAUDE_PROJECT_DIR: tempDir(), ...env },
  });
  const calls: MemCall[] = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const logged = calls.filter((c) => c.args[0] === 'log').flatMap((c) => c.stdin.trim().split('\n').map((l) => JSON.parse(l) as LogEvent));
  return { ...r, calls, logged };
}

function logs(name: string): Omit<LogEvent, 'ts'>[] {
  const r = run(payloads[name]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  for (const e of r.logged) assert.ok(!Number.isNaN(Date.parse(e.ts)), e.ts);
  return r.logged.map(({ ts: _ts, ...rest }) => rest);
}

const base = { session: SESSION, host: 'claude-code' } as const;

test('maps each hook payload to the LogEvents sent to mem log', () => {
  const cases: [string, Omit<LogEvent, 'ts'>[]][] = [
    ['SessionStart', [{ ...base, kind: 'session_start', text: 'startup' }]],
    ['UserPromptSubmit', [{ ...base, kind: 'user', text: payloads.UserPromptSubmit!.prompt as string }]],
    ['PreToolUse', [{ ...base, kind: 'tool_call', tool: 'Glob', text: '{"pattern":"*.txt"}' }]],
    ['PreToolUse:Read', [{ ...base, kind: 'tool_call', tool: 'Read', text: '{"file_path":"/work/proj/notes.txt"}', refs: ['/work/proj/notes.txt'] }]],
    ['PostToolUse', [{ ...base, kind: 'tool_result', tool: 'Glob', text: 'notes.txt' }]],
    ['PostToolUse:Read', [{ ...base, kind: 'tool_result', tool: 'Read', text: 'text\n/work/proj/notes.txt\nalpha beta\ngamma\n' }]],
    ['PostToolUse:Bash', [{ ...base, kind: 'tool_result', tool: 'Bash', text: 'hello' }]],
    ['PostToolUseFailure', [{ ...base, kind: 'error', tool: 'Bash', text: 'Exit code 1\nls: /definitely-missing-dir: No such file or directory' }]],
    ['PermissionDenied', [{ session: 'abc123', host: 'claude-code', kind: 'error', tool: 'Bash', text: 'permission denied: [Irreversible Local Destruction]' }]],
    ['Stop', [{ ...base, kind: 'assistant', text: payloads.Stop!.last_assistant_message as string }]],
    ['SessionEnd', [{ ...base, kind: 'session_end', text: 'other' }]],
    ['PreCompact', []],
  ];
  for (const [name, expected] of cases) assert.deepEqual(logs(name), expected, name);
});

test('runs mem in the project directory, preferring CLAUDE_PROJECT_DIR over the payload cwd', () => {
  const [project, elsewhere] = [tempDir(), tempDir()];
  assert.equal(run({ ...payloads.SessionEnd, cwd: project }, { CLAUDE_PROJECT_DIR: '' }).calls[0]?.cwd, project);
  assert.equal(run({ ...payloads.SessionEnd, cwd: elsewhere }, { CLAUDE_PROJECT_DIR: project }).calls[0]?.cwd, project);
});

test('makes the session id filename-safe and truncates oversized text', () => {
  const [e] = run({ ...payloads['PostToolUse:Bash'], session_id: '../a b/c', tool_response: { stdout: 'x'.repeat(50_000) } }).logged;
  assert.equal(e?.session, '.._a_b_c');
  assert.equal(e?.text.length, 8000);
});

test('SessionStart injects the index as hookSpecificOutput.additionalContext', () => {
  const r = run(payloads.SessionStart, { FAKE_MEM_INDEX: '# Index\n- fact\n' });
  assert.equal(r.status, 0);
  assert.deepEqual(r.calls.map((c) => c.args), [['log'], ['index']]);
  assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '# Index\n- fact' } });
});

test('prints nothing when the index is empty or the event is not SessionStart', () => {
  assert.equal(run(payloads.SessionStart, { FAKE_MEM_INDEX: '\n' }).stdout, '');
  for (const name of Object.keys(payloads).filter((n) => n !== 'SessionStart')) {
    assert.equal(run(payloads[name], { FAKE_MEM_INDEX: '# Index' }).stdout, '', name);
  }
});

test('a failing, missing or hanging mem, or bad input, never fails the hook', () => {
  const cases: [unknown, Record<string, string>][] = [
    [payloads.SessionStart, { FAKE_MEM_FAIL: '1', FAKE_MEM_INDEX: '# Index' }],
    [payloads.UserPromptSubmit, { MEM_BIN: join(dir, 'fixtures/does-not-exist') }],
    [payloads.SessionStart, { FAKE_MEM_HANG: '1', FAKE_MEM_INDEX: '# Index' }],
    ['not json', {}],
  ];
  for (const [payload, env] of cases) {
    const started = Date.now();
    const r = run(payload, env);
    assert.equal(r.status, 0, JSON.stringify(env));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^ai-memory: /);
    assert.ok(Date.now() - started < 5000, 'mem is killed by its timeout');
  }
});

test('the plugin hooks.json and the settings snippet register the same events, all of them mapped', () => {
  const plugin = JSON.parse(readFileSync(join(dir, 'hooks/hooks.json'), 'utf8')).hooks;
  const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(plugin), Object.keys(settings));
  for (const name of Object.keys(plugin)) {
    const payload = payloads[name] ?? { session_id: 's', hook_event_name: name };
    assert.ok(run(payload).logged.length > 0, `${name} is registered but logs nothing`);
  }
});
