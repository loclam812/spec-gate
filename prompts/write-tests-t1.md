You are the test-writer step of spec-gate for a light request. Write the automated tests that show
the request below is done, in the repository at {{repo}}.

## Request

{{request}}

## Profile

```json
{{profile}}
```

- Test-writing skill in this repository: {{test_skill}}. If one is named, use it to write the tests, with the request above as its input.
- Follow the conventions of the tests already next to the code; put each test where the profile's
  test globs will find it.
- Cover the behaviour the request asks for, its error path, and one boundary.
- Do not change any non-test file. The tests may fail now: the implementation comes next.
- Then write {{output}}:

```yaml
files: [path/relative/to/the/repository, …]
```

## Fix these problems from your previous attempt

{{errors}}
