---
name: mem-init
description: Guided setup wizard for ai-memory. Scaffolds .ai/, scans the codebase, and walks the user through configuring each file with project-specific recommendations. Every step is skippable.
disable-model-invocation: true
---

# mem-init — Guided Setup Wizard

## When to use

First time setting up ai-memory in a project. Can also re-run to refresh recommendations without overwriting existing content.

**Quick setup (skip wizard):** Run `npx @radix-ai/ai-memory init` and edit `.ai/IDENTITY.md` and `.ai/PROJECT_STATUS.md` manually. The wizard is optional — experienced users can configure everything directly.

**Full onboarding (this wizard):** Run `/mem-init` for guided setup with codebase scan and project-specific recommendations.

---

## Step 1: Scaffold

Check if `.ai/` already exists. If not, ask the user:

> "Would you like Default tier or Full tier (adds governance enforcement, evals, and ACP agent card)?"

Then run:

```bash
npx @radix-ai/ai-memory init          # Default
npx @radix-ai/ai-memory init --full   # Full
```

Then ask which AI tool they use and run:

```bash
npx @radix-ai/ai-memory install --to <tool>
```

If `.ai/` already exists, skip scaffolding and proceed to Step 2.

---

## Step 2: Codebase Scan

Read the following files to build a project profile. **Skip any that don't exist — do not ask about missing files.**

