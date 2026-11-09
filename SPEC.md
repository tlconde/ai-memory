# ai-memory redesign: specification

Status: approved by the owner on 2026-11-09 (HQ task 1, version 1). Section 8 records clarifications made at approval.

Provenance: drafted from the owner's T3 conversation; article figures re-checked against the article on 2026-11-09; repository facts read from `origin/main` at 6da0f40 the same day. Route: native HQ MCP run report. The software-factory CLI, OTLP traces and outbox were not run and remain unconfigured.

## 1. Goal

Rebuild ai-memory (tlconde/ai-memory) around the memory layers in Anthropic's "Components of agent memory", as a small, strict, well-tested tool that works the same in every agent the owner uses. Simplicity is a requirement, not a preference: every feature must move a number in the package's own eval or it does not merge.

## 2. What the article supports (verified)

| Claim used in this design | What the article says |
|---|---|
| Four layers, bottom to top | Transcripts (a searchable event log), memory notes written by Claude, memory representations such as wikis, injected context loaded into every session. |
| Search is the baseline | The search tool alone scored 53%; wiki plus search rose from 54% to 61%. This was search over a 350,000-file corpus, not transcripts specifically. |
| One page per entity, one writer | With a shared table, 41 of 57 facts (72%) survived because agents overwrote one another; with one agent per contract, 57 of 57 survived. |
| Unbounded wikis do not abstract | One wiki reached 68 pages, 255 links and 203 KB, 1.77 times its 115 KB corpus. |
| Judgment beats fixed rules for strong models | "For stronger models, giving them freedom to judge salience was more effective than setting fixed rules in advance." A "record only failures" rule cut the memory gain (Opus 5 by 0.234, Opus 4.7 by 0.150). |
| Over-storing is costly | Sonnet 3.7 "assumed everything might matter", wrote 413 files across 225 folders, and its record "was continuously going out of date". |
| Dreaming tests notes against evidence | "Dreaming gives Claude a way to test its notes against the original transcripts." |
| Wrong notes persist | "An incorrect note can be carried into every session." |
| Injection has a cost | Injected memories use tokens, and longer instruction files reduce adherence. |

Corrections to the earlier chat draft: the 53% figure is search in general, not "transcript search alone"; the article states 41 of 57 survived rather than "16 lost"; and over-storing was shown by Sonnet 3.7, while stronger models were hurt by rigid rules, not by over-storing.

## 3. Design

### 3.1 Layout

```
.memory/
  log/          append-only JSONL, one file per session; gitignored; never injected
  notes/        one markdown file per fact, ULID filename, written during sessions
  wiki/         one page per entity; written only by dream
  past/         quarantined findings imported from the old .ai/ memory
  INDEX.md      the only always-injected file; hard token budget
```

### 3.2 Records

Log line: `{ ts, session, host, kind: user|assistant|tool_call|tool_result|error, tool?, text, refs? }`. Secrets are scrubbed before the line is written.

Note frontmatter:

```yaml
id: 01J...           # ULID, also the filename
about: <entity>      # what the fact is about
evidence: [<session>:<line>-<line>]   # empty means hypothesis
verified: true|false
seen: <count of sessions that confirmed it>
checked: <date dream last verified it>
```

A note with no evidence is a hypothesis and INDEX.md labels it so. Past findings use the same shape with `origin: past`, empty evidence and `verified: false`.

### 3.3 Verbs and tools

| Verb | Does |
|---|---|
| `mem log` | Appends one event; called only by host adapters. |
| `mem note` | Writes one fact with evidence pointers. |
| `mem search` | SQLite FTS5 over log, notes, wiki and past, with snippets and source ids. Verified notes rank first and past findings last. |
| `mem dream` | Offline pass, described below. `--dry-run` prints the changeset. |

The MCP server exposes exactly two tools, `search` and `note`. There is no embedding model: Node's built-in `node:sqlite` provides FTS5 (checked on Node 26.13). Vectors come back only if the eval shows they move the hit rate.

### 3.4 Dream

The only writer to `wiki/` and `INDEX.md`. For each new log segment it:
1. re-checks touched notes against the transcript lines they cite, stalest first;
2. promotes a fact confirmed in three or more sessions to its entity's wiki page, quoting contract terms verbatim;
3. promotes a past finding only when transcript evidence confirms it, and expires unconfirmed past findings after a fixed number of sessions;
4. prunes unverified notes from the index after a few sessions, repairs links, and rebuilds INDEX.md within budget.

