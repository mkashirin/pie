# Development and verification

[Bundle overview](../README.md) · [Installation](installation.md) · [Agent guide](../AGENTS.md)

## Workspace model

This is a source-only npm workspace bundle. The root `pi.extensions` manifest lists **six** Pi
entrypoints; the private [`tui/`](tui.md) support package makes **seven** npm workspaces. It is not
another extension. Pi supplies host peers at runtime. Development tooling pins the
`@earendil-works` host APIs to **1.5.0**. Shared interactions have no third-party Pi-extension
runtime or type dependency. There is no build step.

Keep shared, generic terminal presentation and menu/questionnaire interactions in `tui/`. Extension
registrations, domain presenters, HEM's editor, Subagents' fleet, Plan's workflow, and Multi's
OAuth remain local. Prefer native Pi APIs where sufficient. Consult [the TUI guide](tui.md) before
changing shared behavior; its policies are not interchangeable with every domain renderer.

One root lockfile owns the dependency graph. Child packages use root-installed tooling; some have
package-specific development dependencies declared in their manifests, still installed by root
setup. Do not install separately in child directories or introduce child lockfiles. Changes to
shared dependencies, root scripts, and lockfiles affect every consumer and need coordinated
verification.

## Setup and commands

Run from the **bundle root**, with Node.js **22.19.0+** and npm:

```sh
./install.sh --dev
npm run check
```

Setup runs one local `npm ci --include=dev` with the installer's scope safeguards. It reinstalls
`node_modules` and may access the network/cache; it does not run tests, change Pi settings, or
modify Pi's managed installation. `npm run setup:dev` is a direct root npm-ci alternative, not a
child setup command. Re-run root setup after dependency/lockfile changes.

| Command (root directory)     | Purpose                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `npm run check`              | Root formatting and root tests, then each workspace's formatting/type/tests gate. |
| `npm test`                   | Root `tests/*.test.mjs`, including installer scope regression tests.              |
| `npm run check --workspaces` | Workspace gates only; does not replace root tests.                                |
| `npm run typecheck`          | Workspace TypeScript checks without emitting output.                              |
| `npm run format:check`       | Root and workspace dprint checks.                                                 |
| `npm run format`             | **Writes** formatting changes across the root and workspaces.                     |
| `npm run check:lsp`          | Focused LSP workspace gate.                                                       |
| `npm run smoke:lsp`          | LSP runtime-loader smoke entry, separate from its normal test suite.              |

A focused package check is `npm run check --workspace pi-plan` (substitute another workspace name),
or `npm run check` from that package after root setup. Shared UI changes need the TUI gate and
affected consumers, not just a single extension check. Root `npm run check` is the complete local
gate, not a certificate of real-terminal compatibility.

## What checks cover

Most regression suites use `node:test` and local fixtures. Many source-loading tests use jiti;
Multi also uses tsx. TypeScript uses strict NodeNext, direct source imports, and `noEmit`. Plan and
shared interactions are fully TypeScript-checked and tested with local host-contract fixtures;
public TUI consumption does not require `allowJs`.

The installer suite, [`tests/install-scope.test.mjs`](../tests/install-scope.test.mjs), creates
isolated fixtures and a stub npm executable. It checks local scope, argument handling, explicit
manifest paths, and rejection of missing/out-of-checkout resources. It does not actually install
dependencies or make network requests.

Package-specific contracts and manual coverage are documented here:

