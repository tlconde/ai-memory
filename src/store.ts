// Filesystem store: the transcript log, notes and past findings under the memory root. See SPEC.md 3.1-3.2.

import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { BUDGETS, LAYOUT, type EvidenceRef, type HostName, type LogEvent, type LogKind, type Note, type NoteOrigin } from './types.js';

// ---------------------------------------------------------------- root and path safety

/** The memory root: `$MEM_ROOT` if set, else `<cwd>/.memory`. */
export function memoryRoot(cwd: string = process.cwd()): string {
  const override = process.env.MEM_ROOT;
  return override ? resolve(override) : resolve(cwd, '.memory');
}

// A leading alphanumeric rules out `.`, `..` and hidden files, which the bare character class would allow.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

function assertSafeId(id: string, what: string): void {
  if (!isSafeId(id)) throw new Error(`invalid ${what} ${JSON.stringify(id.slice(0, 140))}: use [A-Za-z0-9._-], start alphanumeric, max 128`);
}

/** Resolves `parts` under `root` and refuses anything that escapes it. */
export function inside(root: string, ...parts: string[]): string {
  const base = resolve(root);
  const target = resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + sep)) throw new Error(`path escapes the memory root: ${target}`);
  return target;
}

// ---------------------------------------------------------------- secret scrubbing

type Rule = [kind: string, pattern: RegExp, replace?: (match: string, ...groups: string[]) => string];

const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*(?:key|token|secret|password|passwd)[A-Za-z0-9_.-]*`;
const NOT_REDACTED = String.raw`(?!\[REDACTED:)`;

// Order matters: whole structures (PEM, JWT, auth headers) go before the token rules that would split them.
const RULES: Rule[] = [
  ['private_key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g],
  ['jwt', /(?<![\w-])eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g],
  ['authorization', /(\bauthorization["']?\s*[:=]\s*["']?)((?:bearer|basic|token|digest)\s+)?[^\s"',;]{8,}/gi, (_m, head: string, scheme = '') => `${head}${scheme}[REDACTED:authorization]`],
  ['bearer', /\b(bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, (_m, head: string) => `${head}[REDACTED:bearer]`],
  ['anthropic_key', /(?<![\w-])sk-ant-[\w-]{20,}/g],
  ['openai_key', /(?<![\w-])sk-[\w-]{20,}/g],
  ['stripe_key', /(?<![\w-])[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['github_token', /(?<![\w-])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{22,})/g],
  ['gitlab_token', /(?<![\w-])glpat-[\w-]{20,}/g],
  ['slack_token', /(?<![\w-])xox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['aws_access_key', /(?<![A-Z0-9])(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Z0-9])/g],
  ['google_api_key', /(?<![\w-])AIza[\w-]{35}/g],
  ['url_password', /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, (_m, head: string) => `${head}[REDACTED:url_password]@`],
  // NAME=value with no spaces round `=` (env files, CLI flags, query strings); spaced `x = y` is code, not config.
  ['secret_value', new RegExp(String.raw`(^|[^A-Za-z0-9_.-])(${SECRET_NAME})=(?!=)${NOT_REDACTED}(?:"[^"\n]*"|'[^'\n]*'|[^\s"'&,;]+)`, 'gim'), (_m, lead: string, name: string) => `${lead}${name}=[REDACTED:secret_value]`],
  ['secret_value', new RegExp(String.raw`("${SECRET_NAME}"\s*:\s*)"${NOT_REDACTED}(?:[^"\\\n]|\\.)+"`, 'gi'), (_m, head: string) => `${head}"[REDACTED:secret_value]"`],
  ['secret_value', new RegExp(String.raw`^([ \t]*(?:-[ \t]+)?${SECRET_NAME}[ \t]*:[ \t]*)${NOT_REDACTED}(?:"[^"\n]*"|'[^'\n]*'|[^\s#"'|>]\S*)[ \t]*$`, 'gim'), (_m, head: string) => `${head}[REDACTED:secret_value]`],
];

function shannon(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / s.length) * Math.log2(n / s.length);
  return bits;
}

