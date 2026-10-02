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

Requires Node 26+, git, tar, perl, and the Claude Code CLI for `generate`.

## Use it as a Claude Code plugin

```bash
claude plugin marketplace add <path-to-spec-gate>
claude plugin install spec-gate@spec-gate
```

Then, inside any repository: `/spec-gate:run <request>`. spec-gate triages the request:

- **T0** (translations, copy, config, docs, a few lines): nothing from spec-gate — make the change; the run
  report only records that it was made directly.
- **T1** (one behaviour change): tests, implementation, QA.
- **T2** (a feature, a flow, states, permissions, UI): BA asks what it must, QC derives the cases,
  you approve once at Ready, then tests, implementation, QA and a trace from every sentence of
  your request to a green test.

Force a tier with `--tier t0|t1|t2`. Without the plugin, the same loop is `spec-gate run start`,
`next`, `submit` and `status`.

Test files run with Go, vitest, jest or `node --test`, and with Playwright when
`playwright.config.*` names a `testDir`; files there go to Playwright, not to the unit runner, after
whatever the repository's own `playwright test` script runs first (its `pre` script, or the
commands before `playwright test`, such as a UI build). A test file its runner finds no tests in,
because the runner's config leaves it out, is refused. Once the new tests pass, QA also runs the
whole suite of each runner they use and sends dev back for any test that passed before the change
and fails after it; tests already red at the start do not count, and jest, which has no per-test
report here, is not checked.

Triage also counts a screen of the repository as a feature and UI signal: the names of the files
in its `screens/`, `pages/` and `views/` directories, so "Shop: show …" is a T2 when `Shop.tsx`
is one.

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
report: junit                           # optional: go-json | junit — judge each test, not each file
report_file: report.xml                 # junit only: where test_command writes the report
support_globs: ["**/__tests__/fixtures/**"]  # optional: helpers copied into every run, never scored
feature: order totals on the checkout page   # optional: the pointer a spec writer gets
```

- `spec/` holds the requirement as it was **before** the bug: feature docs, the original ticket or
  PR text. Start each file with a line naming its source and date. Never paste the bug report or
  the fix.
- `answers.yaml` holds the answers a reviewer could have given **before** the bug was known.
  Write it before the first run and do not edit it afterwards.
- A spec can be written blind: give the sample a `feature:` pointer, `prepare` it before `spec/`
  exists, and `generate` with a candidate that has `needs_spec: false`. It sees the pointer and the
  pre-fix tree, never the fix. Give that candidate `applies_to: []` so `batch` leaves it out.
- Run `spec-gate eval validate <id> --repo <path>` until it prints `ok`.

## Candidates

`single-prompt` is built in. A candidate is a prompt template, plus optional settings:

```yaml
# ~/.claude/spec-gate/candidates/<name>/candidate.yaml
prompt: prompt.md
model: opus
```

`prompt.md` uses `{{spec}}`, `{{answers}}`, `{{feature}}`, `{{test_globs}}` and `{{skill}}`.

To measure a repository's own test-writing skill, do **not** copy it from today's checkout: that
copy postdates every fix and may already encode the lesson of the bug it is measured on. The
exported pre-fix tree already carries the repository's skills as they were at `pre_fix`, and every
candidate run loads them. Write a candidate whose prompt names the skill, for example "Use the
<skill> skill on the requirement below. Stop once the tests are written; do not change non-test
code." A sample whose `pre_fix` predates the skill measures its absence.

`skill_dir` is for a skill from outside the repository; freeze it at a date before every sample.

`spec-gate` is built in too: instead of one prompt it runs spec-gate's own T2 loop in the pre-fix
tree and stops once the tests are written. The spec files are the request, BA questions are
answered from `answers.yaml` (a question it does not settle gets `unknown — assumed: …`), Ready
is approved, and each run keeps the loop's model, cases and decisions under `spec-gate/` and the
cost of every agent in `cost.json`. `batch` runs it only when named with `--candidate spec-gate`.

## Running

```bash
spec-gate eval batch --runs 3                 # every sample in the store × every candidate
spec-gate eval batch --candidate plain --sample shop-1234
spec-gate eval report
```

`batch` prepares each sample once, skips runs that already have a verdict (so it can be rerun
after an interruption without paying again), and stops after two `leaked` runs. It finds each
repository through `repo.json`, written by any eval command that was given `--repo`. A candidate
can be limited to some repositories with `applies_to: [<slug>, …]` in its `candidate.yaml`.

`generate` clears the run directory, then runs `claude -p` inside the exported pre-fix tree with
user settings, MCP servers, session history and auto memory switched off. It keeps the full
transcript in `transcript.jsonl` and every non-test change the candidate made under `ignored/`.

To drive a candidate by hand instead, open
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude --setting-sources project --strict-mcp-config` in the
`pre:` directory `prepare` printed, then run `spec-gate eval collect` with the same `--candidate`
and `--run`. `collect` refuses a run that is already collected unless you pass `--fresh`.

