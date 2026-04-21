// Karpathy LLM Wiki scaffolding templates. Extracted from cli/index.ts to keep it slim.

export const DEFAULT_WIKI_SCHEMA = `---
id: wiki-schema
type: reference
status: active
writable: false
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Wiki Schema

Operational contract for the \`wiki/\` knowledge base. See \`reference/karpathy-llm-wiki.md\` for the conceptual rationale.

## Page taxonomy

- \`summaries/\` — one page per ingested source (1:1 with \`sources/<slug>.md\`).
- \`entities/\` — people, organizations, datasets, products.
- \`concepts/\` — ideas, methods, techniques, definitions.
- \`analyses/\` — cross-source synthesis, comparisons, arguments.

## Frontmatter contract

Every \`wiki/**/*.md\` file except \`index.md\`, \`log.md\`, \`SCHEMA.md\`, and \`**/_index.md\` MUST carry:

\`\`\`yaml
page_type: summary | entity | concept | analysis
tags: [...]
source_ids: [sources/<file>.md, ...]
last_ingested: YYYY-MM-DD
\`\`\`

## Link grammar

- Use relative markdown links: \`[text](../concepts/foo.md)\`. Not \`[[wikilinks]]\`.
- Citations to sources follow the same form, with optional \`#anchor\`: \`[cite](../../sources/karpathy-gist.md#architecture)\`.
- Every non-hub page MUST be reachable from \`index.md\` via at least one link.

## Ingest workflow

1. Read the new source under \`sources/\`.
2. Discuss key takeaways with the user.
3. Write \`wiki/summaries/<slug>.md\` with full frontmatter.
4. Update \`wiki/index.md\` (add the page under its category).
5. Update or create \`entities/\` and \`concepts/\` pages referenced by the source.
6. Append one entry to \`wiki/log.md\`.

A single ingest typically touches 10-15 pages.

## Query workflow

1. Search \`wiki/\` for pages relevant to the question.
2. Synthesize an answer with inline citations (relative links).
3. If the answer spans >=3 pages and is novel, offer to promote it to \`wiki/analyses/<slug>.md\` and update \`index.md\` + \`log.md\`.

## Lint workflow

Run detectors for:

- **Orphans** — pages not reachable from \`index.md\`. Exempt: \`index.md\`, \`SCHEMA.md\`, \`log.md\`, \`**/_index.md\`, per-category \`README.md\`.
- **Broken links** — relative paths that do not resolve.
- **Stale pages** — \`last_ingested < max(source.fetch_date)\` across cited sources.
- **Missing backlinks** — page A cites B but B does not reference A.
- **Missing source-cards** — binaries under \`sources/assets/\` with no companion \`sources/<slug>.md\`.

## log.md grammar

One-line header per entry:

\`\`\`
## [YYYY-MM-DD HH:MM] <verb> | <subject>
\`\`\`

Where \`<verb>\` is one of: \`ingest\`, \`query\`, \`lint\`, \`refactor\`, \`promote\`.

Optional metadata lines (\`key: value\`) beneath the header:

- \`source_id:\` — relative path under \`sources/\`.
- \`pages_touched:\` — comma-separated relative paths.
- \`duration_s:\` — wall-clock seconds.

\`log.md\` is append-only. Do not edit history.

## Relationship to \`memory/\`

- \`memory/\` = volatile project decisions, patterns, debugging. Scoped to *this* codebase.
- \`wiki/\` = stable domain knowledge distilled from \`sources/\`. Reusable across projects.
- Do not duplicate. If an entry belongs in both, link one to the other.
`;

export const DEFAULT_WIKI_INDEX = `---
id: wiki-index
type: index
status: active
writable: true
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Wiki Index

> Keep this reachable from every wiki page; lint will flag orphans.

## Summaries

<!-- One entry per source. Format: - [Title](summaries/<slug>.md) — one-line gist. -->

## Entities

<!-- People, orgs, datasets, products. -->

## Concepts

<!-- Ideas, methods, techniques. -->

## Analyses

<!-- Cross-source synthesis, comparisons, arguments. -->
`;

