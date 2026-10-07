---
name: fix-bug
description: Fix a bug from its evidence (a report, log, screenshot or failing behaviour) with a regression guard — write a failing test that reproduces it first, prove it fails for the right reason, then fix and verify that nothing else broke. Use whenever the user asks to fix a bug, even without naming this skill.
argument-hint: "<bug report, log or description>"
allowed-tools: Bash(node:*), Read, Write, Edit, Glob, Grep, Skill, AskUserQuestion
---

# fix-bug

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/cli/spec-gate.js"`, written `spec-gate` below. Run it from
the repository root; it prints JSON. Never commit or push.

1. **Reproduce, do not fix yet.** Run `spec-gate knowledge path`.
   - If `bug_skill` is set, invoke that skill with the evidence and tell it: "Only write the
     failing test that reproduces this bug; do not change any non-test file."
   - Otherwise write the test yourself, following the knowledge file at `path` if one was found:
     one test that fails on the current code because of the bug, named after the behaviour.
   If the evidence is not enough to reproduce the bug, ask the user for what is missing and stop.
2. **Adopt.** Write a one- or two-sentence description of the bug to a temporary file outside the
   repository (`mktemp`), then run
   `spec-gate tests adopt --request-file <file> --file <test> [--file <test> ...]`.
   On `errors`, fix the test (not the code) and adopt again; after two failed tries, show the
   errors and stop.
3. **Fix** the code. Never edit the adopted test files.
4. **Verify.** Run `spec-gate verify` and show the `report`: the result, changed test files, red
   tests, regressions and gaps. If it fails, fix the code and verify again; a failure you cannot
   fix is the user's to decide, so show it and stop.