- [HEM reference](../pi-hem/docs/reference.md#development-and-packaging): controller/model/input,
  binding inventory, public exports, clipboard effects, and offline packed-entry/WASM checks.
- [LSP reference](../pi-lsp/docs/reference.md#development-and-rollout): fixture servers,
  diagnostics completeness, safe fixes, bounded reports, loader smoke, and provider rollout.
- [Plan reference](../pi-plan/docs/reference.md#verification): workflow/session state, settings
  atomicity, TUI/RPC routing, questionnaires, chat, and widget behavior.
- [TUI guide](tui.md): shared framework policies and tests.
- [Subagents](../pi-openai-subagents/README.md), [Web](../pi-openai-web/README.md), and
  [Multi](../pi-openai-multi/README.md): their domain-specific setup and verification.

HEM's packaging regression invokes `npm pack --ignore-scripts`, tar, and a child Node loader in a
temporary directory. It uses locally installed dependencies, not a registry installation. LSP's
normal suite skips the opt-in runtime-loader test; `npm run smoke:lsp` enables it. Neither proves a
clean runtime-only bundle installation. Verify that separately when changing package closure,
workspace imports, dependencies, or discovery.

No hosted CI workflow is provided. Local offline checks do not exercise account login, paid search,
installed language servers, native clipboards, or terminal-protocol timing. Do not label those
integrations verified because fixture tests pass.

## Terminal presentation and manual checks

Match native Pi chrome: `→` selection, arrow-key hints, checkmarks, and dot separators. Reuse host
components and indicators instead of ASCII substitutes or new animation loops. Keep native `...`
overflow markers, checkbox syntax, and user/model content unchanged. Adapt vendor hints at the
supported boundary, not in installed dependencies. See [shared TUI policy](tui.md).

Do not merge wrapping policies blindly. Transcript evidence, hyperlinks, editor cells, menu labels,
and diagnostic lines have different whitespace/width requirements. Sanitize presentation without
mutating raw IDs, answers, source evidence, or model payloads. Native tool cards keep host-owned
shell margins; persistent widgets need their own layout rather than duplicated shell padding.

For terminal-affecting changes, check narrow and wide widths, very short terminals, resizing,
Unicode graphemes, themes, focus, remapped hints, cancellation, and shutdown/disposal. Then test
the affected domain: HEM Escape/completion/clipboard, Plan questionnaire review/Back and
model/thinking selection, Subagents fleet lifetime, Web evidence/hyperlinks, or LSP severity and
write outcomes. Detailed package references list the non-automated boundaries.

## Source style

Follow root and workspace dprint configurations: four spaces, no tabs, double quotes, parenthesized
arrow parameters, LF endings, 100-column source and 99-column Markdown wrapping. Import/export
declaration order is preserved. Do not format dependency trees or lockfiles. TypeScript targets
differ by package (HEM and Multi ES2022; several others ES2023); inspect the local `tsconfig.json`
rather than copying another package's compiler configuration.

Use explicit file arguments for scoped formatting rather than root `npm run format` when unrelated
work must remain untouched. New documentation may need explicit formatter selection if its path is
not included in the current dprint configuration. Keep README focused on purpose, essential
setup/use, limitations, and links; put detailed execution contracts in linked docs.

## Documentation and agent maintenance

Use [`skills/onboard/SKILL.md`](../skills/onboard/SKILL.md) and its bundled inspection/output
references when refreshing the [agent guide](../AGENTS.md). Inventory before deep reading, read
actual entrypoints/manifests/tests, and distinguish configured contracts from observed patterns.
Keep consequential claims tied to stable paths rather than copied source inventories or volatile
line counts.

For optional scouts, provide explicit file paths and read-only scope. Inspect failed/partial
reports; do not treat retrieval plans as completed inspection. The foreground must verify and
compact findings. Read-only orchestration requires a scoped writer and linked reviewer, or a
returned draft; writing does not make a self-check independent review.

When moving prose out of README, preserve security warnings, configuration precedence, failure
semantics, keybindings, licensing, and useful manual checks in the linked reference. Statically
check local paths and anchors. Distinguish inspected command definitions, executed offline tests,
and live/manual results in handoffs. Do not claim coverage for checks that did not run.

## Releases

The local release is **0.1.0**. Keep root and six extension release versions and their root
lockfile entries in sync; the private TUI support package is not another extension release.
Dependency versions remain independent. Inspect manifests when changing release metadata rather
than inferring versions from package names. Private package flags prevent accidental npm
publication, not Git-based Pi installation.

For a new remote, create an empty repository, add its URL as `origin`, and push the reviewed
branch. After verification, an optional release tag is `v0.1.0`; create and push that tag before
advertising it in a Pi install URL. Publishing or committing is a deliberate maintainer action, not
a setup or verification step. HEM's prepack hook runs its checks; inspect its allowlist, metadata,
name availability, registry contents, and `npm pack --dry-run` before any separately reviewed
publication.

Retain package LICENSE files and ordinary dependency notices. Plan and shared interactions must
remain local source implementations rather than copied third-party Pi extensions. See
[Plan source update constraints](../pi-plan/docs/reference.md#source-updates) and
[HEM notices](../pi-hem/THIRD_PARTY_NOTICES.md) before redistributing source or dependencies.
Replacing an implementation does not relicense older revisions or the ordinary libraries shipped
with an installation.