export const DEFAULT_WIKI_LOG = `---
id: wiki-log
type: log
status: active
writable: true
append_only: true
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Wiki Log

Grammar: one-line header \`## [YYYY-MM-DD HH:MM] <verb> | <subject>\` where \`<verb>\` is one of \`ingest | query | lint | refactor | promote\`.
Optional \`key: value\` metadata lines below the header: \`source_id:\`, \`pages_touched:\`, \`duration_s:\`.
Append-only; do not edit history.

<!-- Append entries below. Do not edit history. -->
`;

export const DEFAULT_SOURCES_README = `---
id: sources-readme
type: reference
status: active
writable: false
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# Sources

This directory is the immutable source of truth for the wiki. Agents cannot write here: \`commit_memory\` blocks writes to \`sources/\` via \`ALWAYS_IMMUTABLE\`. Humans add files by filesystem or git.

## Source-card pattern

Every binary under \`sources/assets/\` MUST have a companion markdown card at \`sources/<slug>.md\` with frontmatter:

\`\`\`yaml
---
id: source-<slug>
type: source-card
title: ...
origin_url: ...
sha256: ...
fetch_date: YYYY-MM-DD
asset: sources/assets/<filename>   # optional if no binary
---
\`\`\`

Followed by a 3-5 sentence abstract describing the source and why it was added.

Cards are what hybrid-search indexes; binaries are invisible to it. Missing cards will be flagged by wiki lint.
`;

export const DEFAULT_SOURCES_ASSETS_GITKEEP = "";

