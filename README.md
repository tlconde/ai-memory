# ai-memory

ai-memory gives coding agents memory that works the same in every host: a searchable log of what happened, short notes backed by that log, and one small index loaded at session start. It is built on the layers described in Anthropic's [Components of agent memory](https://www.anthropic.com/research/components-of-agent-memory), and it stays small so that every feature has to earn its place in the eval.

## The four layers

Everything lives under `.memory/` in your project (or `$MEM_ROOT`).

| Layer | Path | Written by | Loaded |
|---|---|---|---|
| Transcript log | `log/<session>.jsonl` | host adapters, one event per line | never; searched only |
| Notes | `notes/<ulid>.md` | the agent, during a session, with evidence | through search |
| Wiki | `wiki/<entity>.md` | `mem dream` only, one page per entity | through search |
| Injected index | `INDEX.md` | `mem dream` only, within a token budget | at every session start |

A note cites log lines as evidence (`<session>:<first>-<last>`). A note without evidence is a hypothesis, and the index says so. Search ranks verified notes first.

`past/` holds findings imported from the old `.ai/` memory. They are unverified, carry no evidence, never enter `INDEX.md` and rank last in search. Dream promotes one only when a transcript confirms it and expires the rest.

`STEERING.md` (about twenty lines, at the repository root) is placed at the top of `INDEX.md` by dream. It tells the agent what memory is for, to search before claiming, to store only what the environment does not already show, and to trust the environment over a stale note.

## Install

Node 22.13 or newer (search uses the built-in `node:sqlite` with FTS5; there is no embedding model).

```sh
npm install -g @radix-ai/ai-memory   # installs the `mem` command
```

Then connect your agent. Each host has a small adapter that appends events to the log and injects `INDEX.md` at session start. See [adapters/README.md](adapters/README.md) for the host list and per-host steps (Claude Code, Codex, Cursor, Gemini CLI, Hermes, OpenClaw and a generic shell fallback).

Add `.memory/log/` and `.memory/.search.sqlite*` to your `.gitignore`. Notes, wiki and the index are plain markdown and can be reviewed and committed like code.

## Commands

```
mem [--root <dir>] <command>
```

| Command | Does |
|---|---|
| `mem log` | Appends LogEvent JSON lines from stdin. Called by host adapters, not by people. |
| `mem note` | Writes one fact with evidence pointers into `notes/`. |
| `mem search <query> [--limit N] [--json]` | Full-text search over log, notes, wiki and past, with snippets and source ids. |
| `mem dream [--dry-run]` | Offline pass: re-checks notes against the lines they cite, promotes facts confirmed across sessions to the wiki, promotes or expires past findings, rebuilds `INDEX.md`. Prints a reviewable changeset. |
| `mem lint` | Checks the budgets: `INDEX.md` token count, wiki size against notes, note shape. Fails CI when over. |
| `mem eval` | Replays recorded sessions and reports retrieval hit rate, index tokens and fact survival. |
| `mem index` | Prints `INDEX.md`. Adapters call it at session start. |
| `mem mcp` | Runs the MCP server, which exposes exactly two tools: `search` and `note`. |
| `mem import-past <dir> [--dry-run] [--json]` | Imports an old `.ai/` directory as past findings (see below). |

The log and notes are hooks and tools on purpose: the model cannot be trusted to log every call, so hooks do it; what is worth a note is the model's judgment, so notes are a tool.

### Importing the old `.ai/` memory

```sh
mem import-past .ai --dry-run   # list what would be imported, write nothing
mem import-past .ai             # write past/<ulid>.md files
```

Each entry of a multi-entry file (`memory/decisions.md`, `patterns.md`, `debugging.md`, `improvements.md`, session archives) becomes one past finding: `origin: past`, `verified: false`, no evidence, `seen: 0`. The body is the entry text with secrets scrubbed and priority tags removed from its heading, ending with `Imported from <file>#<heading> on <date>`.

It skips `IDENTITY.md`, `PROJECT_STATUS.md`, `rules/`, `toolbox/`, `acp/`, skills, agents and commands, indexes, task lists, running session logs, generated files, unfilled template placeholders and heading-only entries. The summary lists counts per source file and every skip reason. Re-running imports nothing twice: entries are matched on a hash of their normalized text.

Some old memory hurts more than it helps. Treat imported findings as leads to check, not as facts.

## Privacy

- The transcript log is meant to stay local: gitignore `.memory/log/` and the search database.
- Secrets are scrubbed before anything is written: API keys and tokens by known prefixes, bearer and authorization headers, private key blocks, `KEY=value` pairs whose name contains key, token, secret or password, passwords in URLs, and high-entropy strings of 32 or more characters. Imported past findings go through the same scrubber.
- The log is never injected into a session. Only `INDEX.md` is, and it is built from notes and the wiki.
- Storage and search make no network calls and use no embedding service.

## Limits

- Hosts without hooks get the weaker generic fallback, which depends on the agent calling `mem log`.
- Dream costs model tokens on each run. It stays opt-in until the eval shows it earns that cost.
- Past findings carry no evidence, so they start at the bottom of search and enter the index only once a transcript confirms them.
- Scrubbing is pattern-based. It catches common secret shapes, not every secret; do not paste credentials into a session.
- Search is keyword search (SQLite FTS5). Vectors come back only if the eval shows they improve the hit rate.

## Credits

The design follows Anthropic's [Components of agent memory](https://www.anthropic.com/research/components-of-agent-memory). See [CREDITS.md](CREDITS.md) for every source and dependency, and [SPEC.md](SPEC.md) for the full design.

## License

MIT
