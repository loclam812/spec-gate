---
name: learn-project
description: Draft this repository's testing knowledge file (how tests run, where they go, helpers, mocking rules, traps, domain terms) for the user to review, optionally from an old project test-writing skill. Offer it on first use of spec-gate in a repository and ask before running; it spawns one agent.
argument-hint: "[path to an old test-writing skill]"
allowed-tools: Bash(node:*), Read, Write, Agent, AskUserQuestion
---

# learn-project

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/cli/spec-gate.js"`, written `spec-gate` below. Run it from
the repository root.

1. `spec-gate knowledge draft` (add `--old-skill <dir>` when the user gave one). Spawn one Agent
   with the given `model`: "Read <prompt_file> and do exactly what it says."
2. `spec-gate knowledge check --file <output>`; if it lists errors, spawn the agent again with the
   errors appended to the same instruction, once.
3. Show the draft. Ask where to keep it: `.claude/testing.md` in the repository (commit it to share
   with the team, or add it to `.git/info/exclude` to keep it personal) or the personal store path
   from `spec-gate knowledge path`. Copy it there only after the user says so.