Output is a reviewable changeset, so memory changes like code. It stays opt-in until the eval shows it earns its token cost.

### 3.5 Host interface

```ts
interface Host {
  onEvent(e: LogEvent): void        // append to log
  beforeModel(): string             // INDEX.md for session start
  afterRun(session: string): void   // optional dream trigger
  onError(e: unknown): void
}
```

Each adapter is about 50 lines and does two things only: append to the log and inject INDEX.md at session start. Hosts are listed in task 5 of the plan: Claude Code, Codex, Cursor, Gemini CLI/Antigravity, Hermes, OpenClaw and a generic shell fallback; Grok CLI and T3 Code are verified rather than adapted; Grok Bot.app is investigated. The transcript layer needs hooks, because the model cannot be relied on to log every call; notes are a tool, because salience is the model's judgment.

### 3.6 Steering file

About twenty lines: what memory is for, what not to store because the environment already shows it, what counts as verified, and that notes need evidence. No persona prose, priority tags or fixed categories, because the article found fixed rules weaken strong models.

## 4. Budgets and the eval

- INDEX.md above its token budget fails CI.
- Wiki larger than half the notes fails CI.
- `mem eval` replays recorded sessions and reports retrieval hit rate, index token count and fact survival. A change that moves none of them does not merge.

## 5. Repository facts that shape the work

- `main` (6da0f40) has 27 source files and about 6,200 lines. It does not contain AMP, projection, graduation, gbrain or upstream sync; those exist only on the unmerged `amp-11-5-optimizer` branch (275 commits ahead, about 32,700 lines). Dropping them therefore means not merging that branch, plus removing what `main` itself carries: SSA references, AST-grep governance and the `@huggingface/transformers` hybrid search.
- `main` runtime dependencies today: `@ast-grep/napi`, `@huggingface/transformers`, `@modelcontextprotocol/sdk`, `commander`, `gray-matter`, `js-yaml`, `minimatch`. Target: the MCP SDK only.
- `package.json` still names `radix-ai/ai-memory` in `repository` and `bugs`; both move to `tlconde/ai-memory`. The npm package name (`@radix-ai/ai-memory`) is unchanged unless the owner decides otherwise.
- `engines.node` is `>=20`; `node:sqlite` needs Node 22 or newer, so the floor rises.

## 6. Engineering bar

Strict TypeScript, ESM, validation at the boundaries, colocated tests, fixtures over mocks, one `Store` interface with the filesystem as the only backend, about 3,000 lines in six source files. Kept from today's design, rewritten small: canonical files with thin per-tool copies (now the adapters), path safety, and the acceptance gate (now the eval). All work on a fresh branch from `main`; `amp-11-5-optimizer` and its uncommitted changes stay untouched. CREDITS.md credits the article as the design source.

## 7. Known limits

- Hosts without hooks get the weaker generic fallback.
- Dream costs model tokens on every run and must prove its value in the eval first.
- The past-findings import carries no evidence, so it starts at the bottom of search and never enters the index until confirmed.

## 8. Clarifications at approval

- Dream thresholds (three sessions to promote, past-finding expiry, unverified pruning) are starting values in `src/types.ts` `BUDGETS`; the eval tunes them.
- The six-file budget covers `src/` (types, store, search, dream, mcp, cli). Host adapters live in `adapters/<host>/` and are not counted.
- Secret scrubbing is defined in `src/store.ts` and tested with planted secrets: API keys and tokens by known prefixes, bearer headers, private key blocks, `KEY=value` pairs whose name contains key, token, secret or password, and high-entropy strings of 32 or more characters.

## 9. Decisions made while building (2026-11-09)

- Ranking stays weighted rather than strict tiers: on the default replay suite weighted scored 83.3% hit rate and 0.606 MRR against 77.8% and 0.430 for tiers (`mem eval --ranking tiers`).
- `zod` is a second runtime dependency: `McpServer.registerTool` accepts only zod schemas, the low-level server is deprecated in SDK 1.32, and zod is already a required peer of the SDK, so it installs nothing new.
- Grok and Antigravity have their own host names. Grok runs the Claude Code hook natively and gets its index through a rules file; Antigravity gets it through `PreInvocation` on the first model call.
- `src/` is 2,274 lines in six files; host adapters add about 690 lines in `adapters/`.
