// Dream: the offline pass that re-checks notes against the transcript lines they cite, promotes confirmed facts
// to one wiki page per entity, confirms or expires past findings, prunes stale hypotheses and rebuilds INDEX.md
// within its token budget. Also `lint`, which enforces the budgets. See SPEC.md 3.4 and 4.
//
// The core is deterministic and costs no tokens. `modelCmd` is an opt-in second opinion for notes the term
// heuristic cannot decide; it costs model tokens on every call and must show an eval gain before it becomes a default.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside, isSafeId, listSessions, readLogSince, readNote, scrub, type LogCursor, type LogLine, type NoteLayer } from './store.js';
import { BUDGETS, LAYOUT, type LogKind, type Note } from './types.js';

const STATE_FILE = '.dream.json';
export const WIKI_MARK = '<!-- mem dream: generated from verified notes; edits are overwritten -->';
const MODEL_CALLS_PER_RUN = 20;
const MAX_HYPOTHESES = 8;

// ---------------------------------------------------------------- key terms and the verification heuristic

// Function words carry no claim; negations are stop words here and are compared separately as polarity.
const STOP = new Set(
  `a an the and or but if then else of to in on at by for with from into onto over under about after before as
  is are was were be been being am do does did done doing has have had having it its this that these those there
  here what which who whom whose when where why how all any both each few more most other some such only own same
  so than too very can will just should would could may might must shall also via per use used uses using get got
  set we you they he she them our your their i me my not no nor never none cannot without`.split(/\s+/),
);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/**
 * Key terms of a text: lowercase letter/digit runs (so `node:sqlite` gives `node` and `sqlite`), minus stop
 * words, minus runs shorter than three characters unless they hold a digit, with a plural `s` stripped.
 */
export function keyTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOP.has(raw)) continue;
    if (raw.length < 3 && !/\d/.test(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

const SUPPORT = 0.5; // key-term coverage that confirms
const REFUTE = 0.25; // coverage below which cited lines do not say it

const NEGATION = /\b(?:not|no|never|none|cannot|without|nor)\b|n['’]t\b/i;

function negated(text: string): boolean {
  return NEGATION.test(text);
}

function matched(key: Set<string>, terms: Set<string>): number {
  let n = 0;
  for (const t of key) if (terms.has(t)) n += 1;
  return n;
}

/** A line mentions a fact when it holds at least half its key terms, and at least two of them (or all, if fewer). */
export function mentions(key: Set<string>, terms: Set<string>): boolean {
  if (key.size === 0) return false;
  const m = matched(key, terms);
  return m >= Math.min(2, key.size) && m / key.size >= SUPPORT;
}

// The sentence of `cited` that shares the most key terms must agree with the note on negation:
// "the cache is not LRU" against "the cache is LRU" shares every term but says the opposite.
function polarityAgrees(noteText: string, cited: string, key: Set<string>): boolean {
  let best = '';
  let bestScore = -1;
  for (const sentence of cited.split(/(?<=[.!?])\s+|\n+/)) {
    const score = matched(key, keyTerms(sentence));
    if (score > bestScore) [best, bestScore] = [sentence, score];
  }
  return negated(best) === negated(noteText);
}

export interface Verdict {
  decision: 'verified' | 'unverified' | 'undecided';
  reason: string;
}

/**
 * The deterministic verification heuristic. `cited` holds the text of the cited lines that exist (memory tool
 * traffic removed); `missing` the refs whose session or lines are gone.
 *   no evidence                          -> unverified (a hypothesis)
 *   any ref missing                      -> unverified (evidence gone)
 *   cited lines are all memory traffic   -> unverified (a note cannot cite itself)
 *   key-term coverage < 0.25             -> unverified (cited lines do not say it)
 *   coverage < 0.5, or negation differs  -> undecided (left to the model step, else unverified)
 *   otherwise                            -> verified
 * Coverage is the share of the note's key terms found anywhere in the cited lines.
 */
export function judge(note: Pick<Note, 'about' | 'body' | 'evidence'>, cited: string[], missing: string[], selfCited = false): Verdict {
  if (note.evidence.length === 0) return { decision: 'unverified', reason: 'no evidence (hypothesis)' };
  if (missing.length > 0) return { decision: 'unverified', reason: `evidence gone: ${missing.join(', ')}` };
  if (cited.length === 0) return { decision: 'unverified', reason: selfCited ? 'evidence is memory tool traffic' : 'no cited line could be read' };
  const key = keyTerms(`${note.about} ${note.body}`);
  if (key.size === 0) return { decision: 'undecided', reason: 'note has no key terms' };
  const text = cited.join('\n');
  const m = matched(key, keyTerms(text));
  const share = `${m}/${key.size} key terms`;
  if (m / key.size < REFUTE) return { decision: 'unverified', reason: `cited lines share only ${share}` };
  if (m / key.size < SUPPORT) return { decision: 'undecided', reason: `cited lines share ${share}` };
  if (!polarityAgrees(note.body, text, key)) return { decision: 'undecided', reason: `cited lines share ${share} but differ on negation` };
  return { decision: 'verified', reason: `cited lines share ${share}` };
}

// A line written by or for the memory tools (searching, noting, injecting the index) repeats the note back,
// so it can neither confirm a note nor serve as its evidence.
function isMemoryTraffic(tool: string | undefined, text: string): boolean {
  if (tool !== undefined && /ai-memory|(?:^|[^a-z])(?:mem|memory)(?:[^a-z]|$)/i.test(tool)) return true;
  return /\bmem (?:search|note|dream|index|lint)\b/.test(text) || text.startsWith('# Memory index');
}

const CONTENT_KINDS: ReadonlySet<LogKind> = new Set<LogKind>(['user', 'assistant', 'tool_call', 'tool_result', 'error']);

function lineText(e: LogLine): string {
  return [e.event.tool, e.event.text, ...(e.event.refs ?? [])].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- state

interface NoteState {
  born: number;        // session count when dream first saw the note
  confirmed: string[]; // sessions counted towards `seen`
}

interface DreamState {
  version: 1;
  sessions: Record<string, LogCursor>;
  notes: Record<string, NoteState>; // key: `notes/<id>` or `past/<id>`
}

function parseState(text: string | undefined, file: string): DreamState {
  if (text === undefined) return { version: 1, sessions: {}, notes: {} };
  const bad = (why: string) => new Error(`${file}: ${why}; delete it to let dream rescan the whole log`);
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    throw bad('not valid JSON');
  }
  const s = x as Partial<DreamState> | null;
  if (s === null || typeof s !== 'object' || s.version !== 1 || typeof s.sessions !== 'object' || typeof s.notes !== 'object') throw bad('unknown format');
  for (const c of Object.values(s.sessions ?? {})) {
    if (!Number.isInteger(c?.offset) || !Number.isInteger(c?.line)) throw bad('bad session cursor');
  }
  for (const n of Object.values(s.notes ?? {})) {
    if (!Number.isInteger(n?.born) || !Array.isArray(n?.confirmed)) throw bad('bad note entry');
  }
  return s as DreamState;
}

function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]));
}

