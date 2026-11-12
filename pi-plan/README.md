# pi-plan

Plan before implementing: explore a project, answer focused questions, review a completed plan,
then choose whether to implement, save, or export it. This is a source-based adaptation of
`@narumitw/pi-plan-mode` **0.58.3**, with readable wrapped menus, questionnaires, and chat cards.

The planning workflow retains settings, saved plans, session recovery, tool policies, and
model/thinking selection for implementation. Local release **0.1.0** is independent of the upstream
version.

## Install

Use the [bundle installation](../README.md#install): run `./install.sh` at the bundle root, then
start Pi or `/reload`. The bundle needs **Node.js 22.19.0+** and Pi's `@earendil-works` host APIs.
There is no build or child install step.

Do not load the npm Plan Mode extension alongside this local one. To load only this extension for a
session after root workspace setup, run from `pi-plan/`:

```sh
pi --no-extensions --extension ./index.ts
```

## Start a planning workflow

Open `/plan` for the interactive menu, or supply a request directly:

```text
/plan Explain the current design and propose a safe migration
```

Choose tools **before** starting if needed. While planning, the agent explores and can ask
structured questions; once the plan is ready, review it before choosing implementation. A normal
request to “make a plan” does not itself activate this workflow.

| Command                     | Purpose                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `/plan`                     | Open the menu for the current planning/saved/implementation state.                          |
| `/plan start`               | Enable planning without sending a prompt.                                                   |
| `/plan <request>`           | Start planning with a request.                                                              |
| `/plan tools`               | Choose the planning tool policy before starting.                                            |
| `/plan show`                | Display the completed, saved, or active implementation plan.                                |
| `/plan finalize`            | Ask the agent to complete the plan.                                                         |
| `/plan implement`           | Start implementation of a completed or saved plan in this session.                          |
| `/plan save`                | Save the completed plan for later.                                                          |
| `/plan export [path]`       | Export to Markdown; default `PLAN.md`, without overwriting an existing file.                |
| `/plan settings`            | Configure thinking, implementation defaults, retention, export path, and optional shortcut. |
| `/plan exit` or `/plan off` | Leave planning or clear saved/active plan state.                                            |

Menus also offer a fresh-session implementation handoff where available. Print/JSON modes lack the
interactive `/plan` menu; use `/plan start` or `/plan <request>`. Some actions, including questions
and settings, require an interactive TUI or RPC UI.

## Answering questions

Use arrows and Enter, or press the displayed option number to choose an answer and advance. The
next number opens **Other** for a custom answer. Review still requires Enter; digits typed in
answer/note editors remain ordinary text. Existing Back and cancellation controls remain available.

Labels, descriptions, prompts, notes, and review summaries wrap at words. Oversized menu tokens may
be ellipsized for display without altering stored answers or IDs. Chat prose and plans wrap without
ellipsis cuts. Resizing recomputes layout, but very short terminals may hide context or
continuations to keep the selected item visible. Selected menu rows use Pi's native `→` marker.

## Settings and safety

Preferences remain in **`pi-plan-mode.json`** in the Pi agent directory; the local package rename
does not rename that file. A configured toggle shortcut takes effect after `/reload` or restart;
there is no default toggle binding. Prefer `/plan settings` over hand-editing settings.

Planning blocks built-in file mutation and limits shell commands, but it is **not a sandbox**.
Non-built-in tools require user opt-in and can have their own side effects. Custom shell-policy
exceptions broaden what may execute. Choosing a tool policy does not activate unavailable tools.
Only start implementation when you intend to permit edits; export itself deliberately writes a new
Markdown file.

The `plan_mode_question` and `plan_mode_complete` tools are for an **active effective Plan
contract**, not ordinary planning requests, roadmaps, writing-plans skills, or plan-file work. Tool
visibility alone does not activate Plan Mode.

## Reference and development

Read the [workflow and execution reference](docs/reference.md) for ownership/cancellation, settings
persistence, tool contracts, TUI/RPC behavior, verification, and upstream update rules. Generic
terminal interaction is shared through the private [TUI workspace](../docs/tui.md); Plan-specific
menus, workflow, chat, and widget stay local.

Use `./install.sh --dev` and `npm run check` from the bundle root. See the
[development guide](../docs/development.md) for focused checks and manual terminal coverage.

## License and provenance

MIT, **Copyright (c) 2026 narumiruna**. The original [LICENSE](LICENSE) is retained. Plan's typed
sources derive from upstream **0.58.3**; the focused menu/questionnaire implementation derives from
TUI Kit **0.59.0**. See [provenance and updates](docs/reference.md#provenance-and-updates) for
archive identity, upstream links, and attribution constraints.
