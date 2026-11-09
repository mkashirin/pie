# Inspection and scout contract

## Coverage checklist

Use this checklist to select sources, not to demand every file or section in every project.

| Area                      | Inspect                                                                                                                         | Extract                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Purpose and architecture  | README, architecture docs/ADRs, entrypoints, public exports, representative callers and tests                                   | Module responsibilities, dependency direction, control/data flow, extension points, boundaries an edit must preserve      |
| Tool-enforced style       | Formatter, linter, compiler, editor configuration and scripts                                                                   | Exact formatting/type constraints, import handling, authoritative commands                                                |
| Observed style            | Several representative first-party modules and tests, ideally across packages                                                   | Naming, file organization, errors, state, async patterns, testing conventions; qualify local versus shared patterns       |
| Workflow                  | Manifest scripts, task runners, lockfile names, CI, development guides, sanitized environment examples                          | Supported setup, package manager/runtime, working directories, quick versus full checks, offline/live/manual distinctions |
| Guidelines and invariants | Applicable agent/contribution instructions, security docs, schema/API contracts, migrations, generation scripts, boundary tests | Must/must-not rules, compatibility constraints, generated/vendor ownership, side-effect hazards                           |

Do not infer the chosen package manager solely from one lockfile if docs/scripts disagree. Do not
assume a CI workflow exists, tests are comprehensive, or code generation is automatic. Inspect what
actually exists. Public docs may be stale; resolve mechanics from current configuration and report
mismatches with explicit human policy rather than overwriting it.

## Task construction

Use the installed tool schema. `pi-openai-subagents` accepts a `tasks` array containing `agent`,
`task`, optional `context`, optional `inputs` (actual previous run/evidence IDs), and optional
`writePaths` for writers. Multiple tasks form a bounded parallel batch; there is no `parallel`
flag. Do not invent additional parameters, refer to future runs, or pass file paths as `inputs`.

For each read-only scout, provide in `context`:

1. Absolute project root and scope; applicable instruction constraints and exclusions.
2. Actual path inventory and concrete files to start with; related paths it can inspect if needed.
3. Its thematic/package assignment and the report contract below.
4. A reminder that it may read/search only: no shell, writes, project execution, web, or
   delegation.
5. Any budget or known missing inspection capabilities.

Example shape (replace sample paths and context with the real inventory):

```json
{
    "tasks": [
        {
            "agent": "scout",
            "task": "Map architecture and edit-sensitive contracts. Return a compact evidence report.",
            "context": "Root: /absolute/project. Inspect README.md, src/index.ts, src/core.ts, tests/core.test.ts. Read/search only; no shell, writes, execution, web, or delegation. Report coverage, up to 10 prioritized facts with scope/kind/path/symbol, conflicts, and gaps. About 500 words."
        },
        {
            "agent": "scout",
            "task": "Extract style and development commands. Return a compact evidence report.",
            "context": "Root: /absolute/project. Inspect package.json, formatter config, CONTRIBUTING.md, representative source/tests from the supplied inventory. Read/search only; no shell, writes, execution, web, or delegation. Commands must include working directory and prerequisites; distinguish configured rules from observed conventions. Report evidence, conflicts, and gaps. About 500 words."
        }
    ]
}
```

A scout with only `read` cannot discover arbitrary filenames. Supply exact files; if it needs more
paths, have it report the gap and let the foreground inventory them. Never substitute a `worker`
just to bypass the scout's shell restriction.

## Compact evidence report

Ask scouts to use their extension's required structured report mechanism (`agent_report` when
provided). Put the following content in supported summary/findings/verification/limitations fields
rather than inventing a new tool schema:

- **Coverage:** paths/areas inspected and major exclusions; describe actual reads, not intended
  work. Mark partial coverage or truncated reads.
- **Facts:** at most 10–15 prioritized facts, each in this form: `scope |
  documented/configured/observed/uncertain | actionable fact | source path + symbol/section`.
  Include a short reason to retain the fact if its editing relevance is not obvious.
- **Commands:** command, working directory, prerequisites, purpose, known side effects, source, and
  `inspected, not executed`. Do not run them.
- **Conflicts:** competing statements with both sources and their scopes. Do not silently decide
  that observed code overrides an explicit prohibition.
- **Gaps:** unread areas, missing/denied tools, failed/truncated reads, and uncertainties that
  could affect the final guidance.

Prefer a small report over excerpts. Do not emit `AGENTS.md` or write evidence artifacts. The
foreground decides what survives compaction and performs consequential source checks.

## Independent draft audit

Give a read-only scout the draft text, evidence map, scope, and existing guidance; pass real
settled run IDs in `inputs` when using their reports. Ask it to independently read the supporting
files and identify unsupported claims, invalid paths/commands, scope leakage, missing high-risk
constraints, conflicts, or accidental weakening of human policy. It must not merely approve the
other scouts' summaries. A failed/incomplete audit is not a pass; label it as such and perform
available checks locally. A scout audit does not satisfy a writer's formal reviewer gate.
