import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readNote } from './store.js';
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

describe('mem note', () => {
  const seeded = () => {
    const root = tempRoot();
    mem(['log', '--root', root], [line('deploys go through make ship'), line('make ship needs VPN'), line('ok', 's2')].join('\n'));
    return root;
  };
  const noteFiles = (root: string) => (existsSync(join(root, 'notes')) ? readdirSync(join(root, 'notes')) : []);

  test('writes a session note with checked evidence and prints its id', () => {
    const root = seeded();
    const res = mem(['note', '--root', root, '--about', 'deploy', '--evidence', 's1:1-2', '--evidence=s2:1', 'Deploys', 'need', 'the', 'VPN']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, '');
    const id = res.stdout.trim();
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.deepEqual(noteFiles(root), [`${id}.md`]);
    assert.deepEqual(readNote(id, 'notes', root), {
      id, about: 'deploy', body: 'Deploys need the VPN', evidence: ['s1:1-2', 's2:1-1'], verified: false, seen: 1, origin: 'session',
    });
  });

  test('rejects evidence that is malformed or not in the log, writing nothing', () => {
    const root = seeded();
    const cases: Array<[string, RegExp]> = [
      ['s1:3-4', /evidence s1:3-4: log s1 has 2 lines/],
      ['s9:1-1', /evidence s9:1-1: no log for session s9/],
      ['s1:2-1', /must be "<session>:<first>-<last>"/],
      ['s1:0-1', /must be "<session>:<first>-<last>"/],
      ['../x:1-1', /must be "<session>:<first>-<last>"/],
    ];
    for (const [ref, message] of cases) {
      const res = mem(['note', '--root', root, '--about', 'deploy', '--evidence', ref, 'a fact']);
      assert.equal(res.status, 1, ref);
      assert.match(res.stderr, message, ref);
    }
    assert.deepEqual(noteFiles(root), []);
  });

  test('a note without evidence is stored as a hypothesis and says so', () => {
    const root = tempRoot();
    const res = mem(['note', '--root', root, '--about', 'cache', '--json', 'the cache is warm after boot']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /stored as a hypothesis/);
    const out = JSON.parse(res.stdout) as { id: string; merged: boolean; hypothesis: boolean; evidence: string[] };
    assert.deepEqual([out.merged, out.hypothesis, out.evidence], [false, true, []]);
    const note = readNote(out.id, 'notes', root);
    assert.deepEqual([note?.seen, note?.verified, note?.evidence], [0, false, []]);
  });

  test('reads the fact from stdin with -', () => {
    const root = tempRoot();
    const res = mem(['note', '--root', root, '--about', 'release', '-'], 'Releases are cut on Tuesdays.\nNever on Fridays.\n');
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readNote(res.stdout.trim(), 'notes', root)?.body, 'Releases are cut on Tuesdays.\nNever on Fridays.');
    assert.equal(mem(['note', '--root', root, '--about', 'release', '-'], '  \n').status, 2);
  });

  test('the same fact about the same entity merges evidence instead of making a second note', () => {
    const root = seeded();
    const first = mem(['note', '--root', root, '--about', 'deploy', 'Deploys need the VPN.']);
    const id = first.stdout.trim();
    const second = mem(['note', '--root', root, '--about', 'Deploy', '--evidence', 's1:2-2', '  deploys   NEED the vpn ']);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout.trim(), id);
    assert.match(second.stderr, new RegExp(`same fact as ${id}; merged`));
    assert.doesNotMatch(second.stderr, /hypothesis/);
    const third = mem(['note', '--root', root, '--about', 'deploy', '--evidence', 's2:1-1', '--evidence', 's1:2-2', 'Deploys need the VPN']);
    assert.equal(third.stdout.trim(), id);
    assert.deepEqual(noteFiles(root), [`${id}.md`]);
    const note = readNote(id, 'notes', root);
    assert.deepEqual([note?.body, note?.evidence, note?.seen], ['Deploys need the VPN.', ['s1:2-2', 's2:1-1'], 1]);
    // A different entity or a reworded fact is a new note.
    assert.notEqual(mem(['note', '--root', root, '--about', 'ci', 'Deploys need the VPN']).stdout.trim(), id);
    assert.notEqual(mem(['note', '--root', root, '--about', 'deploy', 'Deploys require the VPN']).stdout.trim(), id);
    assert.equal(noteFiles(root).length, 3);
  });

  test('secrets in the fact are scrubbed', () => {
    const root = tempRoot();
    const res = mem(['note', '--root', root, '--about', 'api', 'the key is API_KEY=hunter2hunter2']);
    assert.equal(readNote(res.stdout.trim(), 'notes', root)?.body, 'the key is API_KEY=[REDACTED:secret_value]');
  });

  test('note usage errors exit 2', () => {
    const root = tempRoot();
    assert.equal(mem(['note', '--root', root, 'no about']).status, 2);
    assert.equal(mem(['note', '--root', root, '--about', 'x']).status, 2);
    assert.equal(mem(['note', '--root', root, '--about', 'x', 'a', '-']).status, 2);
    assert.equal(mem(['note', '--root', root, '--about', 'x', '--limit', '3', 'fact']).status, 2);
    assert.equal(mem(['search', 'x', '--about', 'y', '--root', root]).status, 2);
    assert.equal(mem(['mcp', '--evidence', 's1:1-1', '--root', root]).status, 2);
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
    for (const verb of ['note', 'dream']) {
    for (const verb of ['dream', 'eval']) {
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
