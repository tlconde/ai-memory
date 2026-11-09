# Generic fallback: `mem-wrap`

For a CLI agent without hooks. `mem-wrap <command> [args...]` runs the command with its output still on
screen and logs, as host `generic`: session_start (the working directory), the command line as user, the
last 8,000 characters of stdout as assistant and of stderr as error, and session_end with the exit status.
It exits with the command's status; a failing `mem` only prints a warning.

`mem-wrap --index` prints INDEX.md for tools that accept a context file:

```sh
mem-wrap --index > .context/INDEX.md && some-agent --context .context/INDEX.md
mem-wrap some-agent -p "fix the build"
```

Install: put `node_modules/@radix-ai/ai-memory/adapters/generic/mem-wrap` on PATH (per user), or call it
by path from a project script. Needs `sh` and `node`, and `mem` on PATH or `MEM_BIN`.

Limits: one turn per run, no tool calls; stdout and stderr go through pipes, so a program that needs a
terminal (an interactive TUI) is not a fit.