function formatState(s: DreamState): string {
  return `${JSON.stringify({ version: 1, sessions: sorted(s.sessions), notes: sorted(s.notes) }, null, 1)}\n`;
}

// ---------------------------------------------------------------- files

function readText(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

function atomicWrite(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

const NOTE_KEYS = ['id', 'about', 'evidence', 'verified', 'seen', 'checked', 'origin'] as const;

/** Serializes a note exactly as `store.writeNote` does, so a changeset can show its diff before writing it. */
export function formatNote(n: Note): string {
  const head = NOTE_KEYS.flatMap((k) => (n[k] === undefined ? [] : [`${k}: ${JSON.stringify(n[k])}`]));
  return `---\n${head.join('\n')}\n---\n${n.body}\n`;
}

function loadLayer(layer: NoteLayer, root: string, skipped: string[]): Note[] {
  const dir = inside(root, LAYOUT[layer]);
  if (!existsSync(dir)) return [];
  const out: Note[] = [];
  for (const f of readdirSync(dir).filter((name) => name.endsWith('.md')).sort()) {
    const id = f.slice(0, -'.md'.length);
    if (!isSafeId(id)) continue;
    try {
      const n = readNote(id, layer, root);
      if (n) out.push(n);
    } catch (err) {
      skipped.push(`${layer}/${f}: ${(err as Error).message}`);
    }
  }
  return out;
}

function markdownFiles(root: string, dir: string): string[] {
  const full = inside(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((f) => f.endsWith('.md')).sort();
}

// ---------------------------------------------------------------- diffs

type Op = { t: ' ' | '-' | '+'; s: string };

function splitLines(text: string | undefined): string[] {
  if (text === undefined || text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function diffOps(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre += 1;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf += 1;
  const x = a.slice(pre, a.length - suf);
  const y = b.slice(pre, b.length - suf);
  const mid: Op[] = [];
  const w = y.length + 1;
  if (x.length * y.length > 2_000_000) {
    mid.push(...x.map((s): Op => ({ t: '-', s })), ...y.map((s): Op => ({ t: '+', s })));
  } else {
    // Longest common subsequence, filled from the end so the walk below runs forwards.
    const lcs = new Uint32Array((x.length + 1) * w);
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        mid.push({ t: ' ', s: x[i] });
        i += 1;
        j += 1;
      } else if (j < y.length && (i === x.length || lcs[i * w + j + 1] > lcs[(i + 1) * w + j])) {
        mid.push({ t: '+', s: y[j] });
        j += 1;
      } else {
        mid.push({ t: '-', s: x[i] });
        i += 1;
      }
    }
  }
  return [...a.slice(0, pre).map((s): Op => ({ t: ' ', s })), ...mid, ...a.slice(a.length - suf).map((s): Op => ({ t: ' ', s }))];
}

/** A unified diff with three lines of context; `undefined` content means the file does not exist on that side. */
export function unifiedDiff(path: string, before: string | undefined, after: string | undefined, context = 3): string {
  const ops = diffOps(splitLines(before), splitLines(after));
  const changes = ops.flatMap((o, i) => (o.t === ' ' ? [] : [i]));
  if (changes.length === 0) return '';
  const oldAt: number[] = [];
  const newAt: number[] = [];
  for (let i = 0, o = 1, n = 1; i < ops.length; i++) {
    oldAt.push(o);
    newAt.push(n);
    if (ops[i].t !== '+') o += 1;
    if (ops[i].t !== '-') n += 1;
  }
  const groups: [number, number][] = [];
  for (const i of changes) {
    const last = groups[groups.length - 1];
    if (last && i - last[1] <= 2 * context) last[1] = i;
    else groups.push([i, i]);
  }
  const out = [before === undefined ? '--- /dev/null' : `--- a/${path}`, after === undefined ? '+++ /dev/null' : `+++ b/${path}`];
  for (const [first, last] of groups) {
    const lo = Math.max(0, first - context);
    const slice = ops.slice(lo, Math.min(ops.length, last + context + 1));
    const oldCount = slice.filter((o) => o.t !== '+').length;
    const newCount = slice.filter((o) => o.t !== '-').length;
    out.push(`@@ -${oldCount ? oldAt[lo] : oldAt[lo] - 1},${oldCount} +${newCount ? newAt[lo] : newAt[lo] - 1},${newCount} @@`, ...slice.map((o) => o.t + o.s));
  }
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------- wiki pages

export function slug(about: string): string {
  return about.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'entity';
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

interface Page {
  slug: string;
  title: string;
  notes: Note[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Each page quotes its notes verbatim with their evidence; related links point only at pages in `all`. */
function renderPage(page: Page, all: Page[]): string {
  const parts = [WIKI_MARK, `# ${page.title}`, ''];
  for (const n of page.notes) {
    parts.push(...n.body.split('\n').map((l) => (l === '' ? '>' : `> ${l}`)), '');
    parts.push(`Note \`${n.id}\`, confirmed in ${n.seen} sessions. Evidence: ${n.evidence.join(', ')}.`, '');
  }
  const bodies = page.notes.map((n) => n.body.toLowerCase()).join('\n');
  const related = all.filter((p) => p.slug !== page.slug && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(p.title.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u').test(bodies));
  if (related.length > 0) parts.push(`Related: ${related.map((p) => `[${p.title}](${p.slug}.md)`).join(', ')}`, '');
  return `${parts.join('\n').replace(/\n+$/, '')}\n`;
}

/** Rewrites links into `wiki/` whose target page will not exist to plain text. Other links are left alone. */
export function relink(text: string, pages: ReadonlySet<string>): string {
  const exists = (target: string) => {
    const path = posix.normalize(posix.join(LAYOUT.wiki, target));
    return !path.startsWith(`${LAYOUT.wiki}/`) || pages.has(path.slice(LAYOUT.wiki.length + 1, -'.md'.length));
  };
  return text
    .replace(/\[([^\]\n]*)\]\((?![a-z][a-z0-9+.-]*:)([^)\s#]+\.md)(#[^)\s]*)?\)/gi, (m, label: string, target: string) => (exists(target) ? m : label))
    .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (m, target: string, label?: string) => (pages.has(slug(target)) || pages.has(target) ? m : (label ?? target)));
}

function pageTitle(text: string, fallback: string): string {
  return /^# (.+)$/m.exec(text)?.[1].trim() ?? fallback;
}

// ---------------------------------------------------------------- INDEX.md

export const DEFAULT_STEERING = `Project memory. Treat it as leads, not truth, and check before relying on it.
Search before assuming: \`mem search <terms>\` covers transcripts, notes, wiki pages and past findings.
Write a note only for a fact the environment does not already show, and cite the transcript lines that prove it.
Verified notes were re-checked against their cited lines by \`mem dream\`; hypotheses were not.
Past findings from the old memory stay out of this index until a transcript confirms them.`;

/** STEERING.md at the package root (next to `src/` and `dist/`), else the built-in five lines. */
export function loadSteering(): string {
  try {
    const text = readFileSync(fileURLToPath(new URL('../STEERING.md', import.meta.url)), 'utf8');
    return text.replace(/^# .*\n+/, '').trim() || DEFAULT_STEERING;
  } catch {
    return DEFAULT_STEERING;
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface IndexInput {
  steering: string;
  pages: { slug: string; title: string; facts?: number }[];
  verified: Note[];
  hypotheses: Note[];
  budget?: number; // tokens
}

const HYPOTHESIS_LABEL = '(hypothesis)';

/**
 * Lays INDEX.md out in priority order: title, steering preamble (at most 40% of the budget), wiki pages,
 * verified notes, then a few labelled hypotheses. The first item that does not fit ends the index, and a
 * footer says how many were left out. Past findings are never passed in.
 */
export function buildIndex(input: IndexInput): { text: string; omitted: number } {
  const maxChars = (input.budget ?? BUDGETS.indexTokens) * 4;
  const out = ['# Memory index', ''];
  let size = out.join('\n').length + 1;
  const preambleMax = Math.floor(maxChars * 0.4);
  let preamble = 0;
  for (const l of input.steering.split('\n')) {
    if (preamble + l.length + 1 > preambleMax) break;
    out.push(l);
    preamble += l.length + 1;
  }
  size += preamble;
  const sections: [heading: string, lines: string[]][] = [
    ['## Wiki pages', input.pages.map((p) => `- [${p.title}](${LAYOUT.wiki}/${p.slug}.md)${p.facts === undefined ? '' : `: ${p.facts} fact${p.facts === 1 ? '' : 's'}`}`)],
    ['## Verified notes', input.verified.map((n) => `- **${oneLine(n.about, 60)}**: ${oneLine(n.body, 200)} (\`${n.id}\`)`)],
    ['## Hypotheses: unverified, confirm before relying on them', input.hypotheses.map((n) => `- ${HYPOTHESIS_LABEL} **${oneLine(n.about, 60)}**: ${oneLine(n.body, 200)} (\`${n.id}\`)`)],
  ];
  const total = sections.reduce((sum, [, lines]) => sum + lines.length, 0);
  const footerRoom = 90;
  let added = 0;
  let full = false;
  for (const [heading, lines] of sections) {
    for (const [i, line] of lines.entries()) {
      const cost = (i === 0 ? heading.length + 2 + 1 : 0) + line.length + 1;
      if (size + cost + (added + 1 < total ? footerRoom : 0) > maxChars) {
        full = true;
        break;
      }
      if (i === 0) out.push('', heading);
      out.push(line);
      size += cost;
      added += 1;
    }
    if (full) break;
  }
  const omitted = total - added;
  if (omitted > 0) out.push('', `_${omitted} more entr${omitted === 1 ? 'y' : 'ies'} left out to fit the budget; use \`mem search\`._`);
  return { text: `${out.join('\n')}\n`, omitted };
}

// ---------------------------------------------------------------- the model step

function askModel(cmd: string, note: Note, cited: string[]): Verdict | string {
  const prompt = scrub(
    [
      'Check one memory note against the transcript lines it cites.',
      'Reply with JSON only: {"verified": true|false, "reason": "<one short sentence>"}.',
      `verified is true only if the lines state the note's claim; false if they contradict it or do not say it.`,
      '',
      `Note about ${note.about}:`,
      note.body,
      '',
      'Cited lines:',
      oneLine(cited.join('\n'), 4000),
    ].join('\n'),
  );
  const res = spawnSync(cmd, { shell: true, input: prompt, encoding: 'utf8', timeout: 120_000, maxBuffer: 1 << 20 });
  if (res.error) return `model command failed: ${res.error.message}`;
  if (res.status !== 0) return `model command exited ${res.status}`;
  const out = res.stdout.trim();
  let v: unknown;
  try {
    v = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  } catch {
    return 'model gave no JSON verdict';
  }
  const r = v as { verified?: unknown; reason?: unknown };
  if (typeof r.verified !== 'boolean') return 'model verdict lacks a boolean "verified"';
  return { decision: r.verified ? 'verified' : 'unverified', reason: `model: ${typeof r.reason === 'string' ? oneLine(r.reason, 200) : 'no reason'}` };
}

// ---------------------------------------------------------------- dream

export interface DreamOptions {
  root: string;
  dryRun?: boolean;
  modelCmd?: string;
  now?: Date;
  steering?: string;      // defaults to loadSteering()
  modelLimit?: number;    // model calls per run, stalest notes first
}

export interface Change {
  op: 'create' | 'update' | 'delete';
  path: string;           // relative to the memory root
  reason: string;
  before?: string;
  after?: string;
}

export interface DreamReport {
  dryRun: boolean;
  changes: Change[];
  sessions: { total: number; new: number; newLines: number };
  checks: { id: string; verified: boolean; reason: string }[];
  promotedPast: string[];
  expiredPast: string[];
  pruned: string[];       // unverified notes kept out of the index (files kept)
  wiki: string[];         // page slugs after the run
  overBudget: string[];   // pages held back by the wiki budget
  indexTokens: number;
  indexOmitted: number;
  modelCalls: number;
  modelErrors: string[];
  skipped: string[];      // malformed files left untouched
  conflicts: string[];    // files changed by someone else between planning and writing; left as they were
}

interface NewLine {
  session: string;
  line: number;
  text: string;
  terms: Set<string>;
}

export function dream(opts: DreamOptions): DreamReport {
  const { root } = opts;
  if (!existsSync(root)) throw new Error(`no memory root at ${root}`);
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const stateFile = inside(root, STATE_FILE);
  const stateBefore = readText(stateFile);
  const state = parseState(stateBefore, stateFile);
  const skipped: string[] = [];

  // New log segments only: each session resumes at its cursor; a file that shrank is read again from the start.
  const newLines: NewLine[] = [];
  let newSessions = 0;
  const sessions = listSessions(root);
  for (const s of sessions) {
    if (!Object.hasOwn(state.sessions, s)) newSessions += 1;
    let from = state.sessions[s] ?? { offset: 0, line: 0 };
    if (statSync(inside(root, LAYOUT.log, `${s}.jsonl`)).size < from.offset) from = { offset: 0, line: 0 };
    const { entries, cursor } = readLogSince(s, from, root);
    state.sessions[s] = cursor;
    for (const e of entries) {
      if (!CONTENT_KINDS.has(e.event.kind) || isMemoryTraffic(e.event.tool, e.event.text)) continue;
      const text = lineText(e);
      newLines.push({ session: s, line: e.line, text, terms: keyTerms(text) });
    }
  }
  const count = Object.keys(state.sessions).length;

  const notes = loadLayer('notes', root, skipped);
  const past = loadLayer('past', root, skipped);
  const entry = (key: string): NoteState => (state.notes[key] ??= { born: count, confirmed: [] });
  for (const n of notes) entry(`notes/${n.id}`);
  for (const p of past) entry(`past/${p.id}`);

  const files = new Map<string, string | null>(); // desired content by path; null deletes
  const reasons = new Map<string, string>();
  const want = (path: string, text: string | null, reason: string) => {
    files.set(path, text);
    reasons.set(path, reason);
  };

  // Past findings: a new transcript line that states one turns it into an evidenced note; silence expires it.
  const promotedPast: string[] = [];
  const expiredPast: string[] = [];
  const noteIds = new Set(notes.map((n) => n.id));
  for (const p of past) {
    const key = keyTerms(`${p.about} ${p.body}`);
    const hit = newLines.find((l) => mentions(key, l.terms) && polarityAgrees(p.body, l.text, key));
    const pkey = `past/${p.id}`;
    if (hit) {
      const ref = `${hit.session}:${hit.line}-${hit.line}`;
      if (!noteIds.has(p.id)) {
        const promoted: Note = { ...p, origin: 'session', evidence: [ref], verified: true, seen: Math.max(p.seen, 1), checked: today };
        notes.push(promoted);
        noteIds.add(p.id);
        state.notes[`notes/${p.id}`] = { born: count, confirmed: [hit.session] };
        want(`${LAYOUT.notes}/${p.id}.md`, formatNote(promoted), `past finding confirmed by ${ref}`);
      }
      want(`${LAYOUT.past}/${p.id}.md`, null, `confirmed by ${ref}; now notes/${p.id}.md`);
      delete state.notes[pkey];
      promotedPast.push(p.id);
    } else if (count - state.notes[pkey].born >= BUDGETS.expirePastAfterSessions) {
      want(`${LAYOUT.past}/${p.id}.md`, null, `unconfirmed for ${count - state.notes[pkey].born} sessions`);
      delete state.notes[pkey];
      expiredPast.push(p.id);
    }
  }

  // Verification, stalest first so the per-run model budget goes to the notes checked longest ago.
  const logs = new Map<string, { lines: Map<number, LogLine>; total: number }>();
  const sessionSet = new Set(sessions);
  const logOf = (s: string) => {
    let l = logs.get(s);
    if (!l) {
      const { entries, cursor } = readLogSince(s, { offset: 0, line: 0 }, root);
      l = { lines: new Map(entries.map((e) => [e.line, e])), total: cursor.line };
      logs.set(s, l);
    }
    return l;
  };
  const order = [...notes].sort((a, b) => (a.checked ?? '').localeCompare(b.checked ?? '') || a.id.localeCompare(b.id));
  const checks: DreamReport['checks'] = [];
  const modelErrors: string[] = [];
  let modelCalls = 0;
  const finalNotes = new Map<string, Note>();
  for (const n of order) {
    const st = entry(`notes/${n.id}`);
    const cited: string[] = [];
    const missing: string[] = [];
    const present: string[] = [];
    let selfCited = false;
    for (const ref of n.evidence) {
      const [, s, a, b] = /^(.+):(\d+)-(\d+)$/.exec(ref) ?? [];
      const log = sessionSet.has(s) ? logOf(s) : undefined;
      const lines = log && Number(b) <= log.total ? Array.from({ length: Number(b) - Number(a) + 1 }, (_, i) => log.lines.get(Number(a) + i)).filter((e) => e !== undefined) : [];
      if (lines.length === 0) {
        missing.push(ref);
        continue;
      }
      present.push(s);
      for (const e of lines) {
        if (isMemoryTraffic(e.event.tool, e.event.text)) selfCited = true;
        else cited.push(lineText(e));
      }
    }
    const key = keyTerms(`${n.about} ${n.body}`);
    const touched = new Set(newLines.filter((l) => mentions(key, l.terms)).map((l) => l.session));
    const due = n.checked === undefined || touched.size > 0;
    let v = judge(n, cited, missing, selfCited);
    if (v.decision === 'undecided' && due && opts.modelCmd && modelCalls < (opts.modelLimit ?? MODEL_CALLS_PER_RUN)) {
      modelCalls += 1;
      const answer = askModel(opts.modelCmd, n, cited);
      if (typeof answer === 'string') modelErrors.push(`${n.id}: ${answer}`);
      else v = answer;
    }
    // Decided verdicts always apply (evidence can vanish between runs). An undecided note keeps its last
    // verdict unless new lines touch it or it was never checked, so an unchanged log asks no new questions.
    const verified = v.decision === 'verified' ? true : v.decision === 'unverified' ? false : due ? false : n.verified;
    const confirmed = [...new Set([...st.confirmed, ...present, ...touched])].sort();
    st.confirmed = confirmed;
    const seen = Math.max(n.seen, confirmed.length);
    const next = verified !== n.verified || seen !== n.seen || due ? { ...n, verified, seen, checked: today } : n;
    finalNotes.set(n.id, next);
    if (due || verified !== n.verified) checks.push({ id: n.id, verified, reason: v.reason });
    if (next !== n && !files.has(`${LAYOUT.notes}/${n.id}.md`)) {
      want(`${LAYOUT.notes}/${n.id}.md`, formatNote(next), `${verified ? 'verified' : 'unverified'}: ${v.reason}${seen !== n.seen ? `; seen ${n.seen} -> ${seen}` : ''}`);
    } else if (files.has(`${LAYOUT.notes}/${n.id}.md`)) {
      files.set(`${LAYOUT.notes}/${n.id}.md`, formatNote(next));
    }
  }
  const all = [...finalNotes.values()].sort((a, b) => a.id.localeCompare(b.id));

  // Wiki: one page per entity from verified notes confirmed in enough sessions, within the size budget.
  const groups = new Map<string, Page>();
  for (const n of all.filter((x) => x.verified && x.seen >= BUDGETS.promoteAfterSessions)) {
    const s = slug(n.about);
    const page = groups.get(s) ?? { slug: s, title: oneLine(n.about, 120), notes: [] };
    page.notes.push(n);
    groups.set(s, page);
  }
  const weight = (p: Page) => p.notes.reduce((sum, n) => sum + n.seen, 0);
  const candidates = [...groups.values()].sort((a, b) => weight(b) - weight(a) || a.slug.localeCompare(b.slug));
  const existing = new Map(markdownFiles(root, LAYOUT.wiki).map((f) => [f.slice(0, -'.md'.length), readFileSync(inside(root, LAYOUT.wiki, f), 'utf8')]));
  const unmarked = (text: string) => !text.startsWith(WIKI_MARK);
  const notesBytes = all.reduce((sum, n) => sum + Buffer.byteLength(formatNote(n)), 0);
  const wikiLimit = BUDGETS.wikiToNotesMaxRatio * notesBytes;
  const foreignBytes = [...existing].reduce((sum, [s, t]) => sum + (unmarked(t) && !groups.has(s) ? Buffer.byteLength(t) : 0), 0);
  const overBudget: string[] = [];
  let chosen: Page[] = [];
  for (const p of candidates) {
    const trial = [...chosen, p];
    const bytes = trial.reduce((sum, q) => sum + Buffer.byteLength(renderPage(q, trial)), foreignBytes);
    if (bytes <= wikiLimit) chosen = trial;
    else overBudget.push(p.slug);
  }
  // Pages dream did not write are never deleted, only relinked, unless a dream page takes over their name.
  const chosenSlugs = new Set(chosen.map((p) => p.slug));
  const foreign = new Map([...existing].filter(([s, t]) => unmarked(t) && !chosenSlugs.has(s)));
  const pageSet = new Set([...chosenSlugs, ...foreign.keys()]);
  for (const p of chosen) {
    const before = existing.get(p.slug);
    const reason = before !== undefined && unmarked(before) ? 'replaces a page dream did not write' : `${p.notes.length} verified note${p.notes.length === 1 ? '' : 's'}`;
    want(`${LAYOUT.wiki}/${p.slug}.md`, renderPage(p, chosen), reason);
  }
  for (const [s, text] of existing) {
    if (foreign.has(s)) want(`${LAYOUT.wiki}/${s}.md`, relink(text, pageSet), 'links to missing pages removed');
    else if (!chosenSlugs.has(s)) want(`${LAYOUT.wiki}/${s}.md`, null, overBudget.includes(s) ? 'over the wiki budget' : 'no verified notes confirm it');
  }

  // INDEX.md: never past findings; unverified notes only while young enough, and labelled.
  const age = (n: Note) => count - (state.notes[`notes/${n.id}`]?.born ?? count);
  const pruned = all.filter((n) => !n.verified && age(n) >= BUDGETS.pruneUnverifiedAfterSessions).map((n) => n.id);
  const pages = [
    ...chosen.map((p) => ({ slug: p.slug, title: p.title, facts: p.notes.length })),
    ...[...foreign].map(([s, text]) => ({ slug: s, title: pageTitle(text, s) })),
  ].sort((a, b) => a.slug.localeCompare(b.slug));
  const verifiedNotes = all.filter((n) => n.verified).sort((a, b) => b.seen - a.seen || a.id.localeCompare(b.id));
  const hypotheses = all
    .filter((n) => !n.verified && age(n) < BUDGETS.pruneUnverifiedAfterSessions)
    .sort((a, b) => age(a) - age(b) || b.id.localeCompare(a.id))
    .slice(0, MAX_HYPOTHESES);
  const index = buildIndex({ steering: opts.steering ?? loadSteering(), pages, verified: verifiedNotes, hypotheses });
  want(LAYOUT.index, index.text, `${estimateTokens(index.text)} of ${BUDGETS.indexTokens} tokens`);

  // The changeset is the difference between what should be on disk and what is.
  for (const key of Object.keys(state.notes)) {
    const [layer, id] = key.split('/');
    if (layer === 'notes' ? !finalNotes.has(id) : !past.some((p) => p.id === id) || promotedPast.includes(id) || expiredPast.includes(id)) delete state.notes[key];
  }
  const changes: Change[] = [];
  for (const path of [...files.keys()].sort()) {
    const after = files.get(path) ?? undefined;
    const before = readText(inside(root, path));
    if (before === after) continue;
    const op = before === undefined ? 'create' : after === undefined ? 'delete' : 'update';
    changes.push({ op, path, reason: reasons.get(path) ?? '', ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) });
  }

  const conflicts: string[] = [];
  if (!opts.dryRun) {
    for (const c of changes) {
      const file = inside(root, c.path);
      if (readText(file) !== c.before) {
        conflicts.push(c.path);
        continue;
      }
      if (c.after === undefined) unlinkSync(file);
      else atomicWrite(file, c.after);
    }
    const stateAfter = formatState(state);
    if (stateAfter !== stateBefore) atomicWrite(stateFile, stateAfter);
  }

  return {
    dryRun: opts.dryRun ?? false,
    changes,
    sessions: { total: count, new: newSessions, newLines: newLines.length },
    checks,
    promotedPast,
    expiredPast,
    pruned,
    wiki: [...pageSet].sort(),
    overBudget,
    indexTokens: estimateTokens(index.text),
    indexOmitted: index.omitted,
    modelCalls,
    modelErrors,
    skipped,
    conflicts,
  };
}

/** The changeset as diffs (dry run) or a one-line-per-change summary (real run). */
export function formatReport(r: DreamReport): string {
  const out: string[] = [];
  if (r.dryRun) {
    for (const c of r.changes) out.push(`# ${c.op} ${c.path}: ${c.reason}`, unifiedDiff(c.path, c.before, c.after).trimEnd(), '');
  }
  const verified = r.checks.filter((c) => c.verified).length;
  out.push(
    `dream${r.dryRun ? ' (dry run, nothing written)' : ''}: ${r.sessions.new} new of ${r.sessions.total} sessions, ${r.sessions.newLines} new lines`,
    `notes: ${r.checks.length} checked (${verified} verified, ${r.checks.length - verified} unverified), ${r.pruned.length} pruned from the index`,
    `past: ${r.promotedPast.length} confirmed, ${r.expiredPast.length} expired`,
    `wiki: ${r.wiki.length} pages${r.overBudget.length ? `, ${r.overBudget.length} held back by the budget` : ''}; INDEX.md ${r.indexTokens}/${BUDGETS.indexTokens} tokens${r.indexOmitted ? `, ${r.indexOmitted} entries left out` : ''}`,
  );
  if (r.modelCalls || r.modelErrors.length) out.push(`model: ${r.modelCalls} calls${r.modelErrors.length ? `, errors: ${r.modelErrors.join('; ')}` : ''}`);
  if (!r.dryRun) for (const c of r.changes) out.push(`  ${r.conflicts.includes(c.path) ? 'skipped (changed meanwhile)' : c.op} ${c.path}: ${c.reason}`);
  if (r.changes.length === 0) out.push('no changes');
  for (const s of r.skipped) out.push(`skipped malformed ${s}`);
  return `${out.join('\n')}\n`;
}

/** JSON view of a report: each change carries its diff instead of both full texts. */
export function reportJson(r: DreamReport): unknown {
  return { ...r, changes: r.changes.map((c) => ({ op: c.op, path: c.path, reason: c.reason, diff: unifiedDiff(c.path, c.before, c.after) })) };
}

// ---------------------------------------------------------------- lint

export interface LintResult {
  ok: boolean;
  failures: string[];
  indexTokens: number;
  wikiBytes: number;
  notesBytes: number;
}

function layerBytes(root: string, dir: string): number {
  return markdownFiles(root, dir).reduce((sum, f) => sum + statSync(inside(root, dir, f)).size, 0);
}

/** Checks the budgets of SPEC.md 4 and the index rules; runs in any project with a memory root. */
export function lint(root: string): LintResult {
  const failures: string[] = [];
  const index = existsSync(root) ? (readText(inside(root, LAYOUT.index)) ?? '') : '';
  const indexTokens = estimateTokens(index);
  if (indexTokens > BUDGETS.indexTokens) failures.push(`INDEX.md is ${indexTokens} tokens, over the budget of ${BUDGETS.indexTokens}`);
  const wikiBytes = existsSync(root) ? layerBytes(root, LAYOUT.wiki) : 0;
  const notesBytes = existsSync(root) ? layerBytes(root, LAYOUT.notes) : 0;
  if (wikiBytes > BUDGETS.wikiToNotesMaxRatio * notesBytes) {
    failures.push(`wiki is ${wikiBytes} bytes, over ${BUDGETS.wikiToNotesMaxRatio} x ${notesBytes} bytes of notes`);
  }
  if (index !== '') {
    const skipped: string[] = [];
    const flat = index.replace(/\s+/g, ' ');
    for (const p of loadLayer('past', root, skipped)) {
      const body = oneLine(p.body, 10_000);
      if (index.includes(p.id) || (body.length >= 24 && flat.includes(body.slice(0, 80)))) failures.push(`past finding ${p.id} appears in INDEX.md`);
    }
    const notes = new Map(loadLayer('notes', root, skipped).map((n) => [n.id, n]));
    for (const [i, line] of index.split('\n').entries()) {
      for (const [, id] of line.matchAll(/`([A-Za-z0-9][A-Za-z0-9._-]{0,127})`/g)) {
        const n = notes.get(id);
        if (n && !n.verified && !line.includes(HYPOTHESIS_LABEL)) failures.push(`INDEX.md line ${i + 1}: unverified note ${id} is not labelled ${HYPOTHESIS_LABEL}`);
      }
    }
    for (const s of skipped) failures.push(`malformed ${s}`);
  }
  return { ok: failures.length === 0, failures, indexTokens, wikiBytes, notesBytes };
}

export function formatLint(r: LintResult): string {
  const head = `lint: INDEX.md ${r.indexTokens}/${BUDGETS.indexTokens} tokens; wiki ${r.wikiBytes} bytes, notes ${r.notesBytes} bytes`;
  return `${[head, ...r.failures.map((f) => `FAIL ${f}`), r.ok ? 'ok' : `${r.failures.length} failed`].join('\n')}\n`;
}
