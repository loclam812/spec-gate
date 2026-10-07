---
name: verify-changes
description: After implementing against tests that spec-to-tests wrote or adopt-tests guarded, check the change — the new tests pass, their files were not edited, no test that passed before now fails — and trace the request to results. Offer it when such a run exists, and ask before running.
allowed-tools: Bash(node:*), Read
---

# verify-changes

Run `node "${CLAUDE_PLUGIN_ROOT}/cli/spec-gate.js" verify` from the repository root (it takes the
latest run of this working tree; pass `--run <id>` for another). Show the user the `report`: the
result, then changed test files, red tests, regressions and gaps. A failure is the user's to fix;
never edit a test to make it pass. Verify reruns every suite the new tests belong to; with many
failing browser tests each one waits for its timeout, so run it in the background and say so.
