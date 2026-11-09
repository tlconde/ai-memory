import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { reindex, search, toMatch } from './search.js';
import { appendEvent, ulid, writeNote } from './store.js';
import type { LogEvent, Note } from './types.js';

const temps: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mem-search-'));
  temps.push(dir);
  return join(dir, '.memory');
}
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function log(root: string, session: string, kind: LogEvent['kind'], text: string, tool?: string): void {
  appendEvent({ ts: '2026-11-09T10:00:00Z', session, host: 'claude-code', kind, text, ...(tool ? { tool } : {}) }, root);
}

function note(root: string, over: Partial<Note>): Note {
  const n: Note = { id: ulid(), about: 'topic', body: '', evidence: [], verified: false, seen: 0, origin: 'session', ...over };
  writeNote(n, root);
  return n;
}

function fixture(): string {
  const root = tempRoot();
  log(root, 'alpha', 'user', 'How do we rotate the deploy credentials?');
  log(root, 'alpha', 'assistant', 'Use the vault CLI to rotate credentials every Monday.');
  log(root, 'alpha', 'tool_call', 'npm run build -- --watch', 'Bash');
  log(root, 'beta', 'user', 'The flaky test in parser.spec fails around midnight.');
  log(root, 'beta', 'assistant', 'It is timezone handling: the runner uses local time.');
  log(root, 'beta', 'tool_result', 'Fixed by pinning TZ=UTC in the test runner config.');
  return root;
}

function first(root: string, query: string): string | undefined {
  return search(query, { root })[0]?.source;
}

describe('search', () => {
  test('known queries return the expected log line first', () => {
    const root = fixture();
    reindex(root);
    assert.equal(first(root, 'timezone'), 'beta:2');
    assert.equal(first(root, 'vault rotate'), 'alpha:2');
    assert.equal(first(root, 'pinning UTC runner'), 'beta:3');
    assert.equal(first(root, 'Bash'), 'alpha:3');
    assert.equal(first(root, 'rotating vaults'), 'alpha:2', 'porter stemming');
    assert.equal(first(root, 'parser.spec'), 'beta:1');
    assert.deepEqual(search('nothing-matches-this', { root }), []);
  });

  test('hits carry a single-line snippet with highlighted terms', () => {
    const root = fixture();
    reindex(root);
    const [hit] = search('midnight', { root });
    assert.equal(hit.layer, 'log');
    assert.match(hit.snippet, /\*\*midnight\*\*/);
    assert.ok(!hit.snippet.includes('\n'));
    assert.ok(hit.score < 0);
  });

  test('verified notes rank above unverified notes, which rank above past findings', () => {
    const root = tempRoot();
    const text = { about: 'kafka', body: 'Kafka retention is seven days on the staging cluster.' };
    const past = note(root, { ...text, origin: 'past' });
    const unverified = note(root, text);
    const verified = note(root, { ...text, verified: true, evidence: ['alpha:1-2'], seen: 1 });
    log(root, 'alpha', 'assistant', `${text.about}\n${text.body}`);
    reindex(root);
    const hits = search('kafka retention', { root });
    assert.deepEqual(hits.map((h) => h.source), [verified.id, unverified.id, 'alpha:1', past.id]);
    assert.deepEqual(hits.map((h) => h.verified), [true, false, undefined, false]);
  });

  test('indexes wiki pages by page name', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'wiki'), { recursive: true });
    writeFileSync(join(root, 'wiki', 'billing-service.md'), '# Billing service\n\nInvoices are generated nightly by cron.\n');
    reindex(root);
    assert.deepEqual(search('invoices nightly', { root }).map((h) => [h.layer, h.source]), [['wiki', 'billing-service']]);
  });

  test('filters by layer and honours the limit', () => {
    const root = fixture();
    note(root, { about: 'runner', body: 'The test runner needs TZ set.' });
    reindex(root);
    assert.deepEqual(new Set(search('runner', { root, layers: ['notes'] }).map((h) => h.layer)), new Set(['notes']));
    assert.equal(search('runner', { root, limit: 1 }).length, 1);
    assert.throws(() => search('runner', { root, limit: 0 }));
  });

  test('user queries never raise FTS5 syntax errors', () => {
    const root = fixture();
    reindex(root);
    for (const q of ['"', '""', 'AND', 'OR NOT', 'NEAR(a b)', '*', 'col:term', '^start', '-x', '"unterminated', "a'b", '(', ')', 'a AND', '{}', '🙂', '   ', 'timezone"', 'x:y:z', '+', 'a* b*']) {
      assert.doesNotThrow(() => search(q, { root }), q);
    }
    assert.equal(toMatch('  ** -- '), undefined);
    assert.equal(toMatch('say "hi" now'), '"say" OR """hi""" OR "now"');
    assert.equal(first(root, 'timezone"'), 'beta:2');
  });

  test('reindex picks up appends, edits, deletions and rewritten logs', () => {
    const root = fixture();
    reindex(root);
    log(root, 'alpha', 'assistant', 'Credentials also live in the zebra vault.');
    reindex(root);
    assert.equal(first(root, 'zebra'), 'alpha:4');
    assert.equal(search('zebra', { root }).length, 1, 'no duplicate rows from re-reading');

    const n = note(root, { about: 'ostrich', body: 'first version' });
    reindex(root);
    assert.equal(first(root, 'ostrich'), n.id);
    writeNote({ ...n, about: 'emu', body: 'second version, longer than the first' }, root);
    reindex(root);
    assert.equal(first(root, 'ostrich'), undefined);
    assert.equal(first(root, 'emu'), n.id);
    unlinkSync(join(root, 'notes', `${n.id}.md`));
    reindex(root);
    assert.equal(first(root, 'emu'), undefined);

    truncateSync(join(root, 'log', 'beta.jsonl'), 0);
    log(root, 'beta', 'user', 'A fresh start.');
    reindex(root);
    assert.equal(first(root, 'timezone'), undefined);
    assert.equal(first(root, 'fresh'), 'beta:1');
  });

  test('a missing root yields no hits and creates nothing', () => {
    const root = join(tempRoot(), 'absent');
    reindex(root);
    assert.deepEqual(search('anything', { root }), []);
    assert.equal(existsSync(root), false);
  });
});
