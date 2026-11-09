#!/usr/bin/env node
// `mem`: the command line. `log` and `index` are the contract host adapters call; keep them stable.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dream, formatLint, formatReport as formatDream, lint, reportJson } from './dream.js';
import { RANKINGS, reindex, runEval, search, type EvalReport, type Ranking } from './search.js';
import { addNote, appendEvent, importPast, inside, memoryRoot, parseEvent } from './store.js';
import { LAYOUT, type LogEvent } from './types.js';

const USAGE = `usage: mem [--root <dir>] <command>

  log                         append LogEvent JSON lines from stdin (host adapters)
  index                       print INDEX.md, if any (host adapters, session start)
  search <query> [--limit N] [--json]
                              search log, notes, wiki and past
  note --about <entity> [--evidence <session>:<a>-<b>]... [--json] <fact | ->
                              store one fact (- reads it from stdin); prints its id
  dream [--dry-run] [--json] [--model-cmd <cmd>]
                              re-check notes, promote to wiki, rebuild INDEX.md;
                              --dry-run prints the changeset and writes nothing;
                              --model-cmd (opt-in, costs tokens) asks <cmd> about
                              notes the heuristic cannot decide
  lint [--json]               exit 1 if INDEX.md or wiki/ break their budgets
  eval [--suite <dir>] [--ranking weighted|tiers] [--min-hit-rate X] [--json]
                              replay a suite (default: the bundled eval/suites/default)
                              and report hit rate, MRR, index tokens and fact survival;
                              exits 1 if the hit rate is below X (0 to 1)
  import-past <dir> [--dry-run] [--json]
                              import an old .ai/ directory as unverified past findings
  mcp                         run the MCP server (tools: search, note) on stdio

  --root <dir>  memory root (default $MEM_ROOT, else ./.memory)
`;

class UsageError extends Error {}

// Every option, once. `only()` checks which ones a command accepts, so a flag meant for one verb is
// never silently ignored by another.
const VALUED = {
  '--root': 'root',
  '--limit': 'limit',
  '--suite': 'suite',
  '--ranking': 'ranking',
  '--min-hit-rate': 'minHitRate',
  '--about': 'about',
  '--model-cmd': 'modelCmd',
} as const;
type Valued = (typeof VALUED)[keyof typeof VALUED];
type Option = Exclude<Valued, 'root'> | 'evidence' | 'json' | 'dryRun' | 'positionals';

interface Args extends Partial<Record<Valued, string>> {
  command: string | undefined;
  positionals: string[];
  evidence: string[];
  json: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { command: undefined, positionals: [], evidence: [], json: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      args.positionals.push(...argv.slice(i + 1));
      break;
    }
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (Object.hasOwn(VALUED, flag) || flag === '--evidence') {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new UsageError(`${flag} needs a value`);
      if (flag === '--evidence') args.evidence.push(value);
      else args[VALUED[flag as keyof typeof VALUED]] = value;
    } else if (flag === '--json' && inline === undefined) {
      args.json = true;
    } else if (flag === '--dry-run' && inline === undefined) {
      args.dryRun = true;
    } else if ((flag === '--help' || flag === '-h') && inline === undefined) {
      args.help = true;
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new UsageError(`unknown option ${flag}`);
    } else if (args.command === undefined) {
      args.command = arg;
    } else {
      args.positionals.push(arg);
    }
  }
  return args;
}

const FLAG_OF: Record<Exclude<Option, 'positionals'>, string> = {
  limit: '--limit',
  suite: '--suite',
  ranking: '--ranking',
  minHitRate: '--min-hit-rate',
  about: '--about',
  modelCmd: '--model-cmd',
  evidence: '--evidence',
  json: '--json',
  dryRun: '--dry-run',
};