export const DEFAULT_KARPATHY_GIST = `---
source_url: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
source_raw_url: https://gist.githubusercontent.com/karpathy/442a6bf555914893e9891c11519de94f/raw
sha256: dc3efe98ae62f23dd08acad13aba2e95287beb20b6bec2f4af0423557fe37401
fetch_date: 2026-04-21
bytes: 11923
note: Verbatim upstream for attribution. Do not edit. Refresh via scripts/refresh-karpathy-gist.mjs (not yet created).
---

# LLM Wiki

A pattern for building personal knowledge bases using LLMs.

This is an idea file, it is designed to be copy pasted to your own LLM Agent (e.g. OpenAI Codex, Claude Code, OpenCode / Pi, or etc.). Its goal is to communicate the high level idea, but your agent will build out the specifics in collaboration with you.

## The core idea

Most people's experience with LLMs and documents looks like RAG: you upload a collection of files, the LLM retrieves relevant chunks at query time, and generates an answer. This works, but the LLM is rediscovering knowledge from scratch on every question. There's no accumulation. Ask a subtle question that requires synthesizing five documents, and the LLM has to find and piece together the relevant fragments every time. Nothing is built up. NotebookLM, ChatGPT file uploads, and most RAG systems work this way.

The idea here is different. Instead of just retrieving from raw documents at query time, the LLM **incrementally builds and maintains a persistent wiki** — a structured, interlinked collection of markdown files that sits between you and the raw sources. When you add a new source, the LLM doesn't just index it for later retrieval. It reads it, extracts the key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting where new data contradicts old claims, strengthening or challenging the evolving synthesis. The knowledge is compiled once and then *kept current*, not re-derived on every query.

This is the key difference: **the wiki is a persistent, compounding artifact.** The cross-references are already there. The contradictions have already been flagged. The synthesis already reflects everything you've read. The wiki keeps getting richer with every source you add and every question you ask.

You never (or rarely) write the wiki yourself — the LLM writes and maintains all of it. You're in charge of sourcing, exploration, and asking the right questions. The LLM does all the grunt work — the summarizing, cross-referencing, filing, and bookkeeping that makes a knowledge base actually useful over time. In practice, I have the LLM agent open on one side and Obsidian open on the other. The LLM makes edits based on our conversation, and I browse the results in real time — following links, checking the graph view, reading the updated pages. Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase.

This can apply to a lot of different contexts. A few examples:

- **Personal**: tracking your own goals, health, psychology, self-improvement — filing journal entries, articles, podcast notes, and building up a structured picture of yourself over time.
- **Research**: going deep on a topic over weeks or months — reading papers, articles, reports, and incrementally building a comprehensive wiki with an evolving thesis.
- **Reading a book**: filing each chapter as you go, building out pages for characters, themes, plot threads, and how they connect. By the end you have a rich companion wiki. Think of fan wikis like [Tolkien Gateway](https://tolkiengateway.net/wiki/Main_Page) — thousands of interlinked pages covering characters, places, events, languages, built by a community of volunteers over years. You could build something like that personally as you read, with the LLM doing all the cross-referencing and maintenance.
- **Business/team**: an internal wiki maintained by LLMs, fed by Slack threads, meeting transcripts, project documents, customer calls. Possibly with humans in the loop reviewing updates. The wiki stays current because the LLM does the maintenance that no one on the team wants to do.
- **Competitive analysis, due diligence, trip planning, course notes, hobby deep-dives** — anything where you're accumulating knowledge over time and want it organized rather than scattered.

## Architecture

There are three layers:

**Raw sources** — your curated collection of source documents. Articles, papers, images, data files. These are immutable — the LLM reads from them but never modifies them. This is your source of truth.

**The wiki** — a directory of LLM-generated markdown files. Summaries, entity pages, concept pages, comparisons, an overview, a synthesis. The LLM owns this layer entirely. It creates pages, updates them when new sources arrive, maintains cross-references, and keeps everything consistent. You read it; the LLM writes it.

**The schema** — a document (e.g. CLAUDE.md for Claude Code or AGENTS.md for Codex) that tells the LLM how the wiki is structured, what the conventions are, and what workflows to follow when ingesting sources, answering questions, or maintaining the wiki. This is the key configuration file — it's what makes the LLM a disciplined wiki maintainer rather than a generic chatbot. You and the LLM co-evolve this over time as you figure out what works for your domain.

## Operations

**Ingest.** You drop a new source into the raw collection and tell the LLM to process it. An example flow: the LLM reads the source, discusses key takeaways with you, writes a summary page in the wiki, updates the index, updates relevant entity and concept pages across the wiki, and appends an entry to the log. A single source might touch 10-15 wiki pages. Personally I prefer to ingest sources one at a time and stay involved — I read the summaries, check the updates, and guide the LLM on what to emphasize. But you could also batch-ingest many sources at once with less supervision. It's up to you to develop the workflow that fits your style and document it in the schema for future sessions.

**Query.** You ask questions against the wiki. The LLM searches for relevant pages, reads them, and synthesizes an answer with citations. Answers can take different forms depending on the question — a markdown page, a comparison table, a slide deck (Marp), a chart (matplotlib), a canvas. The important insight: **good answers can be filed back into the wiki as new pages.** A comparison you asked for, an analysis, a connection you discovered — these are valuable and shouldn't disappear into chat history. This way your explorations compound in the knowledge base just like ingested sources do.

**Lint.** Periodically, ask the LLM to health-check the wiki. Look for: contradictions between pages, stale claims that newer sources have superseded, orphan pages with no inbound links, important concepts mentioned but lacking their own page, missing cross-references, data gaps that could be filled with a web search. The LLM is good at suggesting new questions to investigate and new sources to look for. This keeps the wiki healthy as it grows.

## Indexing and logging

Two special files help the LLM (and you) navigate the wiki as it grows. They serve different purposes:

**index.md** is content-oriented. It's a catalog of everything in the wiki — each page listed with a link, a one-line summary, and optionally metadata like date or source count. Organized by category (entities, concepts, sources, etc.). The LLM updates it on every ingest. When answering a query, the LLM reads the index first to find relevant pages, then drills into them. This works surprisingly well at moderate scale (~100 sources, ~hundreds of pages) and avoids the need for embedding-based RAG infrastructure.

**log.md** is chronological. It's an append-only record of what happened and when — ingests, queries, lint passes. A useful tip: if each entry starts with a consistent prefix (e.g. \`## [2026-04-02] ingest | Article Title\`), the log becomes parseable with simple unix tools — \`grep "^## \\[" log.md | tail -5\` gives you the last 5 entries. The log gives you a timeline of the wiki's evolution and helps the LLM understand what's been done recently.

## Optional: CLI tools

At some point you may want to build small tools that help the LLM operate on the wiki more efficiently. A search engine over the wiki pages is the most obvious one — at small scale the index file is enough, but as the wiki grows you want proper search. [qmd](https://github.com/tobi/qmd) is a good option: it's a local search engine for markdown files with hybrid BM25/vector search and LLM re-ranking, all on-device. It has both a CLI (so the LLM can shell out to it) and an MCP server (so the LLM can use it as a native tool). You could also build something simpler yourself — the LLM can help you vibe-code a naive search script as the need arises.

## Tips and tricks

- **Obsidian Web Clipper** is a browser extension that converts web articles to markdown. Very useful for quickly getting sources into your raw collection.
- **Download images locally.** In Obsidian Settings → Files and links, set "Attachment folder path" to a fixed directory (e.g. \`raw/assets/\`). Then in Settings → Hotkeys, search for "Download" to find "Download attachments for current file" and bind it to a hotkey (e.g. Ctrl+Shift+D). After clipping an article, hit the hotkey and all images get downloaded to local disk. This is optional but useful — it lets the LLM view and reference images directly instead of relying on URLs that may break. Note that LLMs can't natively read markdown with inline images in one pass — the workaround is to have the LLM read the text first, then view some or all of the referenced images separately to gain additional context. It's a bit clunky but works well enough.
- **Obsidian's graph view** is the best way to see the shape of your wiki — what's connected to what, which pages are hubs, which are orphans.
- **Marp** is a markdown-based slide deck format. Obsidian has a plugin for it. Useful for generating presentations directly from wiki content.
- **Dataview** is an Obsidian plugin that runs queries over page frontmatter. If your LLM adds YAML frontmatter to wiki pages (tags, dates, source counts), Dataview can generate dynamic tables and lists.
- The wiki is just a git repo of markdown files. You get version history, branching, and collaboration for free.

## Why this works

The tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping. Updating cross-references, keeping summaries current, noting when new data contradicts old claims, maintaining consistency across dozens of pages. Humans abandon wikis because the maintenance burden grows faster than the value. LLMs don't get bored, don't forget to update a cross-reference, and can touch 15 files in one pass. The wiki stays maintained because the cost of maintenance is near zero.

The human's job is to curate sources, direct the analysis, ask good questions, and think about what it all means. The LLM's job is everything else.

The idea is related in spirit to Vannevar Bush's Memex (1945) — a personal, curated knowledge store with associative trails between documents. Bush's vision was closer to this than to what the web became: private, actively curated, with the connections between documents as valuable as the documents themselves. The part he couldn't solve was who does the maintenance. The LLM handles that.


## Note

This document is intentionally abstract. It describes the idea, not a specific implementation. The exact directory structure, the schema conventions, the page formats, the tooling — all of that will depend on your domain, your preferences, and your LLM of choice. Everything mentioned above is optional and modular — pick what's useful, ignore what isn't. For example: your sources might be text-only, so you don't need image handling at all. Your wiki might be small enough that the index file is all you need, no search engine required. You might not care about slide decks and just want markdown pages. You might want a completely different set of output formats. The right way to use this is to share it with your LLM agent and work together to instantiate a version that fits your needs. The document's only job is to communicate the pattern. Your LLM can figure out the rest.
`;

export const DEFAULT_WIKI_SUMMARIES_README = `# Summaries

One page per ingested source (1:1 with \`sources/<slug>.md\`). The source-card is metadata; the summary is the distilled content in your own words.
`;

export const DEFAULT_WIKI_ENTITIES_README = `# Entities

Pages for people, organizations, datasets, products, places. One entity per page. Link from summaries and other entities.
`;

export const DEFAULT_WIKI_CONCEPTS_README = `# Concepts

Pages for ideas, methods, techniques, definitions. Concept pages accrete across sources as the wiki grows.
`;

export const DEFAULT_WIKI_ANALYSES_README = `# Analyses

Cross-source syntheses, comparisons, arguments. Promote useful query answers here so explorations compound instead of vanishing into chat history.
`;
