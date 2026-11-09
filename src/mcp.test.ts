import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { appendEvent } from './store.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));

const dir = mkdtempSync(join(tmpdir(), 'mem-mcp-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function text(result: unknown): string {
  const { content } = result as CallToolResult;
  const first = content[0];
  assert.equal(first?.type, 'text');
  return first.type === 'text' ? first.text : '';
}

test('mem mcp: a real stdio server with exactly search and note', async () => {
  const root = join(dir, '.memory');
  appendEvent({ ts: '2026-11-09T10:00:00Z', session: 's1', host: 'claude-code', kind: 'tool_result', text: 'pnpm test fails without the redis container' }, root);

  const { MEM_ROOT: _drop, ...env } = process.env;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', CLI, 'mcp'],
    cwd: REPO,
    env: { ...(env as Record<string, string>), MEM_ROOT: root },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mem-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    const caps = client.getServerCapabilities();
    assert.ok(caps?.tools);
    assert.equal(caps?.resources, undefined);
    assert.equal(caps?.prompts, undefined);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['note', 'search']);
    const search = tools.find((t) => t.name === 'search');
    assert.deepEqual(search?.inputSchema.required, ['query']);
    assert.match(search?.description ?? '', /search the log to confirm/);
    assert.deepEqual(tools.find((t) => t.name === 'note')?.inputSchema.required, ['about', 'fact']);

    const noted = JSON.parse(text(await client.callTool({ name: 'note', arguments: { about: 'tests', fact: 'Tests need the redis container running', evidence: ['s1:1'] } }))) as { id: string; warning?: string };
    assert.match(noted.id, /^[0-9A-Z]{26}$/);
    assert.equal(noted.warning, undefined);

    const hypothesis = JSON.parse(text(await client.callTool({ name: 'note', arguments: { about: 'ci', fact: 'CI caches node_modules' } }))) as { warning?: string };
    assert.match(hypothesis.warning ?? '', /stored as a hypothesis/);

    const bad = (await client.callTool({ name: 'note', arguments: { about: 'x', fact: 'y', evidence: ['s1:5-9'] } })) as CallToolResult;
    assert.equal(bad.isError, true);
    assert.match(text(bad), /log s1 has 1 line/);

    const hits = JSON.parse(text(await client.callTool({ name: 'search', arguments: { query: 'redis container' } }))) as Array<{ layer: string; source: string; snippet: string; verified?: boolean }>;
    assert.deepEqual(hits.map((h) => [h.layer, h.source]).sort(), [['log', 's1:1'], ['notes', noted.id]]);
    assert.equal(hits.find((h) => h.layer === 'notes')?.verified, false);
    assert.match(hits[0].snippet, /\*\*redis\*\*/);

    const onlyNotes = JSON.parse(text(await client.callTool({ name: 'search', arguments: { query: 'redis', layers: ['notes'], limit: 1 } }))) as unknown[];
    assert.equal(onlyNotes.length, 1);

    const invalid = (await client.callTool({ name: 'search', arguments: { query: 'redis', layers: ['secrets'] } })) as CallToolResult;
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
  }
});