function only(args: Args, allowed: readonly Option[]): void {
  const command = args.command ?? '';
  for (const [option, flag] of Object.entries(FLAG_OF) as [Exclude<Option, 'positionals'>, string][]) {
    const value = args[option];
    const set = Array.isArray(value) ? value.length > 0 : value !== undefined && value !== false;
    if (set && !allowed.includes(option)) throw new UsageError(`${command} takes no ${flag}`);
  }
  if (!allowed.includes('positionals') && args.positionals.length > 0) throw new UsageError(`${command} takes no arguments`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// All lines are validated before any is written, so a rejected batch leaves the log untouched and the
// adapter can retry without duplicates. Errors never echo input, which may hold the secrets being scrubbed.
async function cmdLog(root: string): Promise<void> {
  const events: LogEvent[] = [];
  const lines = (await readStdin()).split('\n');
  for (const [i, raw] of lines.entries()) {
    if (raw.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(`line ${i + 1}: not valid JSON`);
    }
    try {
      events.push(parseEvent(value));
    } catch (err) {
      throw new Error(`line ${i + 1}: ${(err as Error).message}`);
    }
  }
  for (const e of events) appendEvent(e, root);
}

function cmdSearch(args: Args, root: string): void {
  const query = args.positionals.join(' ').trim();
  if (query === '') throw new UsageError('search needs a query');
  let limit: number | undefined;
  if (args.limit !== undefined) {
    limit = Number(args.limit);
    if (!/^\d+$/.test(args.limit) || limit < 1 || limit > 1000) throw new UsageError('--limit must be an integer from 1 to 1000');
  }
  reindex(root);
  const hits = search(query, { root, ...(limit === undefined ? {} : { limit }) });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(hits)}\n`);
    return;
  }
  for (const h of hits) process.stdout.write(`${h.layer} ${h.source}  ${h.snippet}\n`);
}

const DEFAULT_SUITE = fileURLToPath(new URL('../eval/suites/default', import.meta.url));

const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

function formatEval(suite: string, r: EvalReport): string {
  const { retrieval: q, index, facts } = r;
  const rel = relative(process.cwd(), suite);
  const rows = [
    ['suite', `${rel === '' || rel.startsWith('..') || isAbsolute(rel) ? suite : rel} (${r.sessions} sessions)`],
    ['ranking', r.ranking],
    ['hit rate', `${pct(q.hitRate)}  ${q.hits}/${q.queries} queries with an expected source in the top k`],
    ['MRR', q.mrr === null ? 'n/a' : q.mrr.toFixed(3)],
    ['index', `${index.tokens} tokens (estimate, ceil(chars/4); budget ${index.budget})`],
    ['facts', `${pct(facts.rate)}  ${facts.survived}/${facts.total} survive in notes or wiki`],
  ];
  const out = rows.map(([k, v]) => `${k.padEnd(10)}${v}`);
  for (const m of r.misses) out.push(`miss      ${JSON.stringify(m.q)} expected ${m.expect.join(' | ')}; got ${m.got.join(', ') || 'nothing'}`);
  return `${out.join('\n')}\n`;
}

function cmdEval(args: Args): number {
  const suite = resolve(args.suite ?? DEFAULT_SUITE);
  if (args.ranking !== undefined && !(RANKINGS as readonly string[]).includes(args.ranking)) {
    throw new UsageError(`--ranking must be one of ${RANKINGS.join(', ')}`);
  }
  let min: number | undefined;
  if (args.minHitRate !== undefined) {
    min = Number(args.minHitRate);
    if (args.minHitRate.trim() === '' || !Number.isFinite(min) || min < 0 || min > 1) throw new UsageError('--min-hit-rate must be a number from 0 to 1');
  }
  const report = runEval(suite, { ranking: (args.ranking ?? 'weighted') as Ranking });
  process.stdout.write(args.json ? `${JSON.stringify({ suite, ...report })}\n` : formatEval(suite, report));
  if (min === undefined) return 0;
  // No queries means no hit rate, which cannot clear a gate.
  const rate = report.retrieval.hitRate;
  if (rate !== null && rate >= min) return 0;
  process.stderr.write(`mem eval: hit rate ${pct(rate)} is below --min-hit-rate ${min}\n`);
  return 1;
}

// Evidence is checked against the log inside addNote, so a bad ref fails before anything is written.
async function cmdNote(args: Args, root: string): Promise<void> {
  if (args.about === undefined) throw new UsageError('note needs --about <entity>');
  const fromStdin = args.positionals.length === 1 && args.positionals[0] === '-';
  if (!fromStdin && args.positionals.includes('-')) throw new UsageError('note takes the fact as arguments or "-" alone for stdin');
  const body = fromStdin ? await readStdin() : args.positionals.join(' ');
  if (body.trim() === '') throw new UsageError('note needs the fact text, or - to read it from stdin');
  const result = addNote({ about: args.about, body, evidence: args.evidence }, root);
  if (result.merged) process.stderr.write(`mem note: same fact as ${result.id}; merged the evidence into it\n`);
  if (result.hypothesis) process.stderr.write('mem note: no evidence, stored as a hypothesis; cite log lines with --evidence <session>:<a>-<b>\n');
  process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${result.id}\n`);
}

