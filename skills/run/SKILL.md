---
name: run
description: Run a request through spec-gate. Triage it first; for a real feature, drive BA, QC, Ready, tests, implementation, QA and BA verify, with the CLI checking every step. Invoke as /spec-gate:run <request>.
argument-hint: "<request>"
disable-model-invocation: true
allowed-tools: Bash(node:*), Read, Write, Agent, AskUserQuestion
---

# spec-gate run

You drive the loop; the CLI decides. Never skip a step, never edit a file the CLI owns
(`~/.claude/spec-gate/…`) by hand, and never commit or push — ask the user as you always do.

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/cli/spec-gate.js"`; below it is written `spec-gate`.
Every command runs from the repository root and prints JSON.

1. Start: `spec-gate run start --request "$ARGUMENTS"`. If the user named a tier (`--tier t0|t1|t2`),
   pass it. Tell the user the tier and its reason in one line.
2. Loop on `spec-gate run next` until the kind is `done` or `stuck`:

| kind | Do |
|---|---|
| `direct` | This is a direct change: make it the usual way, run the existing tests, then `spec-gate run submit`. |
| `cli` | `spec-gate run submit`. |
| `agent` | Spawn one subagent with the Agent tool on the given `model`, prompt: "Read `<prompt_file>` and do exactly what it says; write your result to `<output>`." Then `spec-gate run submit`. If it prints errors, run `spec-gate run next` again — the new prompt carries them — and spawn again. |
| `ask` | Ask the user every question, in as few prompts as possible (AskUserQuestion takes up to 4). Write their answers as YAML `[{ id: Q1, answer: "…" }]` to `answers_file`, then `spec-gate run submit --answers <answers_file>`. |
| `approve` | Show the user `summary_file`. On approval, `spec-gate run submit --approve`; otherwise `spec-gate run submit --reject "<what they said>"`. |
| `stuck` | Show `reason` and stop. |
| `done` | Show the user the report at `report`: the gaps first, then the trace. Stop. |

3. If `spec-gate run submit` fails for a reason that is not an agent's output (a crash, a missing
   tool), show the error and stop; do not work around the CLI.
