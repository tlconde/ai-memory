import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { estimateTokens, parseCases, reindex, runEval, search } from './search.js';
import { appendEvent, writeNote } from './store.js';
import type { LogEvent, Note } from './types.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const DEFAULT_SUITE = join(REPO, 'eval', 'suites', 'default');

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mem-eval-test-'));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function log(root: string, text: string, kind: LogEvent['kind'] = 'assistant'): void {
  appendEvent({ ts: '2026-11-09T10:00:00Z', session: 's1', host: 'claude-code', kind, text }, root);
}

function note(root: string, over: Partial<Note> & Pick<Note, 'id'>): void {
  writeNote({ about: 'topic', body: '', evidence: [], verified: false, seen: 0, origin: 'session', ...over }, root);
}

// Every number below is worked out by hand from this suite.
//   s1:1 "xray marker"                   only doc with xray        -> rank 1
//   s1:2 "zulu zulu zulu"                strongest zulu match
//   s1:3 "zulu plus many diluting words" second zulu match         -> rank 2
// queries: xray@5 hit rr 1; zulu@2 hit rr 1/2; zulu@1 miss; unmatched@5 miss
//   => hit rate 2/4 = 0.5, MRR (1 + 0.5 + 0 + 0) / 4 = 0.375
// facts: one in a note, one in a wiki page, one only in the log => 2/3 survive
// INDEX.md is 10 chars => ceil(10 / 4) = 3 tokens
function syntheticSuite(): string {
  const suite = tempDir();
  log(suite, 'xray marker');
  log(suite, 'zulu zulu zulu');
  log(suite, 'zulu plus many other diluting words that lower its score');
  note(suite, { id: '01M6ZW0680C5HDXA2AWDJC5HEP', about: 'billing', body: 'Invoices round HALF-EVEN.', verified: true, evidence: ['s1:1-1'], seen: 1 });
  mkdirSync(join(suite, 'wiki'));
  writeFileSync(join(suite, 'wiki', 'deploy.md'), '# deploy\n\nDeploys run from the release branch.\n');
  writeFileSync(join(suite, 'INDEX.md'), '0123456789');
  writeFileSync(
    join(suite, 'cases.json'),
    JSON.stringify({
      queries: [
        { q: 'xray', expect: ['s1:1'] },
        { q: 'zulu', expect: ['s1:3'], k: 2 },
        { q: 'zulu', expect: ['s1:3'], k: 1 },
        { q: 'unmatched', expect: ['s1:1'] },
      ],
      facts: [
        { fact: 'invoices round half-even', terms: ['invoices', 'half-even'] },
        { fact: 'deploys use the release branch', terms: ['Release Branch'] },
        { fact: 'zulu appears', terms: ['zulu'] },
      ],
    }),
  );
  return suite;
}

describe('runEval', () => {
  test('computes hit rate, MRR, index tokens and fact survival on a known suite', () => {
    const suite = syntheticSuite();
    const r = runEval(suite);
    assert.equal(r.ranking, 'weighted');
    assert.equal(r.sessions, 1);
    assert.deepEqual(r.retrieval, { queries: 4, hits: 2, hitRate: 0.5, mrr: 0.375 });
    assert.deepEqual(r.index, { tokens: 3, estimate: 'ceil(chars/4)', budget: 1500 });
    assert.deepEqual(r.facts, { total: 3, survived: 2, rate: 2 / 3 });
    assert.deepEqual(r.misses.map((m) => [m.q, m.got]), [['zulu', ['s1:2']], ['unmatched', []]]);
  });

  test('never writes to the suite directory', () => {
    const suite = syntheticSuite();
    const before = readdirSync(suite, { recursive: true }).sort();
    runEval(suite);
    runEval(suite, { ranking: 'tiers' });
    assert.deepEqual(readdirSync(suite, { recursive: true }).sort(), before);
  });

  test('reports n/a (null) for empty query and fact sets, and 0 tokens without INDEX.md', () => {
    const suite = tempDir();
    writeFileSync(join(suite, 'cases.json'), '{"queries": []}');
    const r = runEval(suite);
    assert.deepEqual([r.retrieval.hitRate, r.retrieval.mrr, r.facts.rate, r.index.tokens, r.sessions], [null, null, null, 0, 0]);
  });

  test('rejects a suite without cases.json and malformed cases', () => {
    assert.throws(() => runEval(tempDir()), /no cases\.json/);
    assert.throws(() => parseCases({ queries: [{ q: 'x', expect: [] }] }), /expect must be a non-empty array/);
    assert.throws(() => parseCases({ queries: [{ q: '', expect: ['a'] }] }), /q must be a non-empty string/);
    assert.throws(() => parseCases({ queries: [{ q: 'x', expect: ['a'], k: 0 }] }), /k must be an integer/);
    assert.throws(() => parseCases({ queries: [], facts: [{ fact: 'f', terms: [] }] }), /terms must be a non-empty array/);
    assert.deepEqual(parseCases({ queries: [{ q: 'x', expect: ['a'] }] }), { queries: [{ q: 'x', expect: ['a'], k: 5 }], facts: [] });
  });

  test('estimates tokens as ceil(chars / 4)', () => {
    assert.deepEqual([estimateTokens(''), estimateTokens('abc'), estimateTokens('abcd'), estimateTokens('abcde')], [0, 1, 1, 2]);
  });
});

