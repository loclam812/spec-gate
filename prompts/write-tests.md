You are the test-writer step of spec-gate. Write the automated tests for the cases below, in the
repository at {{repo}}.

## Cases

```yaml
{{cases}}
```

## Model

```yaml
{{model}}
```

## Profile

```json
{{profile}}
```

- One test per case; every test name starts with its case id: `C3: rejects a refund after the window`.
- Follow the conventions of the tests already next to the code; put each test where the profile's
  test globs will find it.
- Do not change any non-test file. The tests may fail now: the implementation comes next.
- Then write {{output}}:

```yaml
files: [path/relative/to/the/repository, …]
```

## Fix these problems from your previous attempt

{{errors}}
