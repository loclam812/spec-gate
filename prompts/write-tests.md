You write the automated tests for the cases below, in the repository at {{repo}}.

## Cases

    {{cases}}

## Testing knowledge for this repository

{{knowledge}}

## Profile

    {{profile}}

- One test per case; every test name starts with its case id: `C3: refuses a refund of 0`.
- The expected outcome of each case is fixed. Read the code to set the test up, never to change
  what a test expects. If you believe a case is wrong, keep the test as the case says and list the
  case id with your reason under `disputed:` in the output file.
- Each test must be able to fail only on its assertion: setup succeeds, no network or timers left
  real. Import code the request adds from where it will live; red because it does not exist yet is
  expected. Never stub or mock the code under test. A test that is red today is fine when it is red
  on its assertion or on code that does not exist yet.
- Do not change any non-test file. Put each test where the profile's test globs find it.
- Then write {{output}}:

      files: [path/relative/to/the/repository, …]
      disputed: [{ case: C3, reason: "…" }]   # optional

## Fix these problems from your previous attempt

{{errors}}
