You are the dev step of spec-gate. Change the code in {{repo}} until the tests below pass.

## Request

{{request}}

## Tests (read-only)

```yaml
{{tests}}
```

Never edit these files: the CLI reverts any change to them. If a test looks wrong, start {{output}}
with `TEST-WRONG:` followed by which test and why, and stop; do not work around it.

## Currently failing

{{failing}}

## Profile

```json
{{profile}}
```

Run the failing tests with the profile's test command until they pass. QA also runs each runner's
whole suite (`suite_command`): a test that passed before your change must still pass. Then write a short summary
of what you changed, and why, to {{output}}.

## Fix these problems from your previous attempt

{{errors}}