function cmdImportPast(args: Args, root: string): void {
  if (args.positionals.length !== 1) throw new UsageError('import-past needs exactly one directory');
  const result = importPast(args.positionals[0], { root, dryRun: args.dryRun });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const bySource = new Map<string, Record<string, number>>();
  for (const e of result.entries) {
    const row = bySource.get(e.file) ?? { imported: 0, duplicate: 0, empty: 0 };
    row[e.status] += 1;
    bySource.set(e.file, row);
  }
  const total = result.entries.filter((e) => e.status === 'imported').length;
  const verb = result.dryRun ? 'would import' : 'imported';
  process.stdout.write(`${verb} ${total} past findings from ${bySource.size} files${result.dryRun ? ' (dry run, nothing written)' : ''}\n`);
  for (const [file, row] of bySource) process.stdout.write(`  ${file}  imported ${row.imported}  duplicate ${row.duplicate}  empty ${row.empty}\n`);
  if (result.dryRun) for (const e of result.entries) if (e.status === 'imported') process.stdout.write(`  + ${e.file}#${e.heading}\n`);
  // Skipped files are listed by reason; long lists (dependencies, assets) are cut to a count.
  const byReason = new Map<string, string[]>();
  for (const s of result.skipped) byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s.file]);
  if (byReason.size > 0) process.stdout.write('skipped:\n');
  for (const [reason, files] of byReason) {
    const shown = files.length > 5 ? `${files.slice(0, 3).join(', ')} and ${files.length - 3} more` : files.join(', ');
    process.stdout.write(`  ${reason} (${files.length}): ${shown}\n`);
  }
}

function cmdIndex(root: string): void {
  const file = inside(root, LAYOUT.index);
  if (existsSync(file)) process.stdout.write(readFileSync(file, 'utf8'));
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      process.stdout.write(USAGE);
      return 0;
    }
    const root = args.root === undefined ? memoryRoot() : resolve(args.root);
    switch (args.command) {
      case 'log':
        only(args, []);
        await cmdLog(root);
        return 0;
      case 'search':
        only(args, ['limit', 'json', 'positionals']);
        cmdSearch(args, root);
        return 0;
      case 'index':
        only(args, []);
        cmdIndex(root);
        return 0;
      case 'note':
        only(args, ['about', 'evidence', 'json', 'positionals']);
        await cmdNote(args, root);
        return 0;
      case 'dream': {
        only(args, ['json', 'dryRun', 'modelCmd']);
        const report = dream({ root, dryRun: args.dryRun, ...(args.modelCmd === undefined ? {} : { modelCmd: args.modelCmd }) });
        process.stdout.write(args.json ? `${JSON.stringify(reportJson(report))}\n` : formatDream(report));
        return 0;
      }
      case 'lint': {
        only(args, ['json']);
        const result = lint(root);
        process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : formatLint(result));
        return result.ok ? 0 : 1;
      }
      case 'eval':
        only(args, ['json', 'suite', 'ranking', 'minHitRate']);
        return cmdEval(args);
      case 'import-past':
        only(args, ['json', 'positionals', 'dryRun']);
        cmdImportPast(args, root);
        return 0;
      case 'mcp':
        only(args, []);
        // Loaded lazily: `mem log` runs on every hook call and should not pay for the SDK.
        await (await import('./mcp.js')).serve(root);
        return 0;
      case undefined:
        throw new UsageError('missing command');
      default:
        throw new UsageError(`unknown command ${args.command}`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`mem: ${err.message}\n\n${USAGE}`);
      return 2;
    }
    process.stderr.write(`mem: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
