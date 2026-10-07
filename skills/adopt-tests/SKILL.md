---
name: adopt-tests
description: Guard tests that another skill wrote (for example a bug reproduction) before the fix — each must fail now for the right reason; then verify-changes checks them and the whole suite after the fix. Use after the failing test exists and before any fix is written.
argument-hint: "<what the tests reproduce> -- <test file> [<test file> ...]"
allowed-tools: Bash(node:*), Read, Write
---

# adopt-tests

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/cli/spec-gate.js"`, written `spec-gate` below. Run it from
the repository root; it prints JSON. Never commit or push.

1. Write what the tests reproduce (the bug or behaviour, one or two sentences) to a temporary file
   outside the repository (`mktemp`), then run
   `spec-gate tests adopt --request-file <file> --file <test> [--file <test> ...]`.
2. On `step: done`, show the `report` (each file and why it is red) and say: "Fix it, then run
   /spec-gate:verify-changes."
3. On `errors`, show them and stop. A test that passes today does not reproduce the problem; a test
   that fails on setup, syntax, a timeout or the network fails for the wrong reason. Fix the test
   (or ask the skill that wrote it to), then adopt again. Never write the fix before adopting.
