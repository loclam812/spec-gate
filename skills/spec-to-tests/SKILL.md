---
name: spec-to-tests
description: Write tests for a feature request or acceptance criteria before implementing it — a blind QC decides the cases and asks only about risky gaps, then tests are written and proven red for the right reason. Offer it and ask before running; it spawns agents (about $2 a run).
argument-hint: "<request>"
allowed-tools: Bash(node:*), Read, Write, Agent, AskUserQuestion
---

# spec-to-tests

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/cli/spec-gate.js"`, written `spec-gate` below. Run every
command from the repository root; each prints JSON. Never edit files under `~/.claude/spec-gate/`
by hand, except the `answers_file` the CLI names, and never commit or push.

1. Write the request to a temporary file outside the repository (`mktemp`, under `$TMPDIR`), then `spec-gate tests start --request-file <file>` (so quotes,
   `$` and backticks survive); keep the `run` id and pass `--run <id>` to every
   later command. If `spec-gate knowledge path` says none was found, tell the user once that
   `/spec-gate:learn-project` would make the tests fit the repository better, and go on.
2. Loop on `spec-gate tests next --run <id>` until `done` or `stuck`:

| kind | Do |
|---|---|
| `cli` | `spec-gate tests submit --run <id>` |
| `agent` | Spawn one Agent with the given `model`: "Read <prompt_file> and do exactly what it says." Then `submit`. For `qc`, add: "Do not open application source files." |
| `ask` | Ask the `questions` in AskUserQuestion calls of at most four, offering the likely answers as options (the user can always write their own); collect all answers, then write `[{ id, answer }]` YAML to `answers_file`; `submit --answers <answers_file>` |
| `approve` | Show `summary_file`. On yes, `submit --approve`; otherwise `submit --reject "<what they said>"` |
| `done` | Show `report` in five lines: cases, tests, red/green, assumed cases, disputed cases. Then: "Implement, then run /spec-gate:verify-changes." |
| `stuck` | Show `reason` and stop. |

3. When `submit` prints `errors`, run `next` again: the agent prompt now lists them.
4. A disputed case the user agrees cannot hold: remove its test, then
   `spec-gate tests drop --run <id> --case <C…> --reason "<why>"`. The reason is recorded and
   verify lists it; the CLI refuses while a guarded test still names the case.