**Project manifest (pick the first one found):**
- `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `requirements.txt`, `Gemfile`

**Documentation:**
- `README.md`

**Structure:**
- Top-level directory listing (`ls`)

**Build & CI:**
- `.github/workflows/*.yml` or `.gitlab-ci.yml`
- `tsconfig.json`, `vite.config.*`, `webpack.config.*`
- `docker-compose.yml`, `Dockerfile`

**Git context:**
- `git log --oneline -10`
- `git remote -v`

**Existing AI tool setup:**
- `.mcp.json`, `.cursor/mcp.json` — existing MCP servers
- `.cursorrules`, `CLAUDE.md`, `.agents/rules/`, `.github/copilot-instructions.md` — existing rules

**Existing documentation:**
- `ARCHITECTURE.md`, `DESIGN.md`, `CONTRIBUTING.md`, `CHANGELOG.md`
- `docs/` directory
- `ADR/` or `docs/adr/`
- `.env.example`, `.env.local`

Summarize findings internally. Do not output a raw dump — proceed to guided steps.

---

## Step 3: Guide IDENTITY.md

Tell the user:

> "`.ai/IDENTITY.md` defines how the AI agent behaves in this project. It has placeholders you should customize. Here's what each section is for:"

Present each section with what it does and — based on your scan — suggest specific entries:

**Role** — Propose a role based on detected tech stack (e.g., "Senior TypeScript Engineer" if package.json has TypeScript, "Senior iOS Developer" if Podfile/xcodeproj found, "Full-Stack Engineer" if both frontend and backend detected). Ask the user to confirm or adjust.

**Mindset** — How the agent approaches work. The default is production-grade and strategic. Customize if the project has a different pace (e.g., research/exploration, rapid prototyping).

**Autonomy Level** — How much the agent asks vs acts independently. Options:
- `HIGH_TOUCH` (default) — asks before architectural, scope, or irreversible changes
- `MEDIUM_TOUCH` — asks before irreversible, breaking, or security-sensitive changes only
- `LOW_TOUCH` — asks before production deploys and data deletion only

Ask: "Which autonomy level would you like? (HIGH_TOUCH / MEDIUM_TOUCH / LOW_TOUCH)"

**Constraints** — Based on scan, suggest project-specific constraints. Examples:
- If Firebase/Firestore detected: "Never modify firestore.rules or storage.rules without approval"
- If Docker detected: "Never modify Dockerfile without approval"
- If migrations directory detected: "Never modify database migrations without review"
- If auth/payment code detected: "Never change authentication or payment flows without approval"

**Permissions** — Suggest based on project structure (e.g., "Adding npm dependencies" if package.json found).

The user edits IDENTITY.md themselves. Tell them: "Once you're happy with it, set `writable: false` in the frontmatter to lock it."

**This step is skippable.** Say: "You can skip this and customize later."

---

## Step 4: Guide reference/PROJECT.md

Tell the user:

> "`.ai/reference/PROJECT.md` is the technical reference — architecture, tech stack, integrations. Based on your codebase, here's what I'd suggest for each section:"

Present your scan findings as suggestions for each section:

- **Project Overview** — from README and manifest description
- **Tech Stack** — language, framework, build system, CI, key dependencies (all from scan)
- **Architecture** — from directory structure observations
- **Data Models** — from schema files, ORM models, types (if found)
- **Integrations** — from dependencies and env vars (if found)
- **Development Setup** — from README, Makefile, docker-compose (if found)

The user edits PROJECT.md themselves.

**This step is skippable.**

---

## Step 5: Guide PROJECT_STATUS.md

Tell the user:

> "`.ai/PROJECT_STATUS.md` tracks what's currently happening. Based on your recent git history:"

- **Current Focus** — suggest based on last 10 commits
- **Open Questions** — note anything unclear from the scan
- **What's Working** — patterns you observed (e.g., "CI runs on every PR", "TypeScript strict mode")

The user edits PROJECT_STATUS.md themselves. Note: "This file fills in naturally over time via `/mem-compound`. You can skip this."

**This step is skippable.**

---

## Step 6: Knowledge Audit

Check what existing documentation was found in Step 2 and present findings:

> "I found existing documentation in your project that could be valuable in `.ai/memory/`. Here's what I'd suggest:"

| Found | Suggestion |
|-------|-----------|
| `ARCHITECTURE.md`, `DESIGN.md`, `ADR/` | "Key architectural decisions could go into `.ai/memory/decisions.md` as [P1] entries" |
| `CONTRIBUTING.md` | "Workflow patterns could go into `.ai/memory/patterns.md`" |
| `CHANGELOG.md`, `HISTORY.md` | "Key milestones could go into `.ai/sessions/archive/thread-archive.md`" |
| `.env.example` | "Environment variables could be documented in `reference/PROJECT.md` under Development Setup" |
| `TODO`/`FIXME` comments in code | "Open items could go into `.ai/sessions/open-items.md`" |
| Existing MCP servers | "Found [N] MCP server(s) already configured. ai-memory has been added alongside them." |
| Existing rules files | "Found existing rules for [tool]. ai-memory bootstrap has been added without overwriting." |

Do not import anything automatically. Let the user decide what to capture.

### Canonical migration — competing context files

If the scan found files that overlap with `.ai/` canonical files, propose migrating their content:

| Found | Action |
|-------|--------|
| `AGENTS.md` | Split content: behavioral rules → `IDENTITY.md` (mindset, constraints, workflows), project context → `reference/PROJECT.md` (tech stack, structure, tools), workflow skills → `.ai/skills/`. Replace `AGENTS.md` with a stub: "See `.ai/IDENTITY.md` for agent behavior and `.ai/reference/PROJECT.md` for project context." |
| `CLAUDE.md` | Same split as AGENTS.md. If it contains only bootstrap text, replace with ai-memory's bootstrap. If it has project-specific rules, migrate to `IDENTITY.md` constraints. |
| `.cursorrules` | Migrate rules to `.ai/rules/` as canonical entries. Replace with stub or remove (ai-memory uses `.cursor/rules/` instead). |
| `copilot-instructions.md` | Migrate behavioral content to `IDENTITY.md`. Replace with ai-memory's bootstrap instruction. |

Present this as a proposal:

> "I found `[file]` which contains content that overlaps with `.ai/`. Having both creates competing sources of truth — the AI may follow one and ignore the other. I suggest migrating the content to the canonical `.ai/` files and replacing `[file]` with a stub that points there. Want me to walk through what goes where?"

If the user agrees, guide the split:
1. Read the file and categorize each section (behavioral → IDENTITY, project info → PROJECT.md, workflows → skills)
2. Present the mapping: "This section would go to IDENTITY.md under Constraints: [content]"
3. User applies edits themselves
4. Once done, replace the original file with a stub pointing to `.ai/`

If the user declines, note it as an open item in `.ai/sessions/open-items.md`.

**This step is skippable.**

---

## Step 7: Recommendations

Based on scan, suggest relevant ai-memory features. **Only mention what applies — do not list irrelevant suggestions.**

- **CI detected** → "Consider adding `mem-auto-review` to your CI pipeline for automated governance checks on PRs."
- **Multiple contributors** (check `git shortlog -sn | wc -l`) → "Consider Full tier (`--full`) for governance enforcement across team members."
- **No tests detected** → "Consider adding a testing-strategy pattern to `.ai/memory/patterns.md`."
- **Monorepo detected** → "Consider per-package skills in `.ai/skills/` for domain-specific guidance."
- **Docker detected** → "Consider adding container patterns (build caching, multi-stage builds) to `.ai/memory/patterns.md`."
- **Existing MCP servers** → "Your existing MCP servers work alongside ai-memory. No changes needed."

---

## Step 8: Validate & Summary

Run:

```bash
npx @radix-ai/ai-memory validate
```

Then print a summary:

> **Setup complete.** Here's what was done:
> - `.ai/` scaffolded with [tier] tier
> - Tool integration installed for [tool]
> - Files with remaining placeholders: [list any files still containing placeholder text]
> - Knowledge audit: [N] existing docs found — [captured/skipped]
> - Recommendations: [list any]
>
> You can re-run `/mem-init` anytime to refresh recommendations.
> Run `/mem-compound` after your first work session to capture learnings.
