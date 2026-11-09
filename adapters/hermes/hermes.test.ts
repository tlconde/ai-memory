// Runs the Hermes provider's Python unittest suite so `npm test` covers it.
// The suite runs under python3, and again under Hermes' own interpreter when Hermes is installed,
// because only that one has the dependencies to import Hermes' real plugin loader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dir = import.meta.dirname;
const hermesPython = join(process.env.HERMES_AGENT_DIR ?? join(homedir(), '.hermes', 'hermes-agent'), 'venv', 'bin', 'python');

function unittest(python: string) {
  return spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-v'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
}

const python3 = spawnSync('python3', ['--version']).status === 0;

test('Hermes provider unittest suite passes under python3', { skip: !python3 && 'python3 is not on PATH' }, () => {
  const r = unittest('python3');
  assert.equal(r.status, 0, r.stderr);
});

test("Hermes provider unittest suite passes under Hermes' interpreter", { skip: !existsSync(hermesPython) && `Hermes not installed (${hermesPython})` }, () => {
  const r = unittest(hermesPython);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /test_hermes_loads_and_drives_the_provider .* skipped/);
});