Editing `pre_fix`, `post_fix` or `setup` invalidates the workspace: `generate` and `score` refuse
until `prepare` rebuilds it.

## Verdicts

Each collected test file is run alone on both trees. With `report` set, every test the file adds
is judged on its own and the file takes its best test verdict — a test that is missing from one
side, because it did not compile there, counts as failing on that side. Without `report`, the file
is judged by the command's exit code. A run takes its best file verdict.

Set `report` whenever the runner can produce it: `go test -json {dir}` with `report: go-json`;
`vitest run {file} --reporter=junit --outputFile=report.xml` or
`node --test --test-reporter=junit --test-reporter-destination=report.xml {file}` with
`report: junit` and `report_file: report.xml`.

| Verdict | Meaning | In the rate |
|---|---|---|
| `caught` | Failed before the fix, passed after it | caught |
| `missed` | Passed on both sides | miss |
| `inverted` | Passed before the fix, failed after it: the test pins the buggy behaviour | miss |
| `empty` | The candidate wrote no test file | miss |
| `broken` | Failed on both sides: a wrong test, or one that no longer compiles | bracketed |
| `inconclusive` | Timed out after the fix, or a control run of the directory was red | excluded |
| `leaked` | The candidate's tools touched a path outside its working tree | excluded |

The report gives the catch rate as caught ÷ (caught + missed + inverted + empty), and again with
`broken` counted as a miss; the truth lies between the two.

## Leak control

- Trees are exported with `git archive`: no history, so the fix cannot be read from the log.
- The fixed tree is unreadable while a candidate runs.
- Auto memory is off for every candidate run. Work directory names reveal neither the repository
  nor the sample, but the path is stable across runs, so memory must stay off.
- Every tool path in the transcript is checked; a run that touched anything outside its working
  tree is `leaked` and left out of the rate. This detects a leak after the fact; it does not stop
  a candidate from opening the store or the source checkout.
- Ignored files a run writes, such as `CLAUDE.local.md`, are removed before the next run; ignored
  files that existed when the workspace was prepared (installed dependencies) stay. A new file
  inside an ignored directory that already existed then is not removed.
- The candidate gets no stdin.
- Answers are fixed in advance and fed to the candidate; nobody answers live.

## Known limits

- Submodules and LFS objects are not exported; `setup` must fetch them.
- Each test command runs in its own process group, killed after every run: a test cannot leave a
  server running for the next file, and a background process holding stdout keeps the run open
  until its timeout.
- A hang before the fix counts as a failing test.
- Without `report`, verdicts are per test file: one wrong assertion in a file that also catches the
  bug makes the file `broken`.
- A test that only edits an existing test function, keeping its name, is not counted as the
  candidate's test under `report`.
- Test commands run without `NODE_TEST_CONTEXT`, so a repository using Node's test runner reports
  its own failures even when spec-gate itself runs under one.
