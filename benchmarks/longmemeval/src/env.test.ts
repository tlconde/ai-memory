import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvContent } from "./env.js";

test("env: parses plain KEY=value", () => {
  const out = parseEnvContent(`FOO=bar\nBAZ=qux\n`);
  assert.deepEqual(out, { FOO: "bar", BAZ: "qux" });
});

test("env: ignores blank lines and comments", () => {
  const out = parseEnvContent(`
# a comment
FOO=1

# another
BAR=2
`);
  assert.deepEqual(out, { FOO: "1", BAR: "2" });
});

test("env: double-quoted value preserves spaces and decodes \\n", () => {
  const out = parseEnvContent(`MSG="hello world"\nMULTI="a\\nb"\n`);
  assert.equal(out.MSG, "hello world");
  assert.equal(out.MULTI, "a\nb");
});

test("env: single-quoted value is literal", () => {
  const out = parseEnvContent(`PATH='a\\nb'\n`);
  assert.equal(out.PATH, "a\\nb");
});

test("env: strips inline `#` comment on unquoted value", () => {
  const out = parseEnvContent(`FOO=bar # trailing\n`);
  assert.equal(out.FOO, "bar");
});

test("env: skips malformed keys", () => {
  const out = parseEnvContent(`1BAD=x\nGOOD=y\n`);
  assert.deepEqual(out, { GOOD: "y" });
});
