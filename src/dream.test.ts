import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildIndex,
  dream,
  estimateTokens,
  formatNote,
  judge,
  keyTerms,
  lint,
  relink,
  unifiedDiff,
  WIKI_MARK,
  type DreamOptions,
} from './dream.js';
import { appendEvent, readNote, ulid, writeNote } from './store.js';
import { BUDGETS, type LogEvent, type Note } from './types.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const NOW = new Date('2026-11-09T12:00:00Z');

const temps: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mem-dream-'));
  temps.push(dir);
  const root = join(dir, '.memory');
  mkdirSync(root, { recursive: true });
  return root;
}
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function log(root: string, session: string, texts: string[], over: Partial<LogEvent> = {}): number[] {
  return texts.map((text) => appendEvent({ ts: '2026-11-09T10:00:00Z', session, host: 'generic', kind: 'assistant', text, ...over }, root));
}

function note(root: string, over: Partial<Note>): Note {
  const n: Note = { id: ulid(), about: 'cache', body: 'The cache uses LRU eviction policy', evidence: [], verified: false, seen: 0, origin: 'session', ...over };
  writeNote(n, root);
  return n;
}

function run(root: string, over: Partial<DreamOptions> = {}) {
  return dream({ root, now: NOW, steering: 'Steering line one.\nSteering line two.', ...over });
}

/** Every file under the root, search index excluded, as path -> content. */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) walk(full);
      else if (!f.startsWith('.search')) out.set(relative(root, full), readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return out;
}

const index = (root: string) => readFileSync(join(root, 'INDEX.md'), 'utf8');

function mem(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const { MEM_ROOT: _drop, ...env } = process.env;
  return spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], { cwd: REPO, encoding: 'utf8', env });
}

// Unverified filler notes give the wiki budget room: wiki bytes may be at most half of all note bytes.
function filler(root: string, n: number): void {
  for (let i = 0; i < n; i++) note(root, { about: `filler${i}`, body: `Placeholder hypothesis number ${i} about the staging environment variables.` });
}

describe('the verification heuristic', () => {
  const n = (body: string, evidence = ['s1:1-1'], about = 'cache') => ({ about, body, evidence });

  test('key terms drop stop words and short runs, split identifiers and strip plurals', () => {
    assert.deepEqual([...keyTerms('The node:sqlite caches are NOT in v2 entries')].sort(), ['cache', 'entry', 'node', 'sqlite', 'v2']);
  });

  test('cited lines sharing at least half the key terms verify the note', () => {
    const v = judge(n('The cache evicts entries with an LRU policy'), ['cache eviction uses the LRU policy for entries'], []);
    assert.equal(v.decision, 'verified');
    assert.match(v.reason, /4\/5 key terms/);
  });

  test('cited lines about something else refute it', () => {
    assert.equal(judge(n('The cache evicts entries with an LRU policy'), ['the build runs on node 22'], []).decision, 'unverified');
  });

  test('partial overlap or a negation mismatch is undecided', () => {
    assert.equal(judge(n('alpha beta gamma delta', ['s1:1-1'], 'alpha'), ['alpha only here'], []).decision, 'undecided');
    const flipped = judge(n('The cache is not LRU'), ['The cache is LRU.'], []);
    assert.equal(flipped.decision, 'undecided');
    assert.match(flipped.reason, /negation/);
    assert.equal(judge(n('The cache is not LRU'), ['Checked: the cache is not LRU.'], []).decision, 'verified');
  });

  test('no evidence is a hypothesis; missing evidence or self-citation is unverified', () => {
    assert.match(judge(n('x y z', []), [], []).reason, /hypothesis/);
    assert.match(judge(n('cache LRU'), [], ['gone:1-2']).reason, /evidence gone: gone:1-2/);
    assert.match(judge(n('cache LRU'), [], [], true).reason, /memory tool traffic/);
  });
});

