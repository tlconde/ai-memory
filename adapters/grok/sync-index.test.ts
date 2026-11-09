import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runHook, tempDir } from '../_shared/harness.ts';

const SCRIPT = join(import.meta.dirname, 'sync-index.mjs');
const rule = (project: string) => join(project, '.grok/rules/ai-memory-index.md');

test('writes mem index to .grok/rules/ai-memory-index.md, running mem in the project', () => {
  const project = tempDir();
  const r = runHook(SCRIPT, '', { FAKE_MEM_INDEX: '# Index\n- fact' }, [project]);
  assert.deepEqual([r.status, r.stderr], [0, '']);
  assert.deepEqual(r.calls.map((c) => [c.args, c.cwd]), [[['index'], project]]);
  assert.equal(readFileSync(rule(project), 'utf8'), '# Index\n- fact\n');
});

test('an empty index removes the rule; a failing mem leaves it and still exits 0', () => {
  const project = tempDir();
  runHook(SCRIPT, '', { FAKE_MEM_INDEX: '# Index' }, [project]);
  const failed = runHook(SCRIPT, '', { FAKE_MEM_FAIL: '1' }, [project]);
  assert.equal(failed.status, 0);
  assert.match(failed.stderr, /^ai-memory: /);
  assert.ok(existsSync(rule(project)));
  runHook(SCRIPT, '', { FAKE_MEM_INDEX: '\n' }, [project]);
  assert.ok(!existsSync(rule(project)));
});
