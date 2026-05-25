import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AMP_CLI_INVOCATION_DIRECT,
  AMP_CLI_INVOCATION_ENV,
} from "./invocation-mode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = join(__dirname, "index.ts");
const AMP_ENTRY = join(__dirname, "amp-entry.ts");

type CliExecError = NodeJS.ErrnoException & {
  status?: number | null;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
};

function runCli(
  args: string[],
  options: {
    entryPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {}
): string {
  const entryPath = options.entryPath ?? CLI_ENTRY;
  return execFileSync(process.execPath, ["--import", "tsx", entryPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      ...options.env,
    },
  });
}

function runCliExpectFailure(
  args: string[],
  options: {
    entryPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {}
): CliExecError {
  try {
    runCli(args, options);
    assert.fail("expected CLI invocation to fail");
  } catch (error) {
    return error as CliExecError;
  }
}

function createAmpBinSymlink(): string {
  const binDir = join(tmpdir(), `amp-cli-bin-${process.pid}-${Date.now()}`);
  mkdirSync(binDir, { recursive: true });
  const ampLink = join(binDir, "amp");
  symlinkSync(AMP_ENTRY, ampLink);
  assert.equal(lstatSync(ampLink).isSymbolicLink(), true);
  return ampLink;
}

describe("ai-memory amp CLI shell", () => {
  it("registers amp --help without breaking root --version", () => {
    const ampHelp = runCli(["amp", "--help"]);
    assert.match(ampHelp, /Agent Memory Protocol/);
    assert.match(ampHelp, /status/);

    const version = runCli(["--version"]);
    assert.match(version, /\d+\.\d+\.\d+/);
  });

  it("runs amp status shell subcommand", () => {
    const out = runCli(["amp", "status"]);
    assert.match(out, /AMP CLI shell v/);
    assert.match(out, /capture, consolidate, retrieve, propagate/);
  });
});

describe("amp direct CLI binary", () => {
  it("lists AMP commands at root for amp --help", () => {
    const ampLink = createAmpBinSymlink();
    const help = runCli(["--help"], { entryPath: ampLink });

    assert.match(help, /Agent Memory Protocol/);
    assert.match(help, /\binit\b/);
    assert.match(help, /\bdoctor\b/);
    assert.match(help, /\bcapture\b/);
    assert.match(help, /\bconsolidate\b/);
    assert.match(help, /\bretrieve\b/);
    assert.match(help, /\bstatus\b/);
    assert.doesNotMatch(help, /\bamp amp\b/);
  });

  it("runs amp status without an amp prefix via amp-entry", () => {
    const ampLink = createAmpBinSymlink();
    const out = runCli(["status"], { entryPath: ampLink });
    assert.match(out, /AMP CLI shell v/);
  });

  it("runs amp status when argv[1] is index.js and env flag is set", () => {
    const out = runCli(["status"], {
      entryPath: CLI_ENTRY,
      env: {
        [AMP_CLI_INVOCATION_ENV]: AMP_CLI_INVOCATION_DIRECT,
      },
    });
    assert.match(out, /AMP CLI shell v/);
  });

  it("does not treat amp amp as the expected invocation path", () => {
    const ampLink = createAmpBinSymlink();
    const err = runCliExpectFailure(["amp", "status"], { entryPath: ampLink });
    assert.notEqual(err.status, 0);
    const output = String(err.stderr ?? err.stdout ?? "");
    assert.match(output, /unknown command/i);
  });

  it("keeps ai-memory amp --help working", () => {
    const help = runCli(["amp", "--help"]);
    assert.match(help, /Agent Memory Protocol/);
    assert.match(help, /status/);
  });
});
