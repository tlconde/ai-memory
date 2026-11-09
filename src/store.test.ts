import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  appendEvent,
  inside,
  isSafeId,
  listNotes,
  listSessions,
  memoryRoot,
  readLog,
  readNote,
  scrub,
  ulid,
  writeNote,
} from './store.js';
import { BUDGETS, type LogEvent, type Note } from './types.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const STORE = fileURLToPath(new URL('./store.ts', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

const temps: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mem-store-'));
  temps.push(dir);
  return join(dir, '.memory');
}
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function event(over: Partial<LogEvent> = {}): LogEvent {
  return { ts: '2026-11-09T10:00:00.000Z', session: 's1', host: 'generic', kind: 'user', text: 'hello', ...over };
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function rand(n: number, alphabet = ALNUM): string {
  return Array.from(randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
}

// Built at runtime so no secret-shaped literal is committed. `value` must never reach disk.
function plantedSecrets(): { kind: string; text: string; value: string }[] {
  const s = (kind: string, value: string, text = `found ${value} in output`) => ({ kind, text, value });
  const jwt = `eyJ${rand(20)}.eyJ${rand(30)}.${rand(43)}`;
  const pemBody = rand(64);
  const password = `hunter2-${rand(6)}`;
  return [
    s('openai_key', `sk-proj-${rand(40)}`),
    s('anthropic_key', `sk-ant-api03-${rand(40)}`),
    s('github_token', `ghp_${rand(36)}`),
    s('github_token', `gho_${rand(36)}`),
    s('github_token', `github_pat_${rand(22)}_${rand(59)}`),
    s('slack_token', `xoxb-${rand(12, '0123456789')}-${rand(24)}`),
    s('aws_access_key', `AKIA${rand(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')}`),
    s('google_api_key', `AIza${rand(35)}`),
    s('gitlab_token', `glpat-${rand(20)}`),
    s('stripe_key', `sk_live_${rand(24)}`),
    s('authorization', rand(32), ''),
    s('bearer', rand(24), ''),
    s('private_key', pemBody, `-----BEGIN OPENSSH PRIVATE KEY-----\n${pemBody}\n-----END OPENSSH PRIVATE KEY-----`),
    s('secret_value', password, `export DB_PASSWORD=${password}`),
    s('secret_value', `${password}x`, `{"client_secret": "${password}x"}`),
    s('secret_value', `${password}y`, `api_token: ${password}y`),
    s('jwt', jwt),
    s('url_password', `${password}z`, `git clone https://bob:${password}z@example.com/r.git`),
    // Fixed string: a random one lacks a digit or an uppercase letter about 0.4% of the time.
    s('high_entropy', 'Lil6a8wh3Fk7KSjuDyn0lO1FeUH38spZqT4x'),
  ].map((p) => {
    if (p.kind === 'authorization') return { ...p, text: `curl -H "Authorization: Bearer ${p.value}"` };
    if (p.kind === 'bearer') return { ...p, text: `sent Bearer ${p.value} upstream` };
    return p;
  });
}

describe('memoryRoot and path safety', () => {
  test('defaults to <cwd>/.memory and honours MEM_ROOT', () => {
    const saved = process.env.MEM_ROOT;
    try {
      delete process.env.MEM_ROOT;
      assert.equal(memoryRoot('/tmp/project'), '/tmp/project/.memory');
      process.env.MEM_ROOT = '/tmp/elsewhere/mem';
      assert.equal(memoryRoot('/tmp/project'), '/tmp/elsewhere/mem');
    } finally {
      if (saved === undefined) delete process.env.MEM_ROOT;
      else process.env.MEM_ROOT = saved;
    }
  });

  test('ids are filename-safe', () => {
    for (const ok of ['s1', '01JD5ZK8Q2X7M4N9P3R6S1T0VW', '550e8400-e29b-41d4-a716-446655440000', 'a.b_c-d', 'x'.repeat(128)]) assert.ok(isSafeId(ok), ok);
    for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', '.hidden', '-flag', 'a b', 'x'.repeat(129), 'é']) assert.ok(!isSafeId(bad), bad);
  });

  test('inside refuses paths that escape the root', () => {
    assert.equal(inside('/r', 'log', 'a.jsonl'), '/r/log/a.jsonl');
    assert.throws(() => inside('/r', '..', 'etc'));
    assert.throws(() => inside('/r', '/etc/passwd'));
    assert.throws(() => inside('/r', 'log/../../x'));
  });
});

describe('scrub', () => {
  test('redacts every planted kind and is idempotent', () => {
    for (const p of plantedSecrets()) {
      const out = scrub(p.text);
      assert.ok(!out.includes(p.value), `${p.kind} leaked: ${out}`);
      assert.ok(out.includes(`[REDACTED:${p.kind}]`), `${p.kind} tag missing: ${out}`);
      assert.equal(scrub(out), out);
    }
  });

  test('leaves ordinary text alone', () => {
    for (const text of [
      'commit 3520b87e1f3c9a0b6d2e4f5a6b7c8d9e0f1a2b3c on main',
      'digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      '/Users/dev/Dev/Github/ai-memory-worktrees/log-store/src/store.ts',
      'note 01JD5ZK8Q2X7M4N9P3R6S1T0VW session 550e8400-e29b-41d4-a716-446655440000',
      'getUserAccountSettingsForOrganization2 and ThisIsAVeryLongPascalCaseIdentifierName2',
      '__WEBPACK_IMPORTED_MODULE_0_react_dom_server__',
      'const token = getToken(); if (key == value) return;',
      'PWD=/Users/dev/project',
      'the bearer of bad news asked for the task-abcdefghijklmnopqrstuvwxyz list',
      'https://example.com:8080/path?page=2',
    ]) assert.equal(scrub(text), text);
  });
});

describe('appendEvent', () => {
  test('a planted secret never reaches disk, via appendEvent or mem log', () => {
    const root = tempRoot();
    const planted = plantedSecrets();
    for (const p of planted) appendEvent(event({ session: 'direct', kind: 'tool_result', tool: p.text, text: p.text, refs: [p.text] }), root);
    const stdin = planted.map((p) => JSON.stringify(event({ session: 'piped', text: p.text, refs: [p.text] }))).join('\n');
    const res = spawnSync(process.execPath, ['--import', 'tsx', CLI, 'log', '--root', root], { cwd: REPO, input: stdin, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    for (const session of ['direct', 'piped']) {
      const raw = readFileSync(join(root, 'log', `${session}.jsonl`), 'utf8');
      assert.equal(raw.trimEnd().split('\n').length, planted.length);
      for (const p of planted) assert.ok(!raw.includes(p.value), `${p.kind} reached ${session}.jsonl`);
    }
  });

  test('returns 1-based line numbers and readLog yields the same lines', () => {
    const root = tempRoot();
    assert.deepEqual([1, 2, 3].map((n) => appendEvent(event({ text: `event ${n}` }), root)), [1, 2, 3]);
    assert.deepEqual([...readLog('s1', root)].map((l) => [l.line, l.event.text]), [[1, 'event 1'], [2, 'event 2'], [3, 'event 3']]);
    assert.deepEqual(listSessions(root), ['s1']);
  });

  test('skips but counts a malformed line', () => {
    const root = tempRoot();
    appendEvent(event({ text: 'one' }), root);
    appendFileSync(join(root, 'log', 's1.jsonl'), 'not json\n');
    assert.equal(appendEvent(event({ text: 'three' }), root), 3);
    assert.deepEqual([...readLog('s1', root)].map((l) => l.line), [1, 3]);
  });

  test('truncates oversized text with a marker', () => {
    const root = tempRoot();
    appendEvent(event({ text: 'word '.repeat(5000) }), root);
    const [{ event: stored }] = [...readLog('s1', root)];
    assert.ok(stored.text.length <= BUDGETS.maxEventChars);
    assert.match(stored.text, / \[truncated \d+ chars\]$/);
  });

  test('rejects invalid shapes and writes nothing', () => {
    const root = tempRoot();
    const bad: unknown[] = [
      { ...event(), session: '../escape' },
      { ...event(), host: 'vim' },
      { ...event(), kind: 'thought' },
      { ...event(), ts: 'yesterday' },
      { ...event(), text: 42 },
      { ...event(), refs: ['a', 1] },
      { ...event(), extra: true },
      null,
    ];
    for (const e of bad) assert.throws(() => appendEvent(e as LogEvent, root));
    assert.equal(existsSync(join(root, 'log')), false);
  });

  test('concurrent writers never interleave and line numbers stay exact', async () => {
    const root = tempRoot();
    const writers = 6;
    const each = 40;
    const script = `
      import { appendEvent } from ${JSON.stringify(STORE)};
      const [root, id, n] = process.argv.slice(1);
      for (let i = 0; i < Number(n); i++) {
        const text = 'w' + id + '-' + i + ' ' + 'x'.repeat(500 + i * 37);
        const line = appendEvent({ ts: new Date().toISOString(), session: 'shared', host: 'generic', kind: 'tool_result', text }, root);
        process.stdout.write(line + ' w' + id + '-' + i + '\\n');
      }`;
    const outputs = await Promise.all(
      Array.from({ length: writers }, (_, id) =>
        new Promise<string>((resolveOut, reject) => {
          const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, root, String(id), String(each)], { cwd: REPO });
          let out = '';
          let err = '';
          child.stdout.on('data', (d: Buffer) => (out += d.toString()));
          child.stderr.on('data', (d: Buffer) => (err += d.toString()));
          child.on('error', reject);
          child.on('close', (code) => (code === 0 ? resolveOut(out) : reject(new Error(err))));
        }),
      ),
    );
    const raw = readFileSync(join(root, 'log', 'shared.jsonl'), 'utf8').split('\n').slice(0, -1);
    assert.equal(raw.length, writers * each);
    const texts = raw.map((l) => (JSON.parse(l) as LogEvent).text.split(' ')[0]);
    const reported = outputs.join('').trim().split('\n');
    assert.equal(reported.length, writers * each);
    for (const row of reported) {
      const [line, tag] = row.split(' ');
      assert.equal(texts[Number(line) - 1], tag);
    }
  });
});

describe('notes', () => {
  const note = (over: Partial<Note> = {}): Note => ({
    id: ulid(),
    about: 'deploy "pipeline": stage 2',
    body: 'Line one.\n---\nid: not frontmatter\n\nTrailing blank lines below.\n\n',
    evidence: ['s1:3-5', 'sess.2:10-10'],
    verified: true,
    seen: 2,
    checked: '2026-11-09',
    origin: 'session',
    ...over,
  });

  test('round-trips every field exactly', () => {
    const root = tempRoot();
    const n = note();
    writeNote(n, root);
    assert.deepEqual(readNote(n.id, 'notes', root), n);
    const { checked: _omit, ...minimal } = note({ evidence: [], verified: false, seen: 0, body: '' });
    writeNote(minimal, root);
    assert.deepEqual(readNote(minimal.id, 'notes', root), minimal);
  });

  test('past findings go to past/ and listNotes sorts by id', () => {
    const root = tempRoot();
    const written = [note(), note(), note()];
    for (const n of written) writeNote(n, root);
    const ids = written.map((n) => n.id);
    const past = note({ origin: 'past', evidence: [], verified: false });
    writeNote(past, root);
    assert.deepEqual(listNotes('notes', root).map((n) => n.id), [...ids].sort());
    assert.deepEqual(listNotes('past', root).map((n) => n.id), [past.id]);
    assert.equal(readNote(past.id, 'notes', root), undefined);
    assert.deepEqual(readdirSync(join(root, 'notes')).filter((f) => f.endsWith('.tmp')), []);
  });

  test('rejects bad notes and misplaced files', () => {
    const root = tempRoot();
    assert.throws(() => writeNote(note({ id: '../x' }), root));
    assert.throws(() => writeNote(note({ evidence: ['s1:5-3'] }), root));
    assert.throws(() => writeNote(note({ evidence: ['s1:0-1'] }), root));
    assert.throws(() => writeNote(note({ seen: -1 }), root));
    assert.throws(() => writeNote(note({ about: ' ' }), root));
    const n = note();
    writeNote(n, root);
    const moved = ulid();
    renameSync(join(root, 'notes', `${n.id}.md`), join(root, 'notes', `${moved}.md`));
    assert.throws(() => readNote(moved, 'notes', root), /does not match/);
  });
});

describe('ulid', () => {
  test('is 26 Crockford chars, encodes time and sorts in creation order', () => {
    const ids = Array.from({ length: 1000 }, () => ulid());
    for (const id of ids) assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.deepEqual([...ids].sort(), ids);
    assert.equal(new Set(ids).size, ids.length);
    // A future time advances the clock; earlier ids keep sorting first.
    const at = Date.UTC(2030, 0, 1);
    const future = ulid(at);
    const decoded = [...future.slice(0, 10)].reduce((t, c) => t * 32 + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.indexOf(c), 0);
    assert.equal(decoded, at);
    assert.ok(future > ids[ids.length - 1]);
  });
});