/** Mean length of word-like runs (`Word`, `word`, `WORD`, `123`); identifiers and paths have long runs, random tokens short ones. */
function meanRun(s: string): number {
  const runs = s.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+/g) ?? [];
  return runs.reduce((sum, r) => sum + r.length, 0) / Math.max(runs.length, 1);
}

// Thresholds measured on 20,000 random strings per alphabet and length, and on long paths and identifiers:
// random base62/base64 of 32 chars has entropy p1 4.2 and mean run about 1.8, while paths, camelCase and
// kebab identifiers of the same length sit at 3.9-4.4 entropy but mean runs of 3.3-5.9. Entropy alone cannot
// separate them; entropy >= 4.0 plus mean run < 3.0 plus mixed case and digits misses under 1% of random 32-char
// tokens and flags none of the identifiers. Hex has at most 4 bits/char, so it gets its own floor, and lengths
// 40 and 64 are left alone because they are git SHA-1 and SHA-256 digests. ULIDs and UUIDs lack lowercase or
// uppercase and pass through.
function looksRandom(s: string): boolean {
  if (/^[0-9a-f]+$/i.test(s)) return s.length !== 40 && s.length !== 64 && /[0-9]/.test(s) && /[a-f]/i.test(s) && shannon(s) >= 3.0;
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/[0-9]/.test(s)) return false;
  return shannon(s) >= 4.0 && meanRun(s) < 3.0;
}

/** Replaces secrets with `[REDACTED:<kind>]`. Idempotent. */
export function scrub(text: string): string {
  let out = text;
  for (const [kind, pattern, replace] of RULES) {
    out = out.replace(pattern, replace ?? (() => `[REDACTED:${kind}]`));
  }
  return out.replace(/(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{32,}(?![A-Za-z0-9+/=_-])/g, (m) => (looksRandom(m) ? '[REDACTED:high_entropy]' : m));
}

// ---------------------------------------------------------------- log events

// Records keyed by the union make the compiler reject a missing or extra member.
const HOSTS: Record<HostName, true> = { 'claude-code': true, codex: true, cursor: true, gemini: true, hermes: true, openclaw: true, generic: true };
const KINDS: Record<LogKind, true> = { user: true, assistant: true, tool_call: true, tool_result: true, error: true, session_start: true, session_end: true };
const EVENT_KEYS = new Set(['ts', 'session', 'host', 'kind', 'tool', 'text', 'refs']);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isHost(x: unknown): x is HostName {
  return typeof x === 'string' && Object.hasOwn(HOSTS, x);
}

function isKind(x: unknown): x is LogKind {
  return typeof x === 'string' && Object.hasOwn(KINDS, x);
}

function isIsoTime(x: unknown): x is string {
  return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x) && !Number.isNaN(Date.parse(x));
}

/** Validates an untrusted value as a LogEvent; throws with the first problem found. */
export function parseEvent(x: unknown): LogEvent {
  if (!isRecord(x)) throw new Error('event must be a JSON object');
  for (const key of Object.keys(x)) if (!EVENT_KEYS.has(key)) throw new Error(`unknown event field "${key}"`);
  const { ts, session, host, kind, tool, text, refs } = x;
  if (!isIsoTime(ts)) throw new Error('ts must be an ISO 8601 timestamp');
  if (typeof session !== 'string') throw new Error('session must be a string');
  assertSafeId(session, 'session');
  if (!isHost(host)) throw new Error(`host must be one of ${Object.keys(HOSTS).join(', ')}`);
  if (!isKind(kind)) throw new Error(`kind must be one of ${Object.keys(KINDS).join(', ')}`);
  if (tool !== undefined && typeof tool !== 'string') throw new Error('tool must be a string');
  if (typeof text !== 'string') throw new Error('text must be a string');
  if (refs !== undefined && !(Array.isArray(refs) && refs.every((r): r is string => typeof r === 'string'))) throw new Error('refs must be an array of strings');
  return { ts, session, host, kind, ...(tool === undefined ? {} : { tool }), text, ...(refs === undefined ? {} : { refs }) };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = ` [truncated ${text.length - max} chars]`;
  let cut = max - marker.length;
  // Do not split a surrogate pair.
  if (/[\uD800-\uDBFF]/.test(text.charAt(cut - 1))) cut -= 1;
  return text.slice(0, cut) + marker;
}

