# Extension bundle operating guide

This supplements the agent-directory guidance; it records repository-specific edit and check paths.

## Architecture and entrypoints

- This is a source-only ESM npm workspace bundle. Pi loads TypeScript directly; there is no build.
- Root [`package.json`](package.json) declares six `pi.extensions` entrypoints and `pi.skills`.
  Keep discovery separate from workspace membership: `pi-kit/` is support code, not an extension.
- [`pi-hem/index.ts`](pi-hem/index.ts) exports the editor/core; `src/index.ts` installs only the
  TUI prompt editor. Buffer/commands/input/layout/clipboard live in separate `src/` modules.
- [`pi-lsp/index.ts`](pi-lsp/index.ts) registers tools/status. `src/runtime.ts` coordinates
  configuration, file routing, server clients, fixes, and bounded result packets.
- [`pi-plan/src/plan-mode.ts`](pi-plan/src/plan-mode.ts) owns lifecycle and workflow state in one
  closure. Menus, settings, session restoration, contracts, chat, and handoff helpers remain local.
- [`pi-kit/`](pi-kit) (`@pi-extensions/pi-kit`) centralizes generic host-TUI presentation and local
  menu/questionnaire interactions. Read [the pi-kit guide](docs/pi-kit.md) before editing it.
- [`pi-kit/src/interaction.ts`](pi-kit/src/interaction.ts) exposes the typed TUI/RPC interaction
  boundary; generic TypeScript implementations live in `pi-kit/src/interaction/`, not Plan's domain
  workflow.
- [`pi-openai-subagents/index.ts`](pi-openai-subagents/index.ts) wires policy/configuration, child
  execution, reports/evidence, and fleet UI. Domain runtime/state/presentation stay local.
- [`pi-openai-web/index.ts`](pi-openai-web/index.ts) registers native search and credential-free
  page reading; `src/` separates config, network/runtime, evidence/results, and presentation.
- [`pi-openai-multi/index.ts`](pi-openai-multi/index.ts) owns explicit account selection and
  provider registration; vault, credentials, bridge, migration, and OAuth remain package-local.
- Prefer native Pi APIs where sufficient. Do not move editor, fleet, OAuth, domain state, or
  extension registration into pi-kit.

## Setup and verification commands

Run these from the **bundle root** with Node.js **22.19.0+** and npm. Development uses the pinned
Pi **1.5.0** host APIs. Runtime host packages remain peers supplied by Pi.

| Task                | Command                             | Scope / effects                                                        |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| Runtime setup       | `./install.sh`                      | Locked runtime install in this checkout; no Pi settings changes.       |
| Development setup   | `./install.sh --dev`                | Reinstalls root dependencies including tooling; may use network/cache. |
| Complete local gate | `npm run check`                     | Root formatting/tests and all seven workspace gates.                   |
| Workspace gates     | `npm run check --workspaces`        | Does not include root installer tests.                                 |
| Focused package     | `npm run check --workspace pi-plan` | Substitute the affected workspace name.                                |
| Root tests          | `npm test`                          | `tests/*.test.mjs`; installer fixtures stub npm.                       |
| Types               | `npm run typecheck`                 | Workspace `tsc --noEmit`.                                              |
| Formatting check    | `npm run format:check`              | Root and workspace dprint configurations.                              |
| Apply formatting    | `npm run format`                    | Writes broadly; use explicit paths for scoped tasks.                   |
| LSP loader smoke    | `npm run smoke:lsp`                 | Separate opt-in loader check; not a live server check.                 |

One root `package-lock.json` owns all workspace dependencies. No child installs or child lockfiles.
Coordinate root scripts, dependency changes, and lockfile updates across consumers. Installer scope
is enforced by [`install.sh`](install.sh) and
[`tests/install-scope.test.mjs`](tests/install-scope.test.mjs). Do not edit installed dependencies
or Pi's managed installation to repair this checkout.

## Conventions and fragile boundaries

- Follow local dprint configs: four spaces, double quotes, parenthesized arrows, LF, 100-column
  source, 99-column Markdown; preserve import/export order. Exclude lockfiles/dependencies.
- Strict NodeNext/noEmit is configured per package. Do not homogenize ES2022/ES2023 targets. Shared
  interactions are TypeScript and must remain consumable without `allowJs`.
- Tests generally use `node:test`, source imports/jiti, and local fixtures; Multi also uses tsx.
  Read affected test loaders before changing imports or package boundaries.
- Match native Pi UI chrome: arrow selectors/key hints, checkmarks, and dot separators. Keep host
  overflow markers and user/model content unchanged; never patch `node_modules` for styling.
- Wrapping, sanitization, whitespace, hyperlinks, padding, and width are policy-specific. Preserve
  raw evidence/IDs/answers/model payloads while sanitizing display. Do not flatten these policies
  into one universal wrapper. Tool-card shell margins belong to Pi; widgets have separate layout.
- Dispose timers/listeners and respect session generations/cancellation. A stale interaction must
  not commit into a replacement session; domain lifecycle ownership stays with its extension.

## Safety and compatibility constraints

- Never load this bundle alongside duplicate registrations of the same extensions. The explicit
  root manifest must keep exactly the intended six extension entrypoints.
- LSP project config is executable trust, not data-only setup. First existing config wins even when
  invalid; do not fall back silently. No automatic language-server installation.
- LSP fixes preview by default. Reject stale/conflicting/cross-file/resource/command actions;
  preserve UTF-16, BOM, line endings, atomic single-file write and committed-write metadata.
- Diagnostic findings are successful collection; incomplete/partial/cancelled collection is not a
  clean workspace. Bounded reports and private temporary artifacts must retain outcome metadata.
- HEM replaces only the prompt. Preserve mode/key precedence, Escape timing, text-only replay,
  private-register defaults, and clipboard failure behavior. Binding reachability is not parity.
- Plan tools require an active effective Plan contract; visibility alone is insufficient. Keep
  workflow ownership and session/model/thinking/policy commits atomic in `plan-mode.ts`.
- Preserve Plan's `pi-plan-mode.json`, session identifiers, tool names, RPC/no-UI fallback, raw
  answers, and cancellation. Keep Plan/shared interactions locally implemented; do not introduce
  copied third-party Pi-extension code or dependency/type aliases to those extensions.
- Account use is explicit. Preserve consumer model precedence, including eligible active-model
  inheritance when unconfigured. Do not rewrite saved assignments, copy credentials, or migrate
  settings automatically.

## Selecting checks and finding detail

- pi-kit edits need shared tests plus affected consumers; source-only dependency closure and
  runtime-only loading need separate verification when imports/manifests change.
- HEM: [reference](pi-hem/docs/reference.md), especially binding inventories, packaging, and
  real-terminal Escape/viewport/clipboard checks. Retain regex WASM notices and packed metadata.
- LSP: [reference](pi-lsp/docs/reference.md), especially config precedence, completeness, safe
  writes/artifacts, fixtures, loader smoke, and provider cutover.
- Plan: [reference](pi-plan/docs/reference.md), especially workflow/settings atomicity, TUI/RPC
  parity, numeric answers, resize/focus, and source update constraints.
- [Development](docs/development.md) maps gates, formatting, releases, and manual terminal checks.
  Offline checks do not prove clipboard, OAuth, live search/server, or terminal timing behavior.
- [Installation](docs/installation.md) covers loading and skills. Follow
  [onboard](skills/onboard/SKILL.md) for evidence-backed guide maintenance; retain security,
  keybinding, licensing, and failure semantics when consolidating documentation.
