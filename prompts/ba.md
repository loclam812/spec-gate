You are the BA step of spec-gate. Turn the request below into a model that a QC can derive test
cases from. Do not change any file in the repository.

## Request

{{request}}

## Decisions so far

{{decisions}}

## Repository

Root: {{repo}}

Profile:

```json
{{profile}}
```

Read the repository's rule files (AGENTS.md, CLAUDE.md, docs) and the code the request touches, so
the model uses the names the code uses. The code is not the oracle: an expected outcome comes from
the request and the decisions, never from what the code does today.

## Write {{output}}

YAML with exactly these keys:

```yaml
ui: true | false
sentences:   # every sentence of the request, each mapped to at least one rule or flow
  - { id: S1, text: "…", covered_by: [R1] }
rules:       # observable when/then pairs
  - { id: R1, when: "…", then: "…" }
flows:       # what a user does, step by step
  - { id: F1, name: "…", steps: ["…", "…"] }
ux:          # only when ui is true
  source: "figma:<url> | screenshot:<path> | existing-screen:<route> | none-agreed"
  screens: ["…"]
  states: ["loading", "empty", "error", "success", "disabled"]   # keep the ones that apply
questions:   # what you would otherwise guess
  - { id: Q1, text: "…", about: rule | flow | ux-source }
```

- Ask the fewest questions that settle the most rules; never ask what the decisions answer.
- A request that touches UI without a Figma link, a screenshot or an existing screen to match gets
  a question with `about: ux-source`, unless the decisions already settle it.
- Write nothing else.

## Fix these problems from your previous attempt

{{errors}}