function logFile(session: string, root: string): string {
  assertSafeId(session, 'session');
  return inside(root, LAYOUT.log, `${session}.jsonl`);
}

const NL = 0x0a;

/**
 * Scrubs, truncates and appends one event as a single JSON line; returns its 1-based line number.
 * One O_APPEND write per line keeps concurrent writers from interleaving. The line number is found by
 * locating our bytes at or after the pre-write size, so other writers racing us cannot skew it.
 */
export function appendEvent(e: LogEvent, root: string = memoryRoot()): number {
  const v = parseEvent(e);
  const clean: LogEvent = {
    ts: v.ts,
    session: v.session,
    host: v.host,
    kind: v.kind,
    ...(v.tool === undefined ? {} : { tool: scrub(v.tool) }),
    text: truncate(scrub(v.text), BUDGETS.maxEventChars),
    ...(v.refs === undefined ? {} : { refs: v.refs.map(scrub) }),
  };
  const file = logFile(v.session, root);
  mkdirSync(dirname(file), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(clean)}\n`, 'utf8');
  const fd = openSync(file, 'a');
  let before: number;
  try {
    before = fstatSync(fd).size;
    appendFileSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
  const all = readFileSync(file);
  let at = all.indexOf(bytes, before);
  while (at > 0 && all[at - 1] !== NL) at = all.indexOf(bytes, at + 1);
  if (at < 0) throw new Error(`appended line not found in ${file}`);
  let line = 1;
  for (let i = all.indexOf(NL); i !== -1 && i < at; i = all.indexOf(NL, i + 1)) line += 1;
  return line;
}

export interface LogLine {
  line: number;
  event: LogEvent;
}

/** Position in a log file after the last complete line read. */
export interface LogCursor {
  offset: number; // bytes
  line: number;   // lines consumed so far
}

/**
 * Reads complete lines after `from`. Lines that do not parse are skipped but still counted, so line
 * numbers always match the file. A trailing partial line is left for the next read.
 */
export function readLogSince(session: string, from: LogCursor, root: string = memoryRoot()): { entries: LogLine[]; cursor: LogCursor } {
  const file = logFile(session, root);
  if (!existsSync(file)) return { entries: [], cursor: from };
  const fd = openSync(file, 'r');
  let chunk: Buffer;
  try {
    const size = fstatSync(fd).size;
    chunk = Buffer.alloc(Math.max(size - from.offset, 0));
    readSync(fd, chunk, 0, chunk.length, from.offset);
  } finally {
    closeSync(fd);
  }
  const end = chunk.lastIndexOf(NL);
  if (end < 0) return { entries: [], cursor: from };
  const entries: LogLine[] = [];
  let line = from.line;
  for (const raw of chunk.subarray(0, end).toString('utf8').split('\n')) {
    line += 1;
    try {
      entries.push({ line, event: parseEvent(JSON.parse(raw)) });
    } catch {
      // A malformed line is kept out of results; its number stays reserved.
    }
  }
  return { entries, cursor: { offset: from.offset + end + 1, line } };
}

export function* readLog(session: string, root: string = memoryRoot()): Generator<LogLine> {
  yield* readLogSince(session, { offset: 0, line: 0 }, root).entries;
}

function listIds(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => f.slice(0, -ext.length))
    .filter(isSafeId)
    .sort();
}

export function listSessions(root: string = memoryRoot()): string[] {
  return listIds(inside(root, LAYOUT.log), '.jsonl');
}

// ---------------------------------------------------------------- notes

export type NoteLayer = 'notes' | 'past';

const EVIDENCE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127}):(\d+)-(\d+)$/;
const NOTE_KEYS = ['id', 'about', 'evidence', 'verified', 'seen', 'checked', 'origin'] as const;

function isEvidence(ref: string): boolean {
  const m = EVIDENCE.exec(ref);
  return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= Number(m[3]);
}

function validateNote(x: Record<string, unknown>): Note {
  const { id, about, body, evidence, verified, seen, checked, origin } = x;
  if (typeof id !== 'string') throw new Error('note id must be a string');
  assertSafeId(id, 'note id');
  if (typeof about !== 'string' || about.trim() === '') throw new Error('note about must be a non-empty string');
  if (typeof body !== 'string') throw new Error('note body must be a string');
  if (!Array.isArray(evidence) || !evidence.every((r): r is EvidenceRef => typeof r === 'string' && isEvidence(r))) {
    throw new Error('note evidence must be an array of "<session>:<first>-<last>" refs');
  }
  if (typeof verified !== 'boolean') throw new Error('note verified must be a boolean');
  if (typeof seen !== 'number' || !Number.isInteger(seen) || seen < 0) throw new Error('note seen must be a non-negative integer');
  if (checked !== undefined && !(typeof checked === 'string' && /^\d{4}-\d{2}-\d{2}/.test(checked) && !Number.isNaN(Date.parse(checked)))) {
    throw new Error('note checked must be an ISO date');
  }
  if (origin !== 'session' && origin !== 'past') throw new Error('note origin must be "session" or "past"');
  return { id, about, body, evidence, verified, seen, ...(checked === undefined ? {} : { checked }), origin };
}

function layerOf(origin: NoteOrigin): NoteLayer {
  return origin === 'past' ? 'past' : 'notes';
}

function noteFile(id: string, layer: NoteLayer, root: string): string {
  assertSafeId(id, 'note id');
  return inside(root, LAYOUT[layer], `${id}.md`);
}

// Every value is written as JSON, which is also valid YAML, so the parser is JSON.parse per line.
function formatNote(n: Note): string {
  const head = NOTE_KEYS.flatMap((k) => (n[k] === undefined ? [] : [`${k}: ${JSON.stringify(n[k])}`]));
  return `---\n${head.join('\n')}\n---\n${n.body}\n`;
}

function parseNote(text: string, where: string): Note {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${where}: missing frontmatter`);
  const fields: Record<string, unknown> = {};
  for (const row of m[1].split('\n')) {
    const kv = /^([a-z]+): (.*)$/.exec(row);
    if (!kv || !(NOTE_KEYS as readonly string[]).includes(kv[1])) throw new Error(`${where}: bad frontmatter line ${JSON.stringify(row)}`);
    try {
      fields[kv[1]] = JSON.parse(kv[2]);
    } catch {
      throw new Error(`${where}: bad value for ${kv[1]}`);
    }
  }
  fields.body = m[2].endsWith('\n') ? m[2].slice(0, -1) : m[2];
  try {
    return validateNote(fields);
  } catch (err) {
    throw new Error(`${where}: ${(err as Error).message}`);
  }
}

