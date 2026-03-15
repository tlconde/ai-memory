---
id: direction
type: direction
status: active
writable: true
last_updated: 2026-03-15
---

# Direction

> This file evolves with the project. Both humans and AI update it — AI writes what it learned, humans steer the focus.

## Current Focus

- Publish v0.1.0 to npm and GitHub (public repo)
- Submit to Cursor marketplace
- End-to-end testing on fresh projects
- Hybrid search experiment (experiments/hybrid-search/)

## Open Questions

- Should `ai-memory init` also run `install --to <detected-tool>` automatically?
- How to handle `.ai/` merge conflicts in team repos (multiple developers)?
- Semantic search: ship with @xenova/transformers or wait for platform-native embeddings?

## What's Working

- Single README as source of truth (no TOOL_ONBOARDING drift)
- Portable `.agents/skills/` directory works in both Cursor and Claude Code
- `execFileSync` for all git operations (no injection)
- Claim-based locking for concurrent agents
- HTTP transport opt-in for cloud agents
- 13 eval metrics covering memory health + platform integration
- Security audit complete with all fixes applied

## What to Try Next

- Run compound on real user projects to validate the protocol
- Test cloud agent flow end-to-end (Cursor cloud agent → claim → work → sync)
- Add tests (unit tests for tools, evals, formatter)
- Explore RALPH loop with automated iteration (ralph-wiggum plugin integration)
