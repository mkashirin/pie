# pi-plan

Local release **0.1.0**: a focused, source-based adaptation of `@narumitw/pi-plan-mode` **0.58.3**.
The local release version is independent of the upstream source and dependency versions. Pi
discovers the root `index.ts`; implementation lives in `src/`, and regression tests live in
`tests/`. There is no bundled runtime, generated chunk tree, vendor directory, build step, or
separate TUI kit project.

## Behavior and compatibility

The original planning workflow is retained: `/plan`, questionnaires, completion, tool policies,
settings, saved plans, export, implementation handoff, model/thinking selection, session recovery,
mode contracts, workflow ownership, and cancellation. Command/tool names, session identifiers, and
the persisted **`pi-plan-mode.json`** settings filename are unchanged.

The local presentation fixes are also retained:

- Chat tool calls and results use compact, themed Markdown cards rather than raw JSON. Questions,
  numbered choices, answers, notes, cancellation, and completed plans remain readable on resize.
  Chat prose wraps at words without ellipsis cuts; oversized chat tokens wrap at graphemes.
- Questionnaire number keys immediately choose an answer and advance. The next option number opens
  Other (free-form). Review still requires Enter; digits in answer/note editors remain ordinary
  text. Existing arrows, Enter, navigation, and cancellation continue to work.

- Menu labels, descriptions, settings values, questionnaire prompts, review summaries, notes, and
  custom answers wrap at whitespace. Oversized indivisible tokens are safely ellipsized without
  altering stored IDs or answers.
- Selected menus and questionnaires use `→`; selected menu continuations use `│`.
- Resize recomputes wrapping and menu row budgets. Very short terminals may hide context or
  continuation rows, prioritizing selection.
- The persistent widget keeps its separator and wraps rather than truncating; oversized widget
  tokens fall back to grapheme wrapping.
- Search/editing inputs keep Pi's cursor scrolling, keybindings, focus, and raw text behavior.

`src/picker-ui.ts` routes only UI-enabled TUI interactions to the local renderers. RPC and
unsupported/no-UI modes still use the pinned upstream adapters unchanged. The normal
`@narumitw/pi-tui-kit` dependency also provides navigation, tasks, custom-interaction ownership,
borders, hints, definitions, and sanitization through its public API. Those helpers are not copied.
Pi host packages remain peers; no managed release or `node_modules` files are patched.

## Source layout

```text
pi-plan/
├── index.ts                 # Thin Pi discovery shim
├── src/
│   ├── index.ts             # Factory and existing renderer exports
│   ├── plan-mode.ts         # Lifecycle registration and atomic workflow state
│   ├── settings.ts          # Settings validation and queued atomic saves
│   ├── state.ts             # Persisted session restoration
│   ├── tool-policy.ts       # Read-only tool and shell policy
│   ├── presentation.ts      # Persistent widget and plan display
│   ├── chat.ts              # Markdown transcript cards; model payloads stay unchanged
│   ├── *-menu.ts            # Plan-specific menu definitions
│   ├── ...                  # Completion, contracts, handoff, retention, export
│   ├── picker-ui.ts         # Typed TUI/RPC adapter boundary
│   └── ui/                  # Only the required JavaScript renderers/interactions
├── tests/                   # Regression suites and local-package test helpers
├── LICENSE                  # Original MIT attribution
├── package.json
├── tsconfig.json
├── dprint.json
└── README.md
```

The local menu renderer supports only the screen kinds used by Plan Mode: actions, detail, choice,
settings, input, and multiselect. Standalone browse/review screens, document formatting, syntax
highlighting, Mermaid preparation, duplicate RPC runners, and unrelated Kit helpers are not
included. Questionnaire review remains supported by its own required component. Unused upstream
development exports/helpers are omitted; the root factory/renderer exports are preserved.

The workflow's mutable state deliberately stays in one closure in `plan-mode.ts`, as upstream
intended, so splitting files cannot bypass atomic session, policy, thinking, or ownership commits.

## Provenance and updates

The typed Plan Mode modules were restored from the published package's original `src/`, not
reconstructed from generated JavaScript. The npm 0.58.3 archive has SHA-1
`02e0a9e0a2419fbac0603fb7f56a25900fb364ff` and was recovered from the local npm cache.

The focused UI modules derive from the previously installed `@narumitw/pi-tui-kit` **0.59.0**
runtime and the existing local wrapping adaptations. Its exact version/archive integrity remains in
`../package-lock.json`. Both upstream packages use the same unchanged MIT license retained here.
Upstream sources:

- <https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-plan-mode>
- <https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-tui-kit>

Update deliberately against the matching upstream source/version, retaining only the required
modules and accounting for Kit contract changes. Preserve the local widget, wrapping, adapter,
settings-name, and attribution changes. Do not replace this source tree with `dist/`, copy the full
Kit, or re-enable the npm Plan Mode extension alongside this one.

## Checks and loading

Install centralized tooling with `npm run setup:dev` from the repository root, then run root `npm
run check` for all workspaces or `npm run check` from this directory for Plan Mode. All four
extensions are npm workspaces with one root `package-lock.json`, no child lockfiles, and no child
development dependencies. Checks require the workspace checkout and root setup.

This checks formatting, strict TypeScript for the core/adapter, and regression tests. The UI
JavaScript is exercised by the runtime harnesses. Root-installed dprint handles formatting; type
checking uses `tsc --noEmit`, and tests use root-installed jiti and Pi packages. Root development
dependencies pin `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to **1.0.0**; no
managed Pi installation is needed. Runtime host packages remain peers. Use root `npm run format` to
apply the root and workspace formatting configurations.

All local source follows the workspace style: four spaces, double quotes, parenthesized arrow
parameters, definition spacing, 100-column formatting, and LF endings. Markdown is wrapped at 99
columns. Dependencies and the lockfile are excluded from formatting.

For automatic personal loading, install the workspace bundle following
[the repository instructions](../README.md), without a duplicate `packages` settings entry. From a
checkout elsewhere, use `pi --extension ./index.ts` from this directory. Pi loads the TypeScript
source without a build step. Use `/reload` or restart Pi after changes. Automated checks cover the
locally installed Pi 1.0.0 loader, core compatibility, wrapping, Unicode, resize, focus, raw
IDs/text, settings saves/rollback, cancellation, caller routing, and upstream RPC equivalence. They
do not replace a live terminal check of `/plan` and `/plan settings`, including model/thinking
selection, tools, questionnaire review, and Back.
