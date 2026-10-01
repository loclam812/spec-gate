# spec-gate

Turns a requirement into a model, a blind oracle and executable tests, gated before
implementation. This repository currently holds milestone M0: the evaluation harness that measures
how many real, already-fixed bugs a test generator would have caught.

## Install

```bash
npm install
npm link            # puts `spec-gate` on PATH; or run `node cli/spec-gate.js`
npm test
```

Requires Node 26+, git, tar, and the Claude Code CLI for `generate`.

## Store

Everything per user lives under `$SPEC_GATE_HOME` (default `~/.claude/spec-gate`), never inside
the repositories being measured:

```
projects/<slug>/eval/<id>/sample.yaml     the bug
projects/<slug>/eval/<id>/answers.yaml    clarifying answers, written before any run
projects/<slug>/eval/<id>/spec/*.md       the requirement as it read before the bug
projects/<slug>/eval/<id>/runs/<candidate>-<n>/   collected tests, logs, verdict.json
candidates/<name>/                        your own candidates
```

`<slug>` is the repository's normalised remote URL, e.g. `github.com-acme-shop`.
`spec-gate eval where <id> --repo <path>` prints a sample's directory.

## Writing a sample

Pick a bug that was fixed in one commit whose parent still has the bug.

```yaml
id: shop-1234                       # must equal the directory name
pre_fix: "a1b2c3d…"                 # quote shas: YAML turns 1234567 into a number
post_fix: "e4f5a6b…"
setup: pnpm install --frozen-lockfile   # optional; runs in each exported tree
test_command: npx vitest run {file}     # {file} = one test file, {dir} = ./its directory
test_globs: ["**/*.test.ts"]
timeout_s: 600                          # optional
```

- `spec/` holds the requirement as it was **before** the bug: feature docs, the original ticket or
  PR text. Start each file with a line naming its source and date. Never paste the bug report or
  the fix.
- `answers.yaml` holds the answers a reviewer could have given **before** the bug was known.
  Write it before the first run and do not edit it afterwards.
- Run `spec-gate eval validate <id> --repo <path>` until it prints `ok`.

## Candidates

`single-prompt` is built in. To measure a repository's own test-writing skill, freeze a copy so
the baseline cannot drift between runs:

```bash
mkdir -p ~/.claude/spec-gate/candidates/<name>/skills
cp -R <repo>/<skills dir>/<skill> ~/.claude/spec-gate/candidates/<name>/skills/
```

`~/.claude/spec-gate/candidates/<name>/candidate.yaml`:

```yaml
prompt: prompt.md
skill_dir: skills/<skill>
model: opus
```

`prompt.md` uses `{{spec}}`, `{{answers}}`, `{{test_globs}}` and `{{skill}}`, for example
"Use the {{skill}} skill on the requirement below. Stop once the tests are written; do not change
non-test code."

## Running

```bash
spec-gate eval prepare <id> --repo <path>
for n in 1 2 3; do
  spec-gate eval generate <id> --repo <path> --candidate single-prompt --run $n
  spec-gate eval score    <id> --repo <path> --candidate single-prompt --run $n
done
spec-gate eval report
```

`generate` runs `claude -p` inside the exported pre-fix tree with user settings, MCP servers and
session history switched off. To drive a candidate by hand instead, open
`claude --setting-sources project --strict-mcp-config` in the `pre:` directory `prepare` printed,
then run `spec-gate eval collect` with the same `--candidate` and `--run`.

## Verdicts

| Verdict | Meaning |
|---|---|
| `caught` | A generated test failed before the fix and passed after it |
| `missed` | Every generated test passed on both sides |
| `inconclusive` | Every test failed after the fix, timed out after it, or a control run was red |
| `empty` | The candidate wrote no test file; counted as a miss |

The catch rate is caught ÷ (caught + missed + empty).

## Leak control

- Trees are exported with `git archive`: no history, so the fix cannot be read from the log.
- Work directories are named `sg-<hash>` under the temp directory, so neither the repository nor
  the sample appears in any path a memory feature could key on.
- Answers are fixed in advance and fed to the candidate; nobody answers live.

## Known limits

- Submodules and LFS objects are not exported; `setup` must fetch them.
- A timeout kills the shell only; children of a compound command can outlive it.
- A hang before the fix counts as a failing test.
- Test commands run without `NODE_TEST_CONTEXT`, so a repository using Node's test runner reports
  its own failures even when spec-gate itself runs under one.
