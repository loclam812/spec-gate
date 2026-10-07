# spec-gate

Three Claude Code skills that put tests before code and check the result afterwards, backed by a
deterministic CLI, plus an evaluation harness that measures how many real, already-fixed bugs a
test generator would have caught.

## Install

```bash
npm install
npm link            # puts `spec-gate` on PATH; or run `node cli/spec-gate.js`
npm test
```

Requires Node 26+, git, tar, perl, and the Claude Code CLI for `generate`.

```bash
claude plugin marketplace add <path-to-spec-gate>
claude plugin install spec-gate@spec-gate
```

## The skills

| Skill | When | Does |
|---|---|---|
| `/spec-gate:spec-to-tests <request>` | before implementing | a blind QC derives cases from the request, asks only about risky gaps, you approve once at Ready, then tests are written and proven red for the right reason |
| `/spec-gate:verify-changes` | after implementing | the test files are unchanged, the new tests pass, the whole suite is compared with its state before the change, and a report traces every sentence of the request to a result |
| `/spec-gate:fix-bug <evidence>` | a bug to fix | reproduce it as a failing test first (with the repository's own bug-reproduction skill when the knowledge file names one), adopt the test, fix, then verify-changes |
| `/spec-gate:adopt-tests` | after another skill wrote a failing test (a bug reproduction), before the fix | each test must fail now for the right reason; the files are guarded and the suites snapshotted, so verify-changes can check the fix |
| `/spec-gate:learn-project` | first use in a repository, or when migrating an old test-writing skill | drafts the repository's testing knowledge file for you to review |

Each run spawns agents and costs money, so the skills offer themselves and ask before running.

### The flow

```
spec-to-tests:   discover → qc ⇄ ask → ready → write-tests → check → done
verify-changes:  guarded files unchanged → new tests green → suites compared → verify.md
```

- **discover** reads the repository's test stacks (Go, vitest, jest, `node --test`, Playwright) and
  scores the request's risk: access words, screen and feature signals.
- **qc** is blind: the QC agent reads only a packet (the request, the knowledge file's Domain terms,
  the repository's user-facing strings, route and screen names, the names of existing tests), never
  application code. It returns `cases.yaml`: each request sentence with the cases that cover it,
  each case with `when`, `then`, its basis (`request`, `decision` or `assumed`), risk and layer, and
  questions only for high-risk points the request does not settle. Cases scale with risk: 8–15 at low risk, 15–25 at high risk, never more than 30 (more are refused).
  A case's basis is `request`, `decision` (the user's answer), `domain` (what the plain purpose of
  the feature or the rules of its field fix) or `assumed`; Ready lists the `domain` and `assumed`
  ones. Answers are also kept per repository in the store's `decisions.md`, and later runs' QC
  reads them instead of asking again; an `unknown` answer is not kept. A question already answered
  in the run is refused, and so is an assumed case whose risk drops from high to low.
  A high-risk case may be assumed only when the round already asks four questions or its question
  came back `unknown`. A request too large for 30 cases comes back as `split`: two to six smaller
  requests, and the run ends there. The first QC pass runs on opus, later rounds on sonnet.
  After three QC rounds the remaining questions are not asked: their cases stay assumed and the
  run goes on to Ready.
- **ask** puts those questions to you (at most four per round); the answers become decisions and
  QC runs again. When the request touches a UI, the CLI asks for the UX source (a Figma link, a
  screenshot, an existing screen) if none was given.
- **ready** shows only the `assumed` cases, with their expectations, and counts the cases taken
  from the request and from your answers. You approve or reject with a reason.
- **write-tests**: the test writer gets the cases, the knowledge file and the code. Every test
  name carries its case id; expectations are copied, never changed, and a case the writer thinks is
  wrong is reported as disputed, as is one it can only test more weakly than written. It lists the
  interfaces its tests assume (routes, functions, labels that do not exist yet) for the user to
  check, and may drop a case it cannot test in this repository at all, with a reason, up to a
  third of the cases. A disputed case
  you agree cannot hold is dropped after its test is removed: `spec-gate tests drop --case <id>
  --reason "<why>"` records the reason, re-guards only the files that held the case, and verify
  lists it.
- **check** runs each test file once. It accepts when every case has a test and every red test
  fails on an assertion or on code that does not exist yet, not on a syntax error, a timeout, the network or setup. Green tests
  are allowed and listed. Otherwise the writer gets the failures and up to two more attempts, then the run is
  `stuck` with the reason.
- **done** snapshots the failing tests of each runner's whole suite and writes `report.md`.

Test files run with Go, vitest, jest or `node --test`, and with Playwright when `playwright.config.*`
names a `testDir`. A test file its runner finds no tests in, because the runner's config leaves it
out, is refused, as is one no stack runs. `verify-changes` reruns the whole suite of each runner
the new tests use; a test that passed in the snapshot and fails now is a regression, and tests
already red at the start do not count. jest has no per-test report here, so its suite is noted,
not compared. Gaps name each case without a green test. `spec-gate verify` exits non-zero when
anything is red. With many failing browser tests, each waits for its timeout, so verify can take
minutes.

### What it writes where

The store (`~/.claude/spec-gate/projects/<slug>/runs/<id>/`, see below) holds everything of a run:
`request.md`, `profile.json`, `risk.json`, `knowledge.md` (a snapshot), `qc-packet.md`,
`cases.yaml`, `decisions.md`, `ready.md`, `tests.yaml`, `results.json`, the guarded test files,
`suite-baseline.json`, `report.md` and `verify.md`. The repository gets only the test files and,
if you choose, the knowledge file. Run artifacts are single-use: they describe the request and the
code at one moment, nothing keeps them in step with later changes, and a later request starts a new
run. The tests stay in the repository and keep guarding the behaviour.

### The knowledge file

`.claude/testing.md` in the repository (tracked or git-excluded), else
`~/.claude/spec-gate/projects/<slug>/knowledge.md`; at most about 200 lines, with these sections:

```markdown
# Testing knowledge: <repository>
## Run
## Where tests go
## Helpers and fixtures
## Mocking rules
## Known traps
## Domain terms
```

The test writer reads all of it; the blind QC reads only Domain terms. `learn-project` cites a
source for each section ("from vitest.config.ts", "from the old <skill> skill").

```bash
spec-gate knowledge path                      # where it is, or where it would go
spec-gate knowledge check --file <path>       # are all six sections there
spec-gate knowledge draft [--old-skill <dir>] # the prompt and output path for the learn-project agent
```

### What a run costs

Two kinds of agent run: the QC (opus, once per round) and the test writer (sonnet, once, plus a
retry per failed check). A `spec-to-tests` run is estimated at about $2, not yet measured; `verify-changes` and the CLI
steps spawn no agent. Under `eval`, every agent's cost is recorded in the run's `cost.json`.

### CLI

```bash
spec-gate tests start --request "<text>" | --request-file <path>
spec-gate tests next | submit | status --run <id>
spec-gate tests drop --run <id> --case <id> --reason "<why>"   # after its test is removed
spec-gate tests adopt --request "<text>" --file <test> [--file <test> ...]   # guard tests another skill wrote
spec-gate verify --run <id>
spec-gate knowledge path | check | draft
spec-gate profile                              # the repository's test stacks
spec-gate eval …                               # the evaluation harness below
```

### Suggesting the skills

spec-gate never edits your CLAUDE.md. To have Claude offer the skills at the right moment, copy
this into yours:

```markdown
**Tests from a requirement / gate before merge** (spec-gate plugin):
- Bug report, log or failing behaviour -> use `spec-gate:fix-bug`
- Feature request or AC, tests before code -> offer `spec-gate:spec-to-tests` (ask first; ~$2/run)
- After implementing against those tests -> offer `spec-gate:verify-changes`
- Small fix, one behaviour -> test-driven development as today, not spec-gate
- First use in a repo -> `spec-gate:learn-project`
```

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

`spec-to-tests` is built in too: instead of one prompt it runs spec-gate's own `spec-gate tests` flow
headlessly in the pre-fix tree, until the tests are written. The spec files are the request, QC
questions are answered from `answers.yaml` (a question it does not settle gets `unknown — assumed:
…`), Ready is approved, and each run keeps the flow's cases, decisions and report under
`spec-to-tests/`, the cost of every agent in `cost.json`, and the application source files the blind
QC read in `qc-reads.json`. A sample's `knowledge.md`, when present, is placed as the repository's
`.claude/testing.md` before the run. `batch` runs it only when named with `--candidate spec-to-tests`.

## Running

```bash
spec-gate eval batch --runs 3                 # every sample in the store × every candidate
spec-gate eval batch --candidate plain --sample shop-1234
spec-gate eval report
```

The report gives each candidate's catch rate, its `broken` count (red on both sides: a wrong test,
the closest thing to a false positive here), and what a run costs: dollars and minutes per run,
summed over every `claude` result in the run's transcript.

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
until `prepare` rebuilds it. Workspaces live in `~/.cache/spec-gate/work/` (`SPEC_GATE_WORK`
overrides it), not in the system temp directory, which macOS purges of files unused for three days.
A test that fails on a missing file under `node_modules` or a missing npm package is a broken
install: the check step refuses it rather than counting it as code not written yet.

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
| `inconclusive` | Timed out after the fix, a control run of the directory was red, or, with `report`, no test of the file ran on either side (a broken install, a file the runner's config leaves out) | excluded |
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
