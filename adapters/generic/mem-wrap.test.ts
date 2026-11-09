import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEvent } from '../../src/types.ts';
import { FAKE_MEM, tempDir } from '../_shared/harness.ts';

const WRAP = join(import.meta.dirname, 'mem-wrap');

function wrap(args: string[], env: Record<string, string> = {}) {
  const [cwd, out] = [tempDir(), join(tempDir(), 'calls.jsonl')];
  const r = spawnSync(WRAP, args, { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', MEM_BIN: FAKE_MEM, FAKE_MEM_OUT: out, ...env } });
  const calls = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const logged: LogEvent[] = calls.filter((c) => c.args[0] === 'log').map((c) => JSON.parse(c.stdin));
  return { ...r, cwd, logged };
}

test('logs start, the command line, stdout, stderr and the exit status, and returns that status', () => {
  const r = wrap(['sh', '-c', 'echo out-line; echo err-line >&2; exit 3']);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, 'out-line\n');
  assert.equal(r.stderr, 'err-line\n');
  assert.deepEqual(r.logged.map((e) => [e.kind, e.text]), [
    ['session_start', `${r.cwd}\n`],
    ['user', 'sh -c echo out-line; echo err-line >&2; exit 3'],
    ['assistant', 'out-line\n'],
    ['error', 'err-line\n'],
    ['session_end', 'exit 3'],
  ]);
  const [first] = r.logged;
  assert.ok(first && first.host === 'generic' && /^generic-\d{8}T\d{6}Z-\d+$/.test(first.session));
  assert.ok(r.logged.every((e) => e.session === first.session && !Number.isNaN(Date.parse(e.ts))));
});

test('--index prints INDEX.md; a failing mem changes neither output nor status', () => {
  assert.equal(wrap(['--index'], { FAKE_MEM_INDEX: '# Index\n' }).stdout, '# Index\n');
  const r = wrap(['sh', '-c', 'echo ok'], { FAKE_MEM_FAIL: '1' });
  assert.deepEqual([r.status, r.stdout], [0, 'ok\n']);
  assert.match(r.stderr, /ai-memory: mem log failed/);
});
