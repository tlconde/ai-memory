/**
 * Guard against internal import cycles in runtime-semantics production modules.
 *
 * Scope: flat files in this directory only; top-level import/export-from statements;
 * relative specifiers resolved to .ts paths. Does not follow dynamic import or
 * cross-package imports outside runtime-semantics.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function listProductionSources(): string[] {
  return readdirSync(MODULE_DIR)
    .filter(
      (file) =>
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        !file.endsWith(".test-fixture.ts"),
    )
    .map((file) => join(MODULE_DIR, file));
}

function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  let target = resolve(dirname(fromFile), specifier);
  if (target.endsWith(".js")) {
    target = target.slice(0, -3);
  }

  for (const candidate of [`${target}.ts`, join(target, "index.ts")]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractRelativeImports(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push(statement.moduleSpecifier.text);
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push(statement.moduleSpecifier.text);
    }
  }

  return imports;
}

function buildAdjacency(sources: readonly string[]): Map<string, string[]> {
  const sourceSet = new Set(sources);
  const adjacency = new Map<string, string[]>();

  for (const sourceFile of sources) {
    const edges = extractRelativeImports(sourceFile)
      .map((specifier) => resolveRelativeModule(sourceFile, specifier))
      .filter((target): target is string => target !== null && sourceSet.has(target));

    adjacency.set(sourceFile, edges);
  }

  return adjacency;
}

function findCycle(adjacency: Map<string, string[]>): string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    if (visiting.has(node)) {
      const cycleStart = stack.indexOf(node);
      return cycleStart === -1 ? [node, node] : [...stack.slice(cycleStart), node];
    }
    if (visited.has(node)) {
      return null;
    }

    visiting.add(node);
    stack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      const cycle = dfs(next);
      if (cycle) {
        return cycle;
      }
    }

    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of adjacency.keys()) {
    const cycle = dfs(node);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

function formatCycle(cycle: readonly string[]): string {
  return cycle.map((file) => file.replace(`${MODULE_DIR}/`, "")).join(" -> ");
}

describe("runtime-semantics dependency graph", () => {
  it("has no internal import cycles among production modules", () => {
    const sources = listProductionSources();
    assert.ok(sources.length > 0, "expected runtime-semantics production sources");

    const adjacency = buildAdjacency(sources);
    const cycle = findCycle(adjacency);

    assert.equal(
      cycle,
      null,
      cycle ? `Detected runtime-semantics import cycle: ${formatCycle(cycle)}` : undefined,
    );
  });
});
