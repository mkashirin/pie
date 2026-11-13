# Plan workflow and execution reference

[Commands and quick start](../README.md) · [Bundle development](../../docs/development.md) ·
[pi-kit guide](../../docs/pi-kit.md)

## Workflow ownership and tools

[`src/plan-mode.ts`](../src/plan-mode.ts) owns lifecycle registration and mutable workflow state in
one closure. Keep session, policy, thinking/model, and ownership commits atomic there; splitting
helpers must not allow a stale callback to bypass those checks.

[`src/workflow-mutex.ts`](../src/workflow-mutex.ts) coordinates workflow ownership;
[`src/state.ts`](../src/state.ts) restores persisted session entries; contracts and message
transforms retain the distinction between planning and ordinary requests. Session changes,
shutdown, replacement, and cancellation must prevent old menu/action results from committing into a
new workflow. Preserve command/tool names and persisted session identifiers when updating.

Only the latest effective contract explicitly activating `/plan` permits the planning tools.
Visible schemas are session capabilities, not activation. Do not call these tools for ordinary
planning requests, the writing-plans skill, roadmaps, checklists, or plan-file work.

- [`plan_mode_question`](../src/question-tool.ts): **1–3** structured questions, each with a stable
  ID, short header, question text, and **2–4** choices. The schema requires labels and
  descriptions. Interactive UI and current workflow ownership are required. Cancellation returns
  structured reasons such as `cancelled`, `ui_unavailable`, `plan_mode_inactive`, or
  `invalid_input`. Custom responses are bounded; the source defines the exact normalization.
- [`plan_mode_complete`](../src/completion-tool.ts): a nonblank Markdown `plan` of at most **50,000
  characters**, called alone as the final action. Version-1 details retain `source:
  "plan_mode_complete"` and `plan`; completion terminates the turn. The runtime rejects completion
  outside an active owned workflow. Legacy proposed-plan parsing remains supported for recovery,
  not a reason to change the persisted format.

### Tool policy

[`src/tool-policy.ts`](../src/tool-policy.ts) classifies built-ins as read-only, limited, or
blocked. Built-in `edit` and `write` are blocked; Bash/PowerShell are limited by command checks.
Non-built-in tools are user-opt-in and run at user risk. This is not a subprocess or filesystem
sandbox. Explicit `safeSubcommands` settings are trusted policy exceptions, not proof that an
arbitrary command is read-only.

Tools are chosen before planning starts and locked while active; exit and choose again to change
them. The allowlist never activates unavailable tools. Preserve runtime tool-call policy checks,
not just menu filtering. Export and explicit implementation are deliberate transitions that can
write; they are not evidence that exploration tools may mutate files.

## Settings, export, and handoff

[`src/settings.ts`](../src/settings.ts) keeps the **`pi-plan-mode.json`** filename in Pi's agent
directory and handles the legacy `plan-mode.json` compatibility path. Settings validation and
queued atomic saves preserve unknown document data, reject malformed/oversized documents, and must
retain cancellation/rollback behavior. Read the source before extending settings patches.

The settings surface includes planning thinking level (`inherit` supported), default planning
tools, implementation retention, implementation model/thinking defaults, default export path,
optional toggle shortcut, and trusted shell subcommand exceptions. The supported values and
normalizers live in `settings.ts`; do not duplicate a second exhaustive schema in docs.

Shortcut registration is fixed for the runtime because Pi snapshots editor bindings. Settings
saves/file watches do not rebind it until `/reload` or restart. No toggle shortcut is configured by
default.

[`src/plan-export.ts`](../src/plan-export.ts) resolves a requested path (or default `PLAN.md`)
relative to the current working directory, accepts a leading `@`, and rejects empty/NUL paths. It
writes with exclusive creation (`wx`), so it does not overwrite an existing file; it can create
parent directories. It runs under the host file-mutation queue and checks lifecycle cancellation.
Export of a ready plan can finish planning; saved/active plans can also be exported.

Implementation can continue in the current session or use a fresh-session handoff from the menu.
[`src/fresh-handoff-coordinator.ts`](../src/fresh-handoff-coordinator.ts),
[`src/fresh-implementation.ts`](../src/fresh-implementation.ts), and the runtime/retention helpers
coordinate session admission, model/thinking selection, restoration, and retention. Preserve queued
input and stale-session protections rather than treating handoff as a simple prompt send.

## Presentation and adapter boundary

The root [`index.ts`](../index.ts) is the Pi discovery shim; [`src/index.ts`](../src/index.ts)
preserves the factory and existing renderer exports. There is no build or compiled chunk tree.

