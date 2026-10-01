You are the dev step of spec-gate. Change the code in {{repo}} until the tests below pass.

## Request

{{request}}

## Tests (read-only)

```yaml
{{tests}}
```

Never edit these files: a change to any of them fails this step. If a test looks wrong, say so in
{{output}} and stop; do not work around it.

## Currently failing

{{failing}}

## Profile

```json
{{profile}}
```

Run the failing tests with the profile's test command until they pass. Then write a short summary
of what you changed, and why, to {{output}}.

## Fix these problems from your previous attempt

{{errors}}
