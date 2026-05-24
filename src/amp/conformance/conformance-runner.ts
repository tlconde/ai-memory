import { spawn } from "node:child_process";
import path from "node:path";

import { minimatch } from "minimatch";

import {
  INVARIANT_TEST_REGISTRY,
  type InvariantId,
  type InvariantTestMapping,
  listInvariantCoverage,
} from "./invariant-registry.js";

export type ConformanceStatus = "pass" | "fail" | "deferred";

export interface TestBatchResult {
  testFiles: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InvariantConformanceResult {
  invariantId: InvariantId;
  description: string;
  status: ConformanceStatus;
  testFiles: string[];
  execution?: TestBatchResult;
  message?: string;
}

export interface ConformanceReport {
  results: InvariantConformanceResult[];
  allPassed: boolean;
}

export interface ConformanceRunnerOptions {
  invariantIds?: InvariantId[];
  testFilePattern?: string;
  projectRoot?: string;
  executeTests?: (testFiles: string[], projectRoot: string) => Promise<TestBatchResult>;
}

export interface ResolvedConformanceTarget extends InvariantTestMapping {
  deferred: boolean;
}

function originalEntry(invariantId: InvariantId): InvariantTestMapping | undefined {
  return INVARIANT_TEST_REGISTRY.find((entry) => entry.invariantId === invariantId);
}

function isRegistryDeferred(entry: InvariantTestMapping): boolean {
  return entry.testFiles.length === 0;
}

function matchesPattern(testFile: string, pattern: string | undefined): boolean {
  if (!pattern) {
    return true;
  }
  return minimatch(testFile, pattern, { dot: true });
}

/**
 * Resolves invariant targets and mapped test files from the registry,
 * optionally filtered by invariant ID or test file glob pattern.
 */
export function resolveConformanceTargets(
  options: Pick<ConformanceRunnerOptions, "invariantIds" | "testFilePattern"> = {}
): ResolvedConformanceTarget[] {
  const { invariantIds, testFilePattern } = options;
  let entries = listInvariantCoverage();

  if (invariantIds?.length) {
    const allowed = new Set(invariantIds);
    entries = entries.filter((entry) => allowed.has(entry.invariantId));
  }

  const resolved: ResolvedConformanceTarget[] = [];

  for (const entry of entries) {
    const deferred = isRegistryDeferred(entry);
    const testFiles = entry.testFiles.filter((testFile) => matchesPattern(testFile, testFilePattern));

    if (deferred) {
      const explicitlyRequested = invariantIds?.includes(entry.invariantId) ?? false;
      if (testFilePattern && !explicitlyRequested) {
        continue;
      }
      resolved.push({
        ...entry,
        testFiles: [],
        deferred: true,
      });
      continue;
    }

    if (testFiles.length === 0) {
      continue;
    }

    resolved.push({
      ...entry,
      testFiles,
      deferred: false,
    });
  }

  return resolved;
}

export async function defaultExecuteTests(
  testFiles: string[],
  projectRoot: string
): Promise<TestBatchResult> {
  if (testFiles.length === 0) {
    return { testFiles, exitCode: 0, stdout: "", stderr: "" };
  }

  return new Promise((resolve, reject) => {
    const args = ["--import", "tsx", "--test", ...testFiles];
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        testFiles,
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function deferredResult(target: ResolvedConformanceTarget): InvariantConformanceResult {
  return {
    invariantId: target.invariantId,
    description: target.description,
    status: "deferred",
    testFiles: [],
    message: "Missing automated coverage — deferred in vertical slice",
  };
}

function passedResult(
  target: ResolvedConformanceTarget,
  execution: TestBatchResult
): InvariantConformanceResult {
  return {
    invariantId: target.invariantId,
    description: target.description,
    status: "pass",
    testFiles: target.testFiles,
    execution,
  };
}

function failedResult(
  target: ResolvedConformanceTarget,
  execution: TestBatchResult
): InvariantConformanceResult {
  return {
    invariantId: target.invariantId,
    description: target.description,
    status: "fail",
    testFiles: target.testFiles,
    execution,
    message: `Test batch exited with code ${execution.exitCode}`,
  };
}

/**
 * Runs mapped conformance suites and reports pass/fail/deferred per invariant ID.
 */
export async function runConformance(options: ConformanceRunnerOptions = {}): Promise<ConformanceReport> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const executeTests = options.executeTests ?? defaultExecuteTests;
  const targets = resolveConformanceTargets(options);
  const results: InvariantConformanceResult[] = [];

  for (const target of targets) {
    if (target.deferred) {
      results.push(deferredResult(target));
      continue;
    }

    const execution = await executeTests(target.testFiles, projectRoot);
    if (execution.exitCode === 0) {
      results.push(passedResult(target, execution));
    } else {
      results.push(failedResult(target, execution));
    }
  }

  const allPassed = results.every((result) => result.status === "pass" || result.status === "deferred");

  return { results, allPassed };
}

export function formatConformanceReport(report: ConformanceReport): string {
  const lines = report.results.map((result) => {
    const label = result.status.toUpperCase();
    const suffix = result.message ? ` — ${result.message}` : "";
    const files =
      result.testFiles.length > 0 ? ` [${result.testFiles.join(", ")}]` : "";
    return `${label} ${result.invariantId}${files}: ${result.description}${suffix}`;
  });

  lines.push(report.allPassed ? "Overall: PASS" : "Overall: FAIL");
  return lines.join("\n");
}

export function invariantIdsFromTargets(targets: ResolvedConformanceTarget[]): InvariantId[] {
  return targets.map((target) => target.invariantId);
}

export function discoverMappedTestFiles(
  options: Pick<ConformanceRunnerOptions, "invariantIds" | "testFilePattern"> = {}
): string[] {
  const files = new Set<string>();
  for (const target of resolveConformanceTargets(options)) {
    for (const testFile of target.testFiles) {
      files.add(testFile);
    }
  }
  return [...files].sort();
}

export function resolveProjectRoot(projectRoot?: string): string {
  return path.resolve(projectRoot ?? process.cwd());
}
