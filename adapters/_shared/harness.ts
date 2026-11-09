// Test helper shared by the adapter tests: runs a hook script against the fake `mem` and returns what it sent.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogEvent } from '../../src/types.ts';

export const FAKE_MEM = join(import.meta.dirname, 'fixtures/fake-mem.mjs');

// realpath because macOS reaches tmpdir() through a /var -> /private/var symlink.
export const tempDir = () => realpathSync(mkdtempSync(join(tmpdir(), 'mem-hook-')));

export const fixtures = (dir: string, name = 'payloads.json'): Record<string, Record<string, unknown>> =>
  JSON.parse(readFileSync(join(dir, 'fixtures', name), 'utf8'));

export interface MemCall { args: string[]; cwd: string; stdin: string }
export type Logged = Omit<LogEvent, 'ts'>;

/** Runs `node <hook> ...args` with `payload` on stdin in a fixed environment (nothing inherited but PATH). */
export function runHook(hook: string, payload: unknown, env: Record<string, string> = {}, args: string[] = []) {
  const out = join(tempDir(), 'calls.jsonl');
  const r = spawnSync(process.execPath, [hook, ...args], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', MEM_BIN: FAKE_MEM, FAKE_MEM_OUT: out, ...env },
  });
  const calls: MemCall[] = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const events = calls.filter((c) => c.args[0] === 'log').flatMap((c) => c.stdin.trim().split('\n').map((l) => JSON.parse(l) as LogEvent));
  for (const e of events) if (Number.isNaN(Date.parse(e.ts))) throw new Error(`bad ts ${e.ts}`);
  const logged: Logged[] = events.map(({ ts: _ts, ...rest }) => rest);
  return { ...r, calls, logged };
}
