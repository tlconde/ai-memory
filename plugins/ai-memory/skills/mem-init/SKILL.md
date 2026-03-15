---
name: mem-init
description: Scaffolds the .ai/ directory in the current project. Use once per project to set up persistent memory. Runs npx ai-memory init with chosen options.
---

# mem:init — Project Setup

## When to use

First time setting up ai-memory in a project. Run once.

## Steps

### 1. Confirm working directory
Verify the current directory is the project root (where `.git/` lives).

### 2. Choose tier

Ask which tier to initialize:

- **Default** — full memory structure + MCP server. Recommended for most projects.
  ```
  npx @radix-ai/ai-memory init
  ```

- **Full** — Default plus governance enforcement (harness), evals, and ACP agent card.
  ```
  npx @radix-ai/ai-memory init --full
  ```

### 3. Run init
Execute the chosen command. The CLI scaffolds `.ai/` from canonical templates, adds `AGENTS.md` stub at project root, and configures tool stubs for the current IDE.

### 4. Customize IDENTITY.md
After scaffolding, open `.ai/IDENTITY.md` and fill in:
- What this project is (one paragraph)
- Hard constraints (what the AI must never do in this codebase)
- Tech stack overview

### 5. Customize DIRECTION.md
Open `.ai/DIRECTION.md` and fill in:
- Current Focus (what's actively being built)
- Open Questions (what's not decided yet)

Leave `What's Working` and `What to Try Next` blank for now — these fill in naturally over time.

### 6. Confirm
Run `npx @radix-ai/ai-memory validate` to confirm all files have valid frontmatter.
