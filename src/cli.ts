#!/usr/bin/env node
// `mem`: the command line. `log` and `index` are the contract host adapters call; keep them stable.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reindex, search } from './search.js';
import { appendEvent, importPast, inside, memoryRoot, parseEvent } from './store.js';
import { LAYOUT, type LogEvent } from './types.js';

const USAGE = `usage: mem [--root <dir>] <command>

  log                         append LogEvent JSON lines from stdin (host adapters)
  search <query> [--limit N] [--json]
                              search log, notes, wiki and past
  index                       print INDEX.md, if any (host adapters, session start)
  import-past <dir> [--dry-run] [--json]
                              import an old .ai/ directory as unverified past findings
  note | dream | eval         not implemented yet

  --root <dir>  memory root (default $MEM_ROOT, else ./.memory)
`;

class UsageError extends Error {}

interface Args {
  command: string | undefined;
  positionals: string[];
  root: string | undefined;
  limit: string | undefined;
  json: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { command: undefined, positionals: [], root: undefined, limit: undefined, json: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      args.positionals.push(...argv.slice(i + 1));
      break;
    }
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (flag === '--root' || flag === '--limit') {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new UsageError(`${flag} needs a value`);
      if (flag === '--root') args.root = value;
      else args.limit = value;
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

function only(args: Args, allowed: ReadonlyArray<'limit' | 'json' | 'positionals' | 'dryRun'>): void {
  const command = args.command ?? '';
  if (!allowed.includes('dryRun') && args.dryRun) throw new UsageError(`${command} takes no --dry-run`);
  if (!allowed.includes('limit') && args.limit !== undefined) throw new UsageError(`${command} takes no --limit`);
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

function cmdIndex(root: string): void {
  const file = inside(root, LAYOUT.index);
  if (existsSync(file)) process.stdout.write(readFileSync(file, 'utf8'));
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
      case 'import-past':
        only(args, ['json', 'positionals', 'dryRun']);
        cmdImportPast(args, root);
        return 0;
      case 'note':
      case 'dream':
      case 'eval':
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
