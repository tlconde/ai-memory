import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { SearchHit } from './types.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

const temps: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mem-cli-'));
  temps.push(dir);
  return join(dir, '.memory');
}
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function mem(args: string[], input = '', env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const { MEM_ROOT: _drop, ...base } = process.env;
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], { cwd: REPO, input, encoding: 'utf8', env: { ...base, ...env } });
}

const line = (text: string, session = 's1') => JSON.stringify({ ts: '2026-11-09T10:00:00Z', session, host: 'codex', kind: 'assistant', text });

describe('mem log', () => {
  test('appends each stdin line silently', () => {
    const root = tempRoot();
    const res = mem(['log', '--root', root], `${line('first')}\n\n${line('second')}\n`);
    assert.deepEqual([res.status, res.stdout, res.stderr], [0, '', '']);
    const stored = readFileSync(join(root, 'log', 's1.jsonl'), 'utf8').trim().split('\n');
    assert.deepEqual(stored.map((l) => (JSON.parse(l) as { text: string }).text), ['first', 'second']);
  });

  test('rejects a bad batch whole, without echoing input', () => {
    const root = tempRoot();
    const leaked = 'not-json-but-maybe-a-secret';
    let res = mem(['log', '--root', root], `${line('ok')}\n{${leaked}\n`);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /line 2: not valid JSON/);
    assert.ok(!res.stderr.includes(leaked));
    res = mem(['log', '--root', root], `${line('ok')}\n${JSON.stringify({ text: 'missing fields' })}\n`);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /line 2: ts must be/);
    assert.equal(existsSync(join(root, 'log')), false);
  });
});

describe('mem search', () => {
  const seeded = () => {
    const root = tempRoot();
    mem(['log', '--root', root], [line('the cache warms on boot'), line('cache eviction is LRU', 's2'), line('unrelated')].join('\n'));
    return root;
  };

  test('prints one hit per line as "layer source  snippet"', () => {
    const res = mem(['search', 'cache', 'eviction', '--root', seeded()]);
    assert.equal(res.status, 0, res.stderr);
    const rows = res.stdout.trimEnd().split('\n');
    assert.equal(rows.length, 2);
    assert.match(rows[0], /^log s2:1 {2}\*\*cache\*\* \*\*eviction\*\* is LRU$/);
  });

  test('--json and --limit', () => {
    const root = seeded();
    const res = mem(['search', '--json', '--limit=1', '--root', root, 'cache']);
    assert.equal(res.status, 0, res.stderr);
    const hits = JSON.parse(res.stdout) as SearchHit[];
    assert.equal(hits.length, 1);
    assert.equal(hits[0].layer, 'log');
    assert.equal(mem(['search', 'cache', '--limit', 'x', '--root', root]).status, 2);
  });

  test('works on an empty root and honours MEM_ROOT', () => {
    const empty = tempRoot();
    mkdirSync(empty, { recursive: true });
    assert.deepEqual([mem(['search', 'foo', '--root', empty]).status, mem(['search', 'foo', '--root', empty]).stdout], [0, '']);
    const root = seeded();
    assert.match(mem(['search', 'boot'], '', { MEM_ROOT: root }).stdout, /^log s1:1 /);
  });
});

describe('mem index and the rest', () => {
  test('index prints INDEX.md, or nothing when absent', () => {
    const root = tempRoot();
    assert.deepEqual([mem(['index', '--root', root]).status, mem(['index', '--root', root]).stdout], [0, '']);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'INDEX.md'), '# Memory\n\n- a fact\n');
    assert.equal(mem(['index', '--root', root]).stdout, '# Memory\n\n- a fact\n');
  });

  test('unbuilt verbs exit 2 with "not implemented yet"', () => {
    for (const verb of ['note', 'dream', 'eval']) {
      const res = mem([verb]);
      assert.equal(res.status, 2);
      assert.match(res.stderr, /not implemented yet/);
    }
  });

  test('usage errors exit 2', () => {
    assert.equal(mem([]).status, 2);
    assert.equal(mem(['frobnicate']).status, 2);
    assert.equal(mem(['search']).status, 2);
    assert.equal(mem(['log', '--json']).status, 2);
    assert.equal(mem(['index', '--wat']).status, 2);
    assert.equal(mem(['search', 'x', '--root']).status, 2);
    const help = mem(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^usage: mem/);
  });
});
