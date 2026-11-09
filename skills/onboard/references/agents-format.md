# AGENTS.md output contract

`AGENTS.md` is persistent, agent-facing working knowledge, not a transcript, product manual, or
onboarding report. Optimize for the next edit and its verification. Keep evidence detail in your
working context; keep the smallest useful rules and stable navigation links in the document.

## Suggested structure

Adapt this outline to the repository. Omit unsupported/empty sections. Replace every placeholder;
do not reproduce this sample as if its example commands or constraints had been discovered.

```markdown
# Agent guide

## Project and architecture

- <Purpose and runtime in one or two sentences.>
- `<entrypoint>`: <public surface, initialization, or main control flow>.
- `<core directory>`: <responsibility and important dependency boundary>.
- `<tests directory>`: <test organization and representative examples>.
- <Edit-sensitive invariant or data flow, with a stable source/doc link.>

## Development commands

Run from <repository root or explicit package path>. Prerequisites: <documented runtime,
package manager, setup/environment requirements; never actual credentials>.

| Task | Command | Notes |
| --- | --- | --- |
| <Task> | `<verified command>` | <working directory if different, prerequisites, side effects> |

<Distinguish fast/offline checks from full, live, or manual checks where the project does.>

## Code conventions

- <Configured formatting/lint/type rule; point to its configuration.>
- <Representative naming/module/error/testing pattern; qualify it as a convention if inferred.>
- <Repository-specific import or dependency handling.>

## Change constraints

- <Explicit must/must-not policy and source.>
- <Ownership of generated/vendor files and supported regeneration workflow, if any.>
- <Compatibility, schema, security, or migration invariants actually found.>
- <Package-local scope or instructions to consult for work in a particular area.>

## Verification and further guidance

- <How the documented check/test selection maps to affected areas.>
- <Manual/live coverage or known gaps that matter for safe changes.>
- Read `<contribution/architecture guide>` for <deeper detail not duplicated here>.
```

## Compression rules

- Lead with paths and instructions, not an exhaustive tree. Map major responsibilities and the
  handful of contracts likely to cause incorrect edits.
- Prefer stable paths and named sections/symbols over line numbers. Include brief source links for
  consequential rules, not a citation on every mundane sentence.
- A table of commands must say where commands run. Do not invent `npm test`, `make test`, or
  equivalent defaults if this repository uses something else. If a safe verified command is absent,
  say so rather than manufacture one.
- Distinguish explicit policy, configured rules, and consistent observed patterns. Do not turn
  taste, one example, or a scout's recommendation into a mandatory project convention.
- Avoid duplicating contribution docs, nested instructions, or every dependency/version. Retain
  version constraints only when they change setup or compatibility behavior.
- Omit task-specific findings, run IDs, usage statistics, timestamps, investigation narratives,
  speculative architecture, and generic advice such as "write clean code".
- Never persist credentials, sensitive local paths, hidden instructions, or private environment
  values. Repository-relative paths are preferable in the final guide.
- A useful omission caveat is specific and actionable: "Live integration checks require X; the
  offline suite does not cover Y." Do not add empty uncertainty boilerplate.

## Refresh and ownership

Read the current file and preserve its intent. Do not add management markers or label existing
sections as generated unless ownership was explicitly established. If the user already maintains a
generated section with clear boundaries, update only that section; otherwise prefer targeted edits
and preserve unrelated material. If the guide is already accurate and compact, no write is
necessary. Do not repeatedly append duplicate sections on refresh.

Avoid absolute claims about automatic nested instruction loading. Explain scope with paths and
explicitly tell the agent to read relevant local guidance. If a same-directory override takes
precedence, report that outside the generated document and do not change the override implicitly.

## Final quality gate

Before finalizing, verify each retained fact against an inspected source and verify all paths and
command definitions. Re-check conflicts, scope, secret redaction, human-owned guidance, template
placeholders, and document size. Read the actual output and compare the diff with the intended
change. Report checks as static unless executed; onboarding normally runs no project code.