/** Writes a note to `notes/` or, for `origin: past`, to `past/`; atomic via rename. Returns the file path. */
export function writeNote(note: Note, root: string = memoryRoot()): string {
  const n = validateNote({ ...note });
  const file = noteFile(n.id, layerOf(n.origin), root);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, formatNote(n), 'utf8');
  renameSync(tmp, file);
  return file;
}

export function readNote(id: string, layer: NoteLayer, root: string = memoryRoot()): Note | undefined {
  const file = noteFile(id, layer, root);
  if (!existsSync(file)) return undefined;
  const note = parseNote(readFileSync(file, 'utf8'), file);
  if (note.id !== id || layerOf(note.origin) !== layer) throw new Error(`${file}: id or origin does not match its location`);
  return note;
}

export function listNotes(layer: NoteLayer, root: string = memoryRoot()): Note[] {
  return listIds(inside(root, LAYOUT[layer]), '.md').flatMap((id) => readNote(id, layer, root) ?? []);
}

// ---------------------------------------------------------------- ULID

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = -1;
let lastRandom = 0n;

/** A 26-char ULID, monotonic within this process so ids sort in creation order. */
export function ulid(now: number = Date.now()): string {
  if (now <= lastTime) {
    lastRandom = (lastRandom + 1n) & ((1n << 80n) - 1n);
    now = lastTime;
  } else {
    lastTime = now;
    lastRandom = BigInt(`0x${randomBytes(10).toString('hex')}`);
  }
  let time = '';
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let rand = '';
  for (let r = lastRandom, i = 0; i < 16; i++, r >>= 5n) rand = CROCKFORD[Number(r & 31n)] + rand;
  return time + rand;
}

