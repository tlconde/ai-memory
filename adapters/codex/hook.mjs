#!/usr/bin/env node
// Codex hook (.codex/hooks.json or ~/.codex/hooks.json). Codex sends Claude-shaped payloads, so this is
// the Claude Code mapping with host 'codex'. SessionStart injects INDEX.md as
// hookSpecificOutput.additionalContext. See README.md.
import { isMain, run } from '../_shared/emit.mjs';
import { claude } from '../claude-code/hook.mjs';

// Codex has no failure event: a failed command is a PostToolUse whose tool_response is the output text.
// CLAUDE_PROJECT_DIR is cleared because Codex does not set it; one inherited from a parent Claude Code
// session would point at the wrong project. The payload cwd is the session's directory.
export const codex = (p, env) => claude(p, { ...env, CLAUDE_PROJECT_DIR: '' }, 'codex');

if (isMain(import.meta.url)) run(codex);
