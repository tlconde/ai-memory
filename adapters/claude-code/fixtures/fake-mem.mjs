#!/usr/bin/env node
// Stands in for the real `mem` CLI: records each call as one JSON line in $FAKE_MEM_OUT.
import { appendFileSync } from 'node:fs';

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
appendFileSync(process.env.FAKE_MEM_OUT, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdin }) + '\n');
if (process.env.FAKE_MEM_FAIL) process.exit(1);
if (process.env.FAKE_MEM_HANG) await new Promise((r) => setTimeout(r, 10_000));
if (process.argv[2] === 'index') process.stdout.write(process.env.FAKE_MEM_INDEX ?? '');