// ---------------------------------------------------------------- adding notes (mem note, MCP note)

export interface AddNoteInput {
  about: string;
  body: string;
  evidence?: readonly string[];
}

export interface AddNoteResult {
  id: string;
  merged: boolean;      // true when the fact matched an existing note and only evidence was added
  hypothesis: boolean;  // true when the stored note has no evidence
  evidence: EvidenceRef[];
}

/** Lines in log/<session>.jsonl, or undefined when there is no log for that session. */
function logLineCount(session: string, root: string): number | undefined {
  if (!existsSync(logFile(session, root))) return undefined;
  return readLogSince(session, { offset: 0, line: 0 }, root).cursor.line;
}

/**
 * Checks each ref against the log: the session must have a log and the range must lie inside it.
 * `<session>:<n>` (the `source` of a log search hit) is accepted as `<session>:<n>-<n>`. Returns the refs
 * normalized and de-duplicated, in input order.
 */
export function checkEvidence(refs: readonly string[], root: string = memoryRoot()): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  for (const raw of refs) {
    const ref = /^[^:]+:\d+$/.test(raw) ? `${raw}-${raw.slice(raw.lastIndexOf(':') + 1)}` : raw;
    const m = EVIDENCE.exec(ref);
    if (!m || !isEvidence(ref)) throw new Error(`evidence ${JSON.stringify(raw.slice(0, 140))} must be "<session>:<first>-<last>" with 1 <= first <= last`);
    const lines = logLineCount(m[1], root);
    if (lines === undefined) throw new Error(`evidence ${ref}: no log for session ${m[1]}`);
    if (Number(m[3]) > lines) throw new Error(`evidence ${ref}: log ${m[1]} has ${lines} line${lines === 1 ? '' : 's'}`);
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

// Duplicate guard: two facts are the same when they match after lower-casing, collapsing whitespace and
// dropping trailing punctuation. Deliberately not fuzzy: a reworded fact is a different note, and dream is
// the place to reconcile those against the log.
function sameFact(a: string): string {
  return a.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!;,\s]+$/, '');
}

/**
 * Writes one session note (`origin: session`, `verified: false`; only dream verifies). Evidence is checked
 * against the log first. Body and about are scrubbed of secrets like log text. If a note in `notes/` has
 * the same `about` and the same fact, no second file is made: the new evidence is merged into it and its
 * id is returned with `merged: true`.
 */
export function addNote(input: AddNoteInput, root: string = memoryRoot()): AddNoteResult {
  const about = scrub(input.about.trim());
  const body = scrub(input.body.trim());
  if (about === '') throw new Error('about must name what the fact is about');
  if (body === '') throw new Error('the fact text is empty');
  if (about.length > 200) throw new Error('about must be at most 200 characters');
  if (body.length > BUDGETS.maxEventChars) throw new Error(`the fact must be at most ${BUDGETS.maxEventChars} characters; store one fact per note`);
  const evidence = checkEvidence(input.evidence ?? [], root);

  const existing = listNotes('notes', root).find((n) => sameFact(n.about) === sameFact(about) && sameFact(n.body) === sameFact(body));
  if (existing) {
    const merged = [...existing.evidence, ...evidence.filter((r) => !existing.evidence.includes(r))];
    if (merged.length !== existing.evidence.length) {
      writeNote({ ...existing, evidence: merged, seen: Math.max(existing.seen, merged.length > 0 ? 1 : 0) }, root);
    }
    return { id: existing.id, merged: true, hypothesis: merged.length === 0, evidence: merged };
  }

  const id = ulid();
  writeNote({ id, about, body, evidence, verified: false, seen: evidence.length > 0 ? 1 : 0, origin: 'session' }, root);
  return { id, merged: false, hypothesis: evidence.length === 0, evidence };
}