describe('search ranking', () => {
  // A log line that matches far better than an unverified note and a past finding.
  function ranked(): string {
    const root = join(tempDir(), '.memory');
    log(root, 'quokka quokka quokka quokka');
    note(root, { id: '01M6ZW07786JWRWTBVMRGDVDA7', body: 'a long unverified note that mentions quokka once among many other words' });
    note(root, { id: '01M6ZW086G4QF144BFXVFCJ24K', body: 'a past finding about quokka', origin: 'past' });
    note(root, { id: '01M6ZW0680C5HDXA2AWDJC5HEP', body: 'a verified note that mentions quokka once among a great many other words here', verified: true, evidence: ['s1:1-1'], seen: 1 });
    mkdirSync(join(root, 'wiki'));
    writeFileSync(join(root, 'wiki', 'animals.md'), 'an animals page that mentions quokka once among many many other words');
    reindex(root);
    return root;
  }

  test('weighted (the default) lets a strong log match beat weaker notes', () => {
    const root = ranked();
    assert.equal(search('quokka', { root })[0]?.source, 's1:1');
    assert.deepEqual(search('quokka', { root }), search('quokka', { root, ranking: 'weighted' }));
  });

  test('tiers orders verified notes, wiki, unverified notes, log, past regardless of bm25', () => {
    const root = ranked();
    assert.deepEqual(
      search('quokka', { root, ranking: 'tiers' }).map((h) => h.source),
      ['01M6ZW0680C5HDXA2AWDJC5HEP', 'animals', '01M6ZW07786JWRWTBVMRGDVDA7', 's1:1', '01M6ZW086G4QF144BFXVFCJ24K'],
    );
  });

  test('rejects an unknown ranking', () => {
    assert.throws(() => search('x', { root: ranked(), ranking: 'random' as never }), /unknown ranking/);
  });
});

function mem(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const { MEM_ROOT: _drop, ...env } = process.env;
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], { cwd: REPO, encoding: 'utf8', env });
}

describe('mem eval', () => {
  test('--json prints the report numbers', () => {
    const suite = syntheticSuite();
    const res = mem(['eval', '--suite', suite, '--json']);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout) as Record<string, unknown>;
    assert.deepEqual(Object.keys(out).sort(), ['facts', 'index', 'misses', 'ranking', 'retrieval', 'sessions', 'suite']);
    assert.equal(out.suite, suite);
    assert.deepEqual(out.retrieval, { queries: 4, hits: 2, hitRate: 0.5, mrr: 0.375 });
    assert.deepEqual(out.index, { tokens: 3, estimate: 'ceil(chars/4)', budget: 1500 });
    assert.deepEqual(out.facts, { total: 3, survived: 2, rate: 2 / 3 });
    assert.equal((JSON.parse(mem(['eval', '--suite', suite, '--json', '--ranking', 'tiers']).stdout) as { ranking: string }).ranking, 'tiers');
  });

  test('human output is a short table that labels the token count an estimate', () => {
    const res = mem(['eval', '--suite', syntheticSuite()]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^hit rate +50\.0% +2\/4/m);
    assert.match(res.stdout, /^MRR +0\.375$/m);
    assert.match(res.stdout, /^index +3 tokens \(estimate/m);
    assert.match(res.stdout, /^facts +66\.7% +2\/3/m);
  });

  test('--min-hit-rate gates the exit code', () => {
    const suite = syntheticSuite();
    assert.equal(mem(['eval', '--suite', suite, '--min-hit-rate', '0.5']).status, 0);
    const low = mem(['eval', '--suite', suite, '--min-hit-rate', '0.6', '--json']);
    assert.equal(low.status, 1);
    assert.match(low.stderr, /below --min-hit-rate 0\.6/);
    assert.equal(JSON.parse(low.stdout).retrieval.hitRate, 0.5, 'the report is still printed');
  });

  test('usage errors exit 2', () => {
    const suite = syntheticSuite();
    for (const bad of [['--min-hit-rate', '1.5'], ['--min-hit-rate', 'x'], ['--ranking', 'random'], ['extra']]) {
      assert.equal(mem(['eval', '--suite', suite, ...bad]).status, 2, bad.join(' '));
    }
    assert.equal(mem(['search', 'x', '--ranking', 'tiers']).status, 2);
    assert.equal(mem(['eval', '--suite', join(suite, 'missing')]).status, 1);
  });

  test('the bundled default suite runs and is anonymised', () => {
    const res = mem(['eval', '--json']);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout) as { sessions: number; retrieval: { queries: number } };
    assert.equal(out.sessions, 4);
    assert.ok(out.retrieval.queries >= 12 && out.retrieval.queries <= 20);
    for (const file of readdirSync(DEFAULT_SUITE, { recursive: true, encoding: 'utf8' })) {
      const path = join(DEFAULT_SUITE, file);
      if (!existsSync(path) || !/\.(jsonl|md|json)$/.test(file)) continue;
      assert.doesNotMatch(readFileSync(path, 'utf8'), /\/Users\/|\/home\/(?!user\b)|claude-\d+|scratchpad|REDACTED/, file);
    }
  });
});
