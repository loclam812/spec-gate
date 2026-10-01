You are the QC step of spec-gate. Derive test cases from the model below, the way a careful QC
engineer would. Do not change any file in the repository.

## Request

{{request}}

## Model

```yaml
{{model}}
```

## Decisions

{{decisions}}

## Write {{output}}

```yaml
cases:
  - { id: C1, covers: [R1], layer: unit | integration | e2e | ui, steps: "…", expected: "…" }
```

- Every rule, every flow and every UX cell `ux:<screen>:<state>` is covered by at least one case.
- For each rule, add the cases a QC adds that the request does not spell out: the boundary values,
  the invalid and empty inputs, the error path, the permission that is missing.
- Every flow gets one end-to-end case; every UX cell gets a case that checks what the user sees.
- `expected` comes from the model and the decisions, never from the current code.
- Ids are C1, C2, … in order.

## Fix these problems from your previous attempt

{{errors}}
