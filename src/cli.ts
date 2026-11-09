#!/usr/bin/env node
// `mem`: the command line. `log` and `index` are the contract host adapters call; keep them stable.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RANKINGS, reindex, runEval, search, type EvalReport, type Ranking } from './search.js';
import { appendEvent, inside, memoryRoot, parseEvent } from './store.js';
import { LAYOUT, type LogEvent } from './types.js';

const USAGE = `usage: mem [--root <dir>] <command>

  log                         append LogEvent JSON lines from stdin (host adapters)
  search <query> [--limit N] [--json]
                              search log, notes, wiki and past
  index                       print INDEX.md, if any (host adapters, session start)
  eval [--suite <dir>] [--ranking weighted|tiers] [--min-hit-rate X] [--json]
                              replay a suite (default: the bundled eval/suites/default)
                              and report hit rate, MRR, index tokens and fact survival;
                              exits 1 if the hit rate is below X (0 to 1)
  note | dream                not implemented yet

  --root <dir>  memory root (default $MEM_ROOT, else ./.memory)
`;

class UsageError extends Error {}

interface Args {
  command: string | undefined;
  positionals: string[];
  root: string | undefined;
  limit: string | undefined;
  suite: string | undefined;
  ranking: string | undefined;
  minHitRate: string | undefined;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { command: undefined, positionals: [], root: undefined, limit: undefined, suite: undefined, ranking: undefined, minHitRate: undefined, json: false, help: false };
  const valued = { '--root': 'root', '--limit': 'limit', '--suite': 'suite', '--ranking': 'ranking', '--min-hit-rate': 'minHitRate' } as const;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      args.positionals.push(...argv.slice(i + 1));
      break;
    }
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (Object.hasOwn(valued, flag)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new UsageError(`${flag} needs a value`);
      args[valued[flag as keyof typeof valued]] = value;
    } else if (flag === '--json' && inline === undefined) {
      args.json = true;
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

function only(args: Args, allowed: ReadonlyArray<'limit' | 'json' | 'positionals' | 'eval'>): void {
  const command = args.command ?? '';
  if (!allowed.includes('limit') && args.limit !== undefined) throw new UsageError(`${command} takes no --limit`);
  if (!allowed.includes('eval') && (args.suite ?? args.ranking ?? args.minHitRate) !== undefined) {
    throw new UsageError(`${command} takes no --suite, --ranking or --min-hit-rate`);
  }
  if (!allowed.includes('json') && args.json) throw new UsageError(`${command} takes no --json`);
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

function formatReport(suite: string, r: EvalReport): string {
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
  process.stdout.write(args.json ? `${JSON.stringify({ suite, ...report })}\n` : formatReport(suite, report));
  if (min === undefined) return 0;
  // No queries means no hit rate, which cannot clear a gate.
  const rate = report.retrieval.hitRate;
  if (rate !== null && rate >= min) return 0;
  process.stderr.write(`mem eval: hit rate ${pct(rate)} is below --min-hit-rate ${min}\n`);
  return 1;
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
      case 'eval':
        only(args, ['json', 'eval']);
        return cmdEval(args);
      case 'note':
      case 'dream':
        process.stderr.write(`mem ${args.command}: not implemented yet\n`);
        return 2;
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