describe('mem dream', () => {
  test('verifies notes against the lines they cite and unverifies them when evidence goes', () => {
    const root = tempRoot();
    log(root, 's1', ['We switched the cache to an LRU eviction policy', 'all tests pass']);
    const good = note(root, { evidence: ['s1:1-1'] });
    const wrong = note(root, { about: 'deploy', body: 'Deploys target Fly.io regions', evidence: ['s1:2-2'], verified: true });
    const ghost = note(root, { evidence: ['ghost:1-1'], verified: true });
    const self = note(root, { about: 'search', body: 'Search ranks verified notes first', evidence: ['s2:1-1'] });
    log(root, 's2', ['Search ranks verified notes first'], { kind: 'tool_result', tool: 'mcp__ai-memory__search' });

    const r = run(root);
    const got = (n: Note) => readNote(n.id, 'notes', root);
    assert.deepEqual([got(good)?.verified, got(good)?.checked, got(good)?.seen], [true, '2026-11-09', 1]);
    assert.equal(got(wrong)?.verified, false);
    assert.equal(got(ghost)?.verified, false);
    assert.equal(got(self)?.verified, false);
    assert.match(r.checks.find((c) => c.id === self.id)?.reason ?? '', /memory tool traffic/);

    rmSync(join(root, 'log', 's1.jsonl'));
    const again = run(root, { now: new Date('2026-11-10T00:00:00Z') });
    assert.equal(got(good)?.verified, false);
    assert.match(again.checks.find((c) => c.id === good.id)?.reason ?? '', /evidence gone/);
  });

  test('counts each confirming session once and promotes at the threshold, verbatim with evidence', () => {
    const root = tempRoot();
    filler(root, 6);
    log(root, 's1', ['We switched the cache to an LRU eviction policy']);
    const n = note(root, { evidence: ['s1:1-1'] });
    log(root, 's2', ['The cache uses LRU eviction policy'], { kind: 'tool_result', tool: 'mcp__ai-memory__search' });
    log(root, 's2b', ['ran: mem search cache LRU eviction policy'], { kind: 'tool_call', tool: 'Bash' });
    run(root);
    assert.equal(readNote(n.id, 'notes', root)?.seen, 1, 'memory tool traffic confirms nothing');

    log(root, 's3', ['confirmed the cache LRU eviction policy under load']);
    log(root, 's1', ['cache LRU eviction policy still holds']); // same session again: no extra count
    run(root);
    assert.equal(readNote(n.id, 'notes', root)?.seen, 2);
    assert.equal(existsSync(join(root, 'wiki', 'cache.md')), false);

    log(root, 's4', ['the LRU eviction policy in the cache is fine']);
    const r = run(root);
    assert.equal(readNote(n.id, 'notes', root)?.seen, BUDGETS.promoteAfterSessions);
    const page = readFileSync(join(root, 'wiki', 'cache.md'), 'utf8');
    assert.ok(page.startsWith(WIKI_MARK));
    assert.match(page, /^# cache$/m);
    assert.match(page, /^> The cache uses LRU eviction policy$/m);
    assert.match(page, new RegExp(`Note \`${n.id}\`, confirmed in 3 sessions\\. Evidence: s1:1-1\\.`));
    assert.ok(r.changes.some((c) => c.op === 'create' && c.path === 'wiki/cache.md'));
    assert.match(index(root), /- \[cache\]\(wiki\/cache\.md\): 1 fact/);
  });

  test('holds a page back when the wiki would exceed half the notes', () => {
    const root = tempRoot();
    for (const s of ['s1', 's2', 's3']) log(root, s, ['The cache uses LRU eviction policy']);
    note(root, { evidence: ['s1:1-1'] });
    const r = run(root);
    assert.deepEqual(r.overBudget, ['cache']);
    assert.equal(existsSync(join(root, 'wiki', 'cache.md')), false);
    assert.equal(lint(root).ok, true);
  });

  test('confirms a past finding only with new transcript evidence and expires the rest', () => {
    const root = tempRoot();
    const confirmed = note(root, { about: 'api', body: 'The API rate limit is 100 requests per minute', origin: 'past' });
    const stale = note(root, { about: 'build', body: 'Legacy builds use the webpack bundler', origin: 'past' });
    log(root, 's1', ['refactored the parser']);
    run(root);
    assert.ok(readNote(confirmed.id, 'past', root));
    assert.ok(!index(root).includes('webpack') && !index(root).includes(stale.id) && !index(root).includes('rate limit'));

    log(root, 's2', ['Hit the API rate limit: 100 requests per minute, backing off']);
    const r = run(root);
    assert.deepEqual(r.promotedPast, [confirmed.id]);
    assert.equal(readNote(confirmed.id, 'past', root), undefined);
    const promoted = readNote(confirmed.id, 'notes', root);
    assert.deepEqual([promoted?.origin, promoted?.verified, promoted?.evidence], ['session', true, ['s2:1-1']]);
    assert.match(index(root), /rate limit/);

    // `stale` was first seen at session count 1; it expires once 20 more sessions pass without confirming it.
    for (let i = 3; i <= 20; i++) log(root, `s${i}`, ['nothing relevant happened']);
    run(root);
    assert.ok(readNote(stale.id, 'past', root), 'age 19 keeps it');
    log(root, 's21', ['nothing relevant happened']);
    const last = run(root);
    assert.deepEqual(last.expiredPast, [stale.id]);
    assert.ok(last.changes.some((c) => c.op === 'delete' && c.path === `past/${stale.id}.md`));
    assert.equal(existsSync(join(root, 'past', `${stale.id}.md`)), false);
  });

  test('prunes old unverified notes from the index without deleting them', () => {
    const root = tempRoot();
    log(root, 's1', ['start']);
    const h = note(root, { about: 'flaky', body: 'The e2e suite flakes on Mondays' });
    run(root);
    assert.match(index(root), new RegExp(`- \\(hypothesis\\) \\*\\*flaky\\*\\*: The e2e suite flakes on Mondays \\(\`${h.id}\`\\)`));
    for (let i = 2; i <= 1 + BUDGETS.pruneUnverifiedAfterSessions; i++) log(root, `s${i}`, ['unrelated work']);
    const r = run(root);
    assert.deepEqual(r.pruned, [h.id]);
    assert.ok(!index(root).includes(h.id));
    assert.ok(readNote(h.id, 'notes', root));
  });

  test('keeps INDEX.md within its token budget by priority', () => {
    const root = tempRoot();
    log(root, 's1', ['verified fact source line about widgets gadgets sprockets']);
    for (let i = 0; i < 80; i++) note(root, { about: `widget${i}`, body: `Widgets gadgets sprockets fact ${i} ${'padding words '.repeat(12)}`, evidence: ['s1:1-1'] });
    note(root, { about: 'guess', body: 'An unchecked guess' });
    const r = run(root);
    const text = index(root);
    assert.ok(estimateTokens(text) <= BUDGETS.indexTokens, `${estimateTokens(text)} tokens`);
    assert.ok(r.indexOmitted > 0);
    assert.match(text, /left out to fit the budget; use `mem search`/);
    assert.ok(!text.includes('An unchecked guess'), 'hypotheses go first');
    assert.equal(lint(root).ok, true);
  });

  test('a dry run prints the changeset and writes nothing', () => {
    const root = tempRoot();
    log(root, 's1', ['We switched the cache to an LRU eviction policy']);
    note(root, { evidence: ['s1:1-1'] });
    note(root, { about: 'old', body: 'An old finding about grunt tasks', origin: 'past' });
    const before = snapshot(root);
    const r = run(root, { dryRun: true });
    assert.ok(r.changes.length >= 2);
    assert.deepEqual(snapshot(root), before);
    const cli = mem(['dream', '--dry-run', '--root', root]);
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /^# create INDEX\.md/m);
    assert.match(cli.stdout, /^\+\+\+ b\/INDEX\.md$/m);
    assert.match(cli.stdout, /^-verified: false$/m);
    assert.match(cli.stdout, /dry run, nothing written/);
    const json = JSON.parse(mem(['dream', '--dry-run', '--json', '--root', root]).stdout) as { changes: { path: string; diff: string }[] };
    assert.ok(json.changes.some((c) => c.path === 'INDEX.md' && c.diff.includes('+# Memory index')));
    assert.deepEqual(snapshot(root), before);
  });

  test('is idempotent: a second run with no new logs changes nothing, even on a later day', () => {
    const root = tempRoot();
    filler(root, 6);
    for (const s of ['s1', 's2', 's3']) log(root, s, ['The cache uses an LRU eviction policy', 'unrelated chatter']);
    note(root, { evidence: ['s1:1-1'] });
    note(root, { about: 'cache', body: 'The cache is not LRU', evidence: ['s1:1-1'] }); // undecided
    note(root, { about: 'api', body: 'An unconfirmed API detail from long ago', origin: 'past' });
    mkdirSync(join(root, 'wiki'));
    writeFileSync(join(root, 'wiki', 'manual.md'), '# Manual\n\nSee [cache](cache.md) and [gone](gone.md) and [[Nowhere]] and [web](https://example.com/x.md).\n');
    writeFileSync(join(root, 'wiki', 'stale.md'), `${WIKI_MARK}\n# stale\n`);
    const first = run(root);
    assert.ok(first.changes.length > 0);
    assert.ok(existsSync(join(root, 'wiki', 'cache.md')));
    assert.equal(readFileSync(join(root, 'wiki', 'manual.md'), 'utf8'), '# Manual\n\nSee [cache](cache.md) and gone and Nowhere and [web](https://example.com/x.md).\n');
    assert.equal(existsSync(join(root, 'wiki', 'stale.md')), false, 'a dream page no note supports is removed');
    const after = snapshot(root);
    const second = run(root, { now: new Date('2026-12-01T00:00:00Z') });
    assert.deepEqual(second.changes, []);
    assert.deepEqual(snapshot(root), after);
    assert.equal(lint(root).ok, true);

    log(root, 's1', ['one more unrelated line']);
    const third = run(root);
    assert.equal(third.sessions.newLines, 1, 'only the new segment is read');
  });

  test('--model-cmd decides only undecided notes, once, and is off by default', () => {
    const root = tempRoot();
    const dir = join(root, '..');
    const calls = join(dir, 'calls.txt');
    const script = join(dir, 'fake-model.mjs');
    writeFileSync(
      script,
      `import { appendFileSync } from 'node:fs';
let input = '';
for await (const c of process.stdin) input += c;
appendFileSync(${JSON.stringify(calls)}, input.includes('Cited lines:') ? 'call\\n' : 'bad\\n');
process.stdout.write('thinking...\\n{"verified": true, "reason": "the lines state it"}\\n');
`,
    );
    log(root, 's1', ['The cache is LRU.', 'The cache uses an LRU eviction policy']);
    const undecided = note(root, { body: 'The cache is not LRU', evidence: ['s1:1-1'] });
    const decided = note(root, { evidence: ['s1:2-2'] });

    const off = run(root, { dryRun: true });
    assert.equal(off.modelCalls, 0);
    assert.equal(off.checks.find((c) => c.id === undecided.id)?.verified, false);

    const cmd = `"${process.execPath}" "${script}"`;
    const r = run(root, { modelCmd: cmd });
    assert.equal(r.modelCalls, 1);
    assert.equal(readFileSync(calls, 'utf8'), 'call\n');
    assert.deepEqual([readNote(undecided.id, 'notes', root)?.verified, r.checks.find((c) => c.id === undecided.id)?.reason], [true, 'model: the lines state it']);
    assert.equal(readNote(decided.id, 'notes', root)?.verified, true);
    assert.equal(run(root, { modelCmd: cmd }).modelCalls, 0, 'nothing new, nothing asked');

    const broken = tempRoot();
    log(broken, 's1', ['The cache is LRU.']);
    const u = note(broken, { body: 'The cache is not LRU', evidence: ['s1:1-1'] });
    const bad = run(broken, { modelCmd: `"${process.execPath}" -e "process.stdout.write('no json')"` });
    assert.match(bad.modelErrors.join(), /no JSON verdict/);
    assert.equal(readNote(u.id, 'notes', broken)?.verified, false);
  });

  test('refuses a corrupt cursor file instead of silently rescanning', () => {
    const root = tempRoot();
    writeFileSync(join(root, '.dream.json'), '{"version":2}');
    assert.throws(() => run(root), /unknown format; delete it/);
  });
});

describe('mem lint', () => {
  test('passes an empty or missing root', () => {
    assert.equal(lint(join(tempRoot(), 'nope')).ok, true);
    const res = mem(['lint', '--root', tempRoot()]);
    assert.deepEqual([res.status, /ok$/m.test(res.stdout)], [0, true]);
  });

  test('fails an oversized INDEX.md and an oversized wiki', () => {
    const root = tempRoot();
    note(root, { about: 'x', body: 'short' });
    writeFileSync(join(root, 'INDEX.md'), 'x'.repeat(BUDGETS.indexTokens * 4 + 1));
    mkdirSync(join(root, 'wiki'));
    writeFileSync(join(root, 'wiki', 'big.md'), 'y'.repeat(5000));
    const r = lint(root);
    assert.equal(r.ok, false);
    assert.match(r.failures.join('\n'), /INDEX\.md is 1501 tokens, over the budget of 1500/);
    assert.match(r.failures.join('\n'), /wiki is 5000 bytes, over 0\.5 x \d+ bytes of notes/);
    const res = mem(['lint', '--root', root]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /^FAIL INDEX\.md is 1501 tokens/m);
    assert.equal((JSON.parse(mem(['lint', '--json', '--root', root]).stdout) as { ok: boolean }).ok, false);
  });

  test('fails a past finding in the index and an unlabelled unverified note', () => {
    const root = tempRoot();
    const p = note(root, { about: 'old', body: 'A past finding that must stay out of the index', origin: 'past' });
    const u = note(root, { about: 'guess', body: 'unchecked' });
    const v = note(root, { about: 'fact', body: 'checked', verified: true, evidence: ['s1:1-1'] });
    writeFileSync(join(root, 'INDEX.md'), `# Memory index\n\n- **guess**: unchecked (\`${u.id}\`)\n- **fact**: checked (\`${v.id}\`)\n- A past finding that must stay out of the index\n`);
    const failures = lint(root).failures.join('\n');
    assert.match(failures, new RegExp(`past finding ${p.id} appears in INDEX\\.md`));
    assert.match(failures, new RegExp(`line 3: unverified note ${u.id} is not labelled \\(hypothesis\\)`));
    assert.ok(!failures.includes(v.id));
    writeFileSync(join(root, 'INDEX.md'), `# Memory index\n\n- (hypothesis) **guess**: unchecked (\`${u.id}\`)\n`);
    assert.equal(lint(root).ok, true);
  });
});

describe('helpers', () => {
  test('formatNote matches what writeNote stores', () => {
    const root = tempRoot();
    const n = note(root, { evidence: ['s1:1-2'], verified: true, seen: 2, checked: '2026-11-09', body: 'two\nlines' });
    assert.equal(formatNote(n), readFileSync(join(root, 'notes', `${n.id}.md`), 'utf8'));
  });

  test('unifiedDiff emits hunks with context and /dev/null for creates and deletes', () => {
    assert.equal(unifiedDiff('f', 'a\nb\nc\n', 'a\nB\nc\n'), '--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
    assert.equal(unifiedDiff('f', undefined, 'x\n'), '--- /dev/null\n+++ b/f\n@@ -0,0 +1,1 @@\n+x\n');
    assert.equal(unifiedDiff('f', 'x\n', undefined), '--- a/f\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n');
    assert.equal(unifiedDiff('f', 'same\n', 'same\n'), '');
    const long = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const edited = [...long];
    edited[1] = 'X';
    edited[18] = 'Y';
    assert.equal(unifiedDiff('f', `${long.join('\n')}\n`, `${edited.join('\n')}\n`).match(/^@@/gm)?.length, 2);
  });

  test('relink removes only links into wiki/ whose page is missing', () => {
    const pages = new Set(['cache']);
    assert.equal(relink('[a](cache.md) [b](./gone.md#x) [c](../notes/n.md) [[Cache]] [[Gone|g]]', pages), '[a](cache.md) b [c](../notes/n.md) [[Cache]] g');
  });

  test('buildIndex orders sections by priority and stops at the first entry that does not fit', () => {
    const v = (i: number): Note => ({ id: `V${i}`, about: 'a', body: 'b'.repeat(150), evidence: ['s:1-1'], verified: true, seen: 1, origin: 'session' });
    const { text, omitted } = buildIndex({
      steering: 'steer',
      pages: [{ slug: 'p', title: 'P', facts: 2 }],
      verified: Array.from({ length: 10 }, (_, i) => v(i)),
      hypotheses: [{ ...v(99), verified: false }],
      budget: 200,
    });
    assert.ok(text.length <= 800);
    assert.ok(text.indexOf('## Wiki pages') < text.indexOf('## Verified notes'));
    assert.ok(!text.includes('Hypotheses'));
    assert.ok(omitted > 1);
    assert.match(text, new RegExp(`_${omitted} more entries left out`));
  });
});