The shared [`pi-kit/src/interaction.ts`](../../pi-kit/src/interaction.ts) entrypoint owns local
typed menus and questionnaires. TUI uses Pi's custom-component/input APIs; RPC uses native select,
input and editor dialogs. No-UI/unsupported modes return explicit outcomes without constructing
terminal components. Plan-specific menu definitions remain under `src/*-menu.ts`; generic
TypeScript implementations live under [`pi-kit/src/interaction/`](../../pi-kit/src/interaction/).
The private source-only `@pi-extensions/pi-kit` workspace is shared support code, not a seventh Pi
extension. See [the pi-kit guide](../../docs/pi-kit.md) for its public surface. Keep interaction
ownership, abort handling, navigation, hints, and sanitization there rather than duplicating
private adapters inside Plan.

Presentation contracts to retain:

- [`src/chat.ts`](../src/chat.ts) renders tool calls/results as compact themed Markdown cards, not
  raw JSON. Questions, answers, notes, cancellation, and completed plans remain readable; prose
  wraps at words and oversized chat tokens at graphemes, without ellipsis cuts.
- [`src/presentation.ts`](../src/presentation.ts) displays proposed/saved/active plans and
  recovered input with Pi's current `outputPad` (`0` or `1`), including `/settings` changes. Tool
  cards retain native host shell margins. The persistent widget is full-width, keeps its separator,
  and wraps oversized tokens at graphemes rather than truncating.
- Menus/questionnaires wrap labels, descriptions, values, prompts, review, notes, and custom
  answers at whitespace. Oversized indivisible display tokens use safe ellipsis without changing
  IDs or stored answers. Selected rows use Pi's native `→` marker; continuations can use `│`.
- Resize recomputes physical row budgets. Short terminals prioritize selected visibility and may
  hide context/continuation rows. Search/input retains host focus, cursor scrolling, keybindings,
  and raw text behavior.
- Number keys choose answers and advance; the next option number opens Other. Review requires
  Enter. Digits inside answer/note editors are literal; notes, Back, navigation, and cancellation
  remain intact.

## Verification

After `./install.sh --dev` at the bundle root, run root `npm run check` for the full bundle or `npm
run check --workspace pi-plan` for Plan. Shared interaction changes also need the pi-kit gate and
affected consumer gates. No child install or managed Pi patch is required.

The package gate checks formatting, strict TypeScript for the core/interactions, and regression
tests using root tooling/jiti and Pi **1.5.0**. Local host-contract fixtures drive TUI and RPC
behavior without importing another Pi extension. Tests map as follows:

- [`tests/core.test.mjs`](../tests/core.test.mjs): local Pi loader/exports, completion and legacy
  formats, state recovery, policy, settings, export, finalization/retention, workflow ownership.
- [`tests/picker.test.mjs`](../tests/picker.test.mjs): wrapped menu kinds, Unicode widths, physical
  row budgets/resize, focus, hints, raw IDs/text, cancellation, caller routing, RPC parity, and
  local source/dependency closure assertions.
- [`tests/questionnaire.test.mjs`](../tests/questionnaire.test.mjs) and
  [`tests/numbers.test.mjs`](../tests/numbers.test.mjs): wrapped questions/review/editors, remapped
  keys, number shortcuts, notes, cancellation, and explicit RPC protocol expectations.
- [`tests/chat.test.mjs`](../tests/chat.test.mjs) and
  [`tests/widget.test.mjs`](../tests/widget.test.mjs): readable cards, wrapping, resize,
  sanitization, persistent widget, and padding boundaries.

[`tests/independent-core.test.mjs`](../tests/independent-core.test.mjs) adds shell-policy, settings
publication, export rollback, restoration, and fresh-session adverse cases.
[`tests/independent-runtime.test.mjs`](../tests/independent-runtime.test.mjs) exercises actual
registered handlers/tools, ownership replacement, runtime rollback, retention, and stale UI
callbacks.

Live terminal checks remain necessary: `/plan` and `/plan settings`, narrow/wide/short-terminal
resize, remapped keys/focus, model/thinking and tool selection, questionnaire numbers/Other/notes,
review/Back/cancellation, plan save/export, and current/fresh implementation handoff. Offline tests
are not live terminal, model-access, or minimum-Node verification.

## Source updates

Plan's workflow and shared menu/questionnaire state machines are local implementations against Pi's
public host APIs. Maintain them from their behavior contracts and regression tests; do not restore
copied third-party Pi-extension source or runtime/type dependencies.

Preserve workflow closure, settings/session compatibility, widget/chat/wrapping, and TUI/RPC/no-UI
routing. Extend adverse lifecycle tests when changing asynchronous operations. An obsolete
coordinator must not issue new model/thinking changes, commits, or notifications after session
replacement; an already-issued host model operation cannot be retracted by this extension. Do not
patch managed Pi or `node_modules`, or load another Plan provider beside this extension. Retain the
project [LICENSE](../LICENSE); ordinary runtime dependencies keep their own licenses.
