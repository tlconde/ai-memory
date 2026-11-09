// Shared plumbing for every host adapter, so each adapter is only a payload mapping.
// run(map) reads one hook payload from stdin, asks map() for LogEvents, pipes them to `mem log`
// and, when map() asks for it, prints the host's injection of `mem index`.
// A memory failure must never disturb the session: run() always exits 0 and reports on stderr.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The store truncates to BUDGETS.maxEventChars as well; cutting here keeps huge tool output off the pipe.
export const MAX_TEXT = 8000;
// Claude Code gives SessionEnd hooks 1.5 s in total and Codex 3 s, and the hook pays Node startup twice.
const MEM_TIMEOUT_MS = 1000;
const DAY_MS = 86_400_000;

export const clip = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? null)).slice(0, MAX_TEXT);
// Tool responses are objects such as {stdout, stderr} or {file: {content}}. Their string fields are
// joined rather than JSON-encoded, because escaped newlines would glue words together for full-text search.
const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
export const readable = (v) => clip(strings(v).filter(Boolean).join('\n') || v);
// The store accepts [A-Za-z0-9._-], starting alphanumeric, at most 128 characters.
export const safeId = (s) => String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^(?=[^A-Za-z0-9])/, 'x').slice(0, 128);

/** The memory root `mem` will use when run in `cwd`. */
export const memRoot = (cwd) => (process.env.MEM_ROOT ? resolve(cwd, process.env.MEM_ROOT) : join(cwd, '.memory'));

/** Adapter scratch state. Under log/ so it is gitignored with the log; the store reads only *.jsonl there. */
export function stateDir(cwd) {
  const dir = join(memRoot(cwd), 'log', '.adapters');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** True for the first caller with this key. O_EXCL makes it safe when two copies of a hook race. */
export function firstTime(cwd, key) {
  const file = join(stateDir(cwd), `seen-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`);
  try {
    closeSync(openSync(file, 'wx'));
    return true;
  } catch (e) {
    return e?.code !== 'EEXIST'; // any other error: log rather than lose the event
  }
}

/** Removes dedupe and per-session markers older than a day; called at session start. */
function prune(cwd) {
  const dir = stateDir(cwd);
  for (const f of readdirSync(dir)) {
    if (/^(seen|live)-/.test(f) && Date.now() - statSync(join(dir, f)).mtimeMs > DAY_MS) rmSync(join(dir, f), { force: true });
  }
}

export function mem(args, input, cwd) {
  const r = spawnSync(process.env.MEM_BIN || 'mem', args, { input, cwd, encoding: 'utf8', timeout: MEM_TIMEOUT_MS });
  if (r.error || r.status !== 0) {
    process.stderr.write(`ai-memory: mem ${args[0]} failed: ${r.error?.message ?? (r.stderr.trim() || `exit ${r.status}`)}\n`);
    return null;
  }
  return r.stdout;
}

/** True when this module is the script node was started with (so an adapter can also be imported). */
export const isMain = (url) => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
};

/**
 * map(payload, env) returns null or
 * { host, session, cwd, events: [{kind, tool?, text, refs?}], refs?, inject?: (index) => stdout }.
 * `refs` is added to every event.
 */
export async function run(map) {
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const r = map(JSON.parse(raw), process.env);
    if (!r) return;
    const { host, cwd, events = [], refs = [], inject } = r;
    const session = safeId(r.session);
    const ts = new Date().toISOString();
    if (events.some((e) => e.kind === 'session_start')) prune(cwd);
    const lines = events.map((e) => {
      const all = [...(e.refs ?? []), ...refs];
      return JSON.stringify({ ts, session, host, ...e, ...(all.length && { refs: all }) });
    });
    if (lines.length) mem(['log'], lines.join('\n') + '\n', cwd);
    if (inject) {
      const index = mem(['index'], '', cwd)?.trim();
      if (index) process.stdout.write(inject(index));
    }
  } catch (e) {
    process.stderr.write(`ai-memory: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
