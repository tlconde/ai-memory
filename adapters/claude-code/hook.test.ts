import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtures, runHook, tempDir, type Logged } from '../_shared/harness.ts';

const dir = import.meta.dirname;
const HOOK = join(dir, 'hook.mjs');
// Real payloads recorded from Claude Code 2.1.319 (paths anonymised); PermissionDenied and
// PreCompact are the documented examples because a default-mode -p run does not fire them.
const payloads = fixtures(dir);
// Recorded from a headless Grok CLI 1.0.77 run that loaded project .claude/settings.json.
const grok = fixtures(dir, 'grok.json');
// Recorded from cursor-agent 2026.10.22, which runs Claude settings hooks with Cursor payloads.
const cursorPayloads = fixtures(join(dir, '../cursor'));
const SESSION = 'ce6108b9-2ef1-49fc-869b-7d8cf8b1d3f3';

// A fixed project dir, so a test run inside Claude Code does not inherit its CLAUDE_PROJECT_DIR.
// It must exist: the recorded payloads' cwd (/work/proj) does not.
const run = (payload: unknown, env: Record<string, string> = {}) => runHook(HOOK, payload, { CLAUDE_PROJECT_DIR: tempDir(), ...env });

function logs(payload: unknown, env: Record<string, string> = {}): Logged[] {
  const r = run(payload, env);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  return r.logged;
}

const base = { session: SESSION, host: 'claude-code' } as const;

test('maps each hook payload to the LogEvents sent to mem log', () => {
  const cases: [string, Logged[]][] = [
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
  for (const [name, expected] of cases) assert.deepEqual(logs(payloads[name]), expected, name);
});

test('runs mem in the project directory, preferring CLAUDE_PROJECT_DIR over the payload cwd', () => {
  const [project, elsewhere] = [tempDir(), tempDir()];
  assert.equal(run({ ...payloads.SessionEnd, cwd: project }, { CLAUDE_PROJECT_DIR: '' }).calls[0]?.cwd, project);
  assert.equal(run({ ...payloads.SessionEnd, cwd: elsewhere }, { CLAUDE_PROJECT_DIR: project }).calls[0]?.cwd, project);
});

test('makes the session id filename-safe and truncates oversized text', () => {
  const [e] = run({ ...payloads['PostToolUse:Bash'], session_id: '../a b/c', tool_response: { stdout: 'x'.repeat(50_000) } }).logged;
  assert.equal(e?.session, 'x.._a_b_c'); // the store wants an alphanumeric first character
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

test('the settings snippet also loads in cursor-agent and Grok: every group has a matcher, every command is one string', () => {
  // cursor-agent drops Claude settings groups without a `matcher` key and ignores `args`.
  const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).hooks;
  for (const [name, groups] of Object.entries(settings) as [string, { matcher?: string; hooks: { command: string; args?: unknown }[] }[]][]) {
    for (const g of groups) {
      assert.equal(typeof g.matcher, 'string', name);
      for (const h of g.hooks) assert.ok(h.args === undefined && h.command.includes('hook.mjs'), name);
    }
  }
});

test('Grok CLI: logs as claude-code with refs host:grok, reads output_for_prompt, maps a non-zero exit to error', () => {
  const env = { GROK_WORKSPACE_ROOT: tempDir(), GROK_HOOK_EVENT: 'x', CLAUDE_PROJECT_DIR: '' };
  const g = { session: grok.SessionStart!.session_id as string, host: 'claude-code', refs: ['host:grok'] };
  const cases: [string, Logged[]][] = [
    ['SessionStart', [{ ...g, kind: 'session_start', text: 'new' }]],
    ['UserPromptSubmit', [{ ...g, kind: 'user', text: grok.UserPromptSubmit!.prompt as string }]],
    ['PreToolUse', [{ ...g, kind: 'tool_call', tool: 'run_terminal_command', text: JSON.stringify(grok.PreToolUse!.tool_input) }]],
    ['PostToolUse', [{ ...g, kind: 'tool_result', tool: 'run_terminal_command', text: 'exit: 0\nalpha beta\ngamma\n' }]],
    ['PostToolUse:fail', [{ ...g, kind: 'error', tool: 'run_terminal_command', text: 'exit: 1\nls: /definitely-missing-dir: No such file or directory\n' }]],
    ['Stop', [{ ...g, kind: 'assistant', text: grok.Stop!.last_assistant_message as string }]],
    ['Stop:shutdown', []],
    ['SessionEnd', [{ ...g, kind: 'session_end', text: 'shutdown' }]],
  ];
  for (const [name, expected] of cases) assert.deepEqual(logs(grok[name], env), expected, name);
  // Without GROK_* env the camelCase fields alone identify Grok.
  assert.deepEqual(logs(grok.SessionEnd, { CLAUDE_PROJECT_DIR: tempDir() })[0]?.refs, ['host:grok']);
});

test('Grok CLI: SessionStart prints nothing, and refreshes .grok/rules/ai-memory-index.md only once it exists', () => {
  const project = tempDir();
  const env = { GROK_WORKSPACE_ROOT: project, GROK_HOOK_EVENT: 'x', FAKE_MEM_INDEX: '# Index\n- new\n' };
  const rule = join(project, '.grok/rules/ai-memory-index.md');
  let r = run(grok.SessionStart, env);
  assert.equal(r.stdout, '');
  assert.ok(!existsSync(rule), 'not created uninvited');
  mkdirSync(join(project, '.grok/rules'), { recursive: true });
  writeFileSync(rule, '# Index\n- old\n');
  r = run(grok.SessionStart, env);
  assert.equal(r.stdout, '');
  assert.equal(readFileSync(rule, 'utf8'), '# Index\n- new\n');
});

test('cursor-agent: a Cursor payload is delegated to the Cursor mapping and logged as host cursor', () => {
  const project = tempDir();
  const r = run(cursorPayloads.postToolUse, { CURSOR_PROJECT_DIR: project });
  assert.deepEqual(r.logged, [{ session: cursorPayloads.postToolUse!.session_id, host: 'cursor', kind: 'tool_result', tool: 'Shell', text: 'alpha beta\ngamma\n' }]);
  assert.equal(r.calls[0]?.cwd, project);
});

test('cursor-agent: the same payload through Claude settings and .cursor/hooks.json is logged once', () => {
  const env = { CURSOR_PROJECT_DIR: tempDir(), FAKE_MEM_INDEX: '# Index' };
  const first = run(cursorPayloads.sessionStart, env);
  const second = runHook(join(dir, '../cursor/hook.mjs'), cursorPayloads.sessionStart, env);
  assert.equal(first.logged.length, 1);
  assert.deepEqual(JSON.parse(first.stdout), { additional_context: '# Index' });
  assert.deepEqual([second.logged, second.stdout, second.stderr], [[], '', '']);
});
