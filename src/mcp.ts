// The MCP server: exactly two tools, `search` and `note`, over stdio. See SPEC.md 3.3 and 3.6.
// No resources and no prompts: the log is reached through search, and INDEX.md is injected by the host adapter.

import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';
import { reindex, search } from './search.js';
import { addNote, memoryRoot } from './store.js';

// Descriptions steer by purpose, not by rules or categories: the article found fixed rules weaken strong models.
export const SEARCH_DESCRIPTION =
  "Search this project's memory: the transcript log of past sessions, notes, the wiki and imported past findings. " +
  'Log hits are the record of what actually happened; notes and past findings are leads, and unverified ones may be stale or wrong. ' +
  'Before you rely on or repeat something from memory, search the log to confirm it.';

export const NOTE_DESCRIPTION =
  'Keep one fact for future sessions. Store only what the environment does not already show: code, git history and docs can be read again. ' +
  'Cite the log lines that support it as evidence ("<session>:<first>-<last>", or a log hit\'s source); a fact without evidence is stored as a hypothesis.';

const LAYER = z.enum(['log', 'notes', 'wiki', 'past']);

function version(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string') return pkg.version;
  } catch {
    // Fall through: the version is informational only.
  }
  return '0.0.0';
}

function reply(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function failure(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] };
}

/** Builds the server for one memory root; `serve` connects it to stdio. Exported for tests. */
export function createServer(root: string = memoryRoot()): McpServer {
  const server = new McpServer({ name: 'ai-memory', version: version() });

  server.registerTool(
    'search',
    {
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().min(1).describe('Words to look for'),
        limit: z.number().int().min(1).max(100).optional().describe('Most hits to return (default 10)'),
        layers: z.array(LAYER).optional().describe('Layers to search (default all)'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, limit, layers }) => {
      try {
        reindex(root);
        const hits = search(query, { root, ...(limit === undefined ? {} : { limit }), ...(layers === undefined ? {} : { layers }) });
        return reply(hits.map(({ layer, source, snippet, verified }) => ({ layer, source, snippet, ...(verified === undefined ? {} : { verified }) })));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    'note',
    {
      description: NOTE_DESCRIPTION,
      inputSchema: {
        about: z.string().min(1).describe('The entity the fact is about'),
        fact: z.string().min(1).describe('The fact, in plain words'),
        evidence: z.array(z.string()).optional().describe('Log lines that support it, e.g. "s1:12-14"'),
      },
    },
    ({ about, fact, evidence }) => {
      try {
        const result = addNote({ about, body: fact, evidence: evidence ?? [] }, root);
        return reply({
          id: result.id,
          ...(result.merged ? { merged: true } : {}),
          ...(result.hypothesis ? { warning: 'no evidence: stored as a hypothesis; cite log lines to support it' } : {}),
        });
      } catch (err) {
        return failure(err);
      }
    },
  );

  return server;
}

/** Runs the server on stdin/stdout until the client disconnects. Nothing else may write to stdout. */
export async function serve(root: string = memoryRoot()): Promise<void> {
  const server = createServer(root);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((done) => {
    transport.onclose = done;
    process.stdin.once('end', done);
  });
  await server.connect(transport);
  await closed;
  await server.close();
}
