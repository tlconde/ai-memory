---
name: llm-wiki
description: Maintain a Karpathy-style LLM Wiki in .ai/wiki/. Use for ingest (new source), query (synthesize across pages), lint (health check), or promote (file a query answer as a permanent analysis page). Requires wiki/ to exist (scaffolded via `ai-memory init --wiki`).
type: skill
status: active
---

# llm-wiki — Karpathy-style LLM Wiki

## When to use

- User drops a new source in `sources/` and wants it ingested.
- User asks a research or domain question the wiki should answer.
- Periodic maintenance: lint the wiki for orphans, broken links, stale pages.
- A `/query` answer spans three or more pages and deserves to become a permanent analysis page — offer **promote**.

## Preconditions

- `.ai/wiki/` exists. If not, tell the user to run `ai-memory init --wiki` and stop.
- Read `.ai/wiki/SCHEMA.md` first. **Every time.** The schema is the contract; do not improvise.
- `sources/` is immutable to you (blocked by `commit_memory`). Humans add sources; you never write there.

## Sub-skill: Ingest

1. Read the new source (or its `sources/<slug>.md` card if the underlying asset is binary).
2. Discuss 3–5 key takeaways with the user; confirm framing before writing anything.
3. Write `wiki/summaries/<slug>.md` with frontmatter (`page_type: summary`, `source_ids: [sources/<slug>.md]`, `last_ingested: <today>`, tags). Body: structured synthesis with relative-md citations back to the source.
4. Update or create relevant `wiki/entities/*.md` and `wiki/concepts/*.md`. A single ingest typically touches 10–15 pages.
5. Add an entry to `wiki/index.md` under the right taxonomy section.
6. Append to `wiki/log.md`:

   ```
   ## [YYYY-MM-DD HH:MM] ingest | <source title>
   source_id: sources/<slug>.md
   pages_touched: N
   ```

7. Call `commit_memory` for each wiki file (never write directly). `sources/` stays untouched.

## Sub-skill: Query

1. `search_memory` against the wiki, preferring scope/hint `"wiki"` if that parameter exists in this project's version.
2. Synthesize with inline relative-md citations to each page cited.
3. Append to `wiki/log.md`:

   ```
   ## [YYYY-MM-DD HH:MM] query | <short question>
   pages_touched: N
   ```

4. If the synthesis spans three or more pages AND no existing analysis covers it, offer **promote** (below).

## Sub-skill: Promote

When the user accepts promotion of a query answer:

1. Write `wiki/analyses/<slug>.md` (frontmatter `page_type: analysis`, `source_ids: […]` drawn from the citations used).
2. Update `wiki/index.md` under Analyses.
3. Append to `wiki/log.md`:

   ```
   ## [YYYY-MM-DD HH:MM] promote | <slug>
   pages_touched: N
   ```

## Sub-skill: Lint

Run these detectors in order; report, do not auto-fix:

1. **Orphans** — wiki pages not reachable from `wiki/index.md` by following relative markdown links. Exempt: `index.md`, `SCHEMA.md`, `log.md`, any `**/_index.md`, any subdirectory `README.md`.
2. **Broken links** — any relative-md link whose target file does not exist.
3. **Stray wikilinks** — `[[...]]` syntax in wiki pages (optional migration warning).
4. **Missing backlinks** — page A cites B, but B does not link back (warn).
5. **Stale pages** — page `last_ingested` is older than the `fetch_date` of any source in `source_ids` (warn; suggests a re-summarize).
6. **Missing source cards** — file under `sources/assets/` with no companion `sources/<slug>.md` card (warn).
7. **Log tamper** — `git diff` on `wiki/log.md` shows modified or deleted lines, not just appended. Skip with a notice if not in a git checkout.

Append the lint result to `wiki/log.md`:

```
## [YYYY-MM-DD HH:MM] lint | <summary>
issues_found: N
```

## Report

Summarize what was written, pages touched, and open lint issues.
