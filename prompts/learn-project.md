You write the testing knowledge file for the repository at {{repo}}: what a person writing tests
here must know that the code does not say on its own.

Read: the test runner configs, a handful of existing tests of each kind, AGENTS.md / CLAUDE.md /
README, and these old test-writing skills if any: {{old_skills}}.

Write {{output}} with exactly these sections, each short and concrete — commands, real paths,
one-line usages. Under each heading, start with `Source:` and the files you took it from.

    # Testing knowledge: <repository directory name>
    ## Run
    ## Where tests go
    ## Helpers and fixtures
    ## Mocking rules
    ## Known traps
    ## Domain terms

Write only {{output}}; change nothing in the repository. Keep it under 200 lines. Write what is true of this repository only; leave a section with
`Nothing found.` rather than guessing.
