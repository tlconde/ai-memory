/**
 * from-amp path isolation guards (Invariant 4).
 *
 * Falsifiable claim: resolved write paths outside the allowed root are rejected.
 */

import { existsSync, realpathSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

export interface PathSafetyOptions {
  allowedRoot: string;
}

function assertRelativeInsideRoot(allowedRoot: string, targetPath: string): string {
  const rel = relative(allowedRoot, targetPath);
  if (rel === "" || rel === ".") {
    throw new PathSafetyError("Refusing to write directly to from-amp root; target a file inside it");
  }
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new PathSafetyError(`Write path escapes from-amp root: ${targetPath}`);
  }
  return targetPath;
}

/** Walk existing prefixes; reject symlinks that jump outside their lexical parent. */
function resolveWithSymlinkChecks(absolutePath: string): string {
  const normalized = resolve(absolutePath);
  if (normalized === sep) return normalized;

  const rootPrefix = normalized.startsWith(sep) ? sep : "";
  const parts = normalized.split(sep).filter(Boolean);
  let lexical = rootPrefix;
  let resolved = rootPrefix;

  for (let i = 0; i < parts.length; i++) {
    const nextLexical = lexical ? join(lexical, parts[i]) : parts[i];

    if (existsSync(nextLexical)) {
      if (lexical && existsSync(lexical)) {
        const parentReal = realpathSync(lexical);
        const nextReal = realpathSync(nextLexical);
        assertRelativeInsideRoot(parentReal, nextReal);
        resolved = nextReal;
      } else {
        resolved = realpathSync(nextLexical);
      }
      lexical = nextLexical;
    } else {
      resolved = join(resolved, ...parts.slice(i));
      break;
    }
  }

  return resolved;
}

/** Resolve target path and ensure it stays inside allowedRoot. */
export function assertWritePathAllowed(targetPath: string, options: PathSafetyOptions): string {
  const allowedRoot = resolve(options.allowedRoot);
  const resolvedTarget = resolve(targetPath);

  assertRelativeInsideRoot(allowedRoot, resolvedTarget);

  const rootReal = resolveWithSymlinkChecks(allowedRoot);
  const targetReal = resolveWithSymlinkChecks(resolvedTarget);
  assertRelativeInsideRoot(rootReal, targetReal);

  return resolvedTarget;
}

export function joinInsideRoot(root: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (segment.includes("..")) {
      throw new PathSafetyError(`Path segment cannot contain ..: ${segment}`);
    }
  }
  return assertWritePathAllowed(resolve(root, ...segments), { allowedRoot: root });
}
