import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = join(__dirname, "index.ts");

function runCli(args: string[], entryPath = CLI_ENTRY): string {
  return execFileSync(process.execPath, ["--import", "tsx", entryPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
}

function createAmpBinSymlink(): string {
  const binDir = join(tmpdir(), `amp-cli-bin-${process.pid}-${Date.now()}`);
  mkdirSync(binDir, { recursive: true });
  const ampLink = join(binDir, "amp");
  symlinkSync(CLI_ENTRY, ampLink);
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
    const help = runCli(["--help"], ampLink);

    assert.match(help, /Agent Memory Protocol/);
    assert.match(help, /\binit\b/);
    assert.match(help, /\bdoctor\b/);
    assert.match(help, /\bcapture\b/);
    assert.match(help, /\bconsolidate\b/);
    assert.match(help, /\bretrieve\b/);
    assert.match(help, /\bstatus\b/);
    assert.doesNotMatch(help, /\bamp amp\b/);
  });

  it("runs amp status without an amp prefix", () => {
    const ampLink = createAmpBinSymlink();
    const out = runCli(["status"], ampLink);
    assert.match(out, /AMP CLI shell v/);
  });

  it("does not treat amp amp as the expected invocation path", () => {
    const ampLink = createAmpBinSymlink();
    assert.throws(
      () => runCli(["amp", "status"], ampLink),
      (error: NodeJS.ErrnoException) => {
        assert.ok(error.status !== 0 || /error/i.test(String(error.stderr ?? error.message)));
        return true;
      }
    );
  });

  it("keeps ai-memory amp --help working", () => {
    const help = runCli(["amp", "--help"]);
    assert.match(help, /Agent Memory Protocol/);
    assert.match(help, /status/);
  });
});
