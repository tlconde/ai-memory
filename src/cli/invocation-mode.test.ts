import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AMP_CLI_INVOCATION_DIRECT,
  AMP_CLI_INVOCATION_ENV,
  isCliEntryInvocation,
  resolveCliInvocationMode,
} from "./invocation-mode.js";

const CLI_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));
const AMP_ENTRY = fileURLToPath(new URL("./amp-entry.ts", import.meta.url));

describe("resolveCliInvocationMode", () => {
  it("returns amp-direct when AMP_CLI_INVOCATION env is set", () => {
    const previous = process.env[AMP_CLI_INVOCATION_ENV];
    process.env[AMP_CLI_INVOCATION_ENV] = AMP_CLI_INVOCATION_DIRECT;
    try {
      assert.equal(
        resolveCliInvocationMode([
          "node",
          join("dist", "cli", "index.js"),
          "status",
        ]),
        "amp-direct"
      );
    } finally {
      if (previous === undefined) {
        delete process.env[AMP_CLI_INVOCATION_ENV];
      } else {
        process.env[AMP_CLI_INVOCATION_ENV] = previous;
      }
    }
  });

  it("returns amp-direct when argv[1] is an amp npm bin symlink", () => {
    const binDir = join(tmpdir(), `amp-invocation-${process.pid}`);
    mkdirSync(binDir, { recursive: true });
    const ampLink = join(binDir, "amp");
    symlinkSync(AMP_ENTRY, ampLink);

    assert.equal(lstatSync(ampLink).isSymbolicLink(), true);
    assert.equal(
      resolveCliInvocationMode(["node", ampLink, "status"]),
      "amp-direct"
    );
  });

  it("returns amp-direct when argv[1] basename is amp", () => {
    const mode = resolveCliInvocationMode([
      "node",
      "/tmp/project/node_modules/.bin/amp",
      "status",
    ]);
    assert.equal(mode, "amp-direct");
  });

  it("returns amp-direct when argv[1] basename is amp.cmd", () => {
    const mode = resolveCliInvocationMode([
      "node",
      "/tmp/project/node_modules/.bin/amp.cmd",
      "status",
    ]);
    assert.equal(mode, "amp-direct");
  });

  it("returns ai-memory for the shared entry script path without env flag", () => {
    assert.equal(
      resolveCliInvocationMode(["node", CLI_ENTRY, "amp", "status"]),
      "ai-memory"
    );
  });

  it("returns ai-memory when argv[1] basename is ai-memory", () => {
    assert.equal(
      resolveCliInvocationMode([
        "node",
        "/tmp/project/node_modules/.bin/ai-memory",
        "amp",
        "status",
      ]),
      "ai-memory"
    );
  });

  it("defaults to ai-memory when argv[1] is missing", () => {
    assert.equal(resolveCliInvocationMode(["node"]), "ai-memory");
  });
});

describe("isCliEntryInvocation", () => {
  it("matches direct entry execution", () => {
    assert.equal(isCliEntryInvocation(CLI_ENTRY, CLI_ENTRY), true);
  });

  it("matches npm bin symlink execution via realpath", () => {
    const binDir = join(tmpdir(), `amp-entry-${process.pid}`);
    mkdirSync(binDir, { recursive: true });
    const ampLink = join(binDir, "amp");
    symlinkSync(AMP_ENTRY, ampLink);

    assert.equal(isCliEntryInvocation(ampLink, AMP_ENTRY), true);
    assert.equal(
      realpathSync(ampLink),
      realpathSync(AMP_ENTRY)
    );
    assert.equal(basename(ampLink), "amp");
  });
});
