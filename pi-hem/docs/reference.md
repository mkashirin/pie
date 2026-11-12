# HEM reference

[Quick start and keys](../README.md) · [Bundle development](../../docs/development.md)

## Editing contract

[`src/model.ts`](../src/model.ts) owns grapheme-based selections, a primary selection, modes, and
edits. [`src/commands.ts`](../src/commands.ts) dispatches normal/select/insert/replace commands,
counts, and pending prefixes. Undo/redo groups insert edits.

The authoritative command sources are [`src/compatibility.ts`](../src/compatibility.ts) and the
generated [`reference/runtime-coverage.json`](../reference/runtime-coverage.json). The inventory
classifies bindings as implemented, pending (`NOT_YET_IMPLEMENTED`), delegated to Pi, or excluded.
[`tests/compatibility.test.mjs`](../tests/compatibility.test.mjs) checks classifications,
fingerprints, inventory consistency, and implemented binding dispatch. Reachability tests do not
prove byte-for-byte upstream semantics or actual terminal viewport behavior.

Consequential editing details:

- `x` selects whole logical lines, including newlines, and repeats downward; it does not force
  select mode. `I` means first non-whitespace, not column zero. `A` appends at line end. `l` can
  reach the empty position after the final character.
- `v` toggles selection extension. Motions include words and logical lines; editing includes case
  changes, joins, indentation, replacement, and repeat edits.
- Text objects and surrounds (`md`/`mr` included) are textual heuristics. Directional objects cover
  words, WORDs, paragraphs, and sentences, not syntax-aware parsing.
- Search (`/`, `n`, `N`) and selection/splitting use **Rust regex syntax**, including inline flags,
  not JavaScript regex. Invalid patterns leave the search prompt active; cancellation restores
  previous selections.
- Marks and jump/change lists store selection snapshots. Offsets are not rebased through edits, and
  jump history does not capture every motion. Rectangles follow logical lines, not full visual-row
  semantics. Digraph coverage is partial; there is no horizontal viewport.
- Paging depends on host viewport callbacks. A declared binding is not proof of live-terminal
  paging parity.

### Registers and replay

[`src/registers.ts`](../src/registers.ts) supports private unnamed/named registers, uppercase
append, blackhole, yank register `0`, small-delete register `-`, and numbered multiline deletion
history. Fragment-aware paste distributes fragments across selections and repeats the last fragment
where necessary. Only explicit `+`/`*` address desktop clipboards.

Bounded macro and dot replay are text-only. They do not repeat provider requests, clipboard
subprocesses, submission, or host viewport effects. Accepted completion edits and clipboard paste
values are captured for replay instead of fetched again.

### Exclusions

No file/project/workspace/tab/pane management; syntax trees, diagnostics, code navigation, or LSP
actions; IDE tasks/debug/terminal management; filesystem open/save commands; general Ex language;
or shell/external-program execution through modal commands. The explicit clipboard integration
below and Pi's own external editor are distinct from a modal shell-command facility.

## Pi integration

[`src/index.ts`](../src/index.ts) installs the editor only for TUI sessions. On startup it loads
regex dynamically, catches initialization failure, and retains/restores the host editor with an
error notification rather than preventing extension loading. Session generation checks prevent late
initialization from replacing a newer session; shutdown disposes editor state and timers.
[`src/input.ts`](../src/input.ts) decodes terminal input; [`src/layout.ts`](../src/layout.ts)
handles editable-cell layout, not generic transcript wrapping.

Routing order matters:

1. History/completion handling has its own early routing.
2. Normal/select bindings and pending prefixes consume overlapping app/extension shortcuts.
3. Unhandled keys fall through to Pi; insert-mode app shortcuts generally remain available.
4. Escape cancels completion or pending input before leaving a mode/collapsing selections, and only
   then reaches Pi interrupt.

Escape decoding has a **25 ms ambiguity window**. Delayed legacy Alt input can be treated as Escape
plus a following key; different terminal protocols/timing still require manual checks.

`Enter` submits outside pending input; `Shift+Enter`/`Ctrl+J` inserts a newline in insert mode.
Submission/programmatic replacement restores insert mode; bracketed paste enters insert mode. Slash
commands and attachment triggers (`@`, `#`) auto-open completion; `Tab` requests paths. Large
pastes are rendered in full. Layout wraps at words then graphemes and shows a mode label when space
permits. Installation never rewrites user keybindings/configuration.

## Clipboard

[`src/clipboard.ts`](../src/clipboard.ts) uses platform executables:

| Platform        | Requirements                                            |
| --------------- | ------------------------------------------------------- |
| macOS           | `pbcopy`, `pbpaste`                                     |
| Linux / Wayland | `wl-copy`, `wl-paste`, and a Wayland display            |
| Linux / X11     | `xclip` and an X11 display                              |
| Windows         | `powershell.exe` with `Get-Clipboard` / `Set-Clipboard` |

Primary selection is Linux-only. Private registers need none of these. Clipboard values are sent on
stdin, never interpolated into shell commands. Missing tools/displays or subprocess failures must
not be reported as successful destructive cuts. Native clipboard interoperability needs manual
target-machine verification; replay reuses captured text rather than rerunning subprocesses.

## Runtime and public API

Use the [bundle installation](../../docs/installation.md). HEM's package engine is
**Node.js >=22.18.0**, but the supported bundle/development baseline is **>=22.19.0** with Pi
**1.5.0** APIs. There is no build. Runtime peers come from Pi.

`rregex` is pinned exactly to **1.13.5**. Its Node entry loads packaged WASM synchronously from
disk without a network fetch. Runtime-only installations must include this dependency, not just
copy sources. Retain [third-party notices](../THIRD_PARTY_NOTICES.md).

[`index.ts`](../index.ts) preserves the default extension and `HelixEditor`, and exports:

- `HelixBuffer`, `graphemes`; types `Selection`, `RangeEdit`, `Mode`.
- `CommandController`; types `CommandOptions`, `CommandView`.
- `InputDecoder`; type `InputEvent`.
- `RegisterBank`; types `RegisterValue`, `RegisterOperation`.

Regex is deliberately not re-exported from the root; initialization remains inside the integration
fallback catch. [`tests/public-api.test.mjs`](../tests/public-api.test.mjs) checks the actual root
exports, and the packaging test loads the packed entry.

## Development and packaging

Set up once with `./install.sh --dev` from the bundle root. From `pi-hem/`:

```sh
npm run check
node --test tests/packaging.test.mjs
```

`check` runs dprint, TypeScript, and offline tests, including packaging. The second command is a
focused rerun. Tests cover model/selections, commands, inserts, text actions, registers, input,
layout/editor routing, effects, public API, and compatibility metadata.

The [packaging regression](../tests/packaging.test.mjs) runs `npm pack --ignore-scripts` to avoid
recursive prepack, extracts into a temporary directory, copies locally available runtime
dependencies and jiti, then loads the package entry and regex WASM in a child Node process with
network fetch forbidden. It needs npm, tar, and the local development dependency baseline. It is
not a clean registry install or a live Pi UI smoke test.

The package allowlist includes `index.ts`, `src/`, README, LICENSE, `THIRD_PARTY_NOTICES.md`, and
runtime-imported `reference/resolved-arguments.ts`. Tests, other reference fixtures, development
configuration, and lockfiles are excluded. Changing imports or shared workspace dependencies needs
packed/runtime closure checks, not just source tests. The normal `prepack` hook runs checks;
publication also requires reviewed metadata, registry/name checks, and `npm pack --dry-run`.

Manual checks remain necessary for resize, narrow widths, staged Escape/Alt timing, host paging,
completion/submission precedence, and native clipboards. Automated binding coverage does not
establish upstream parity; the declared minimum Node engine also needs separate verification.

## Provenance

Upstream compatibility inputs, pinned revisions, and checksums are recorded in
[`reference/source.json`](../reference/source.json); preserve those fingerprints when updating the
binding inventory and runtime-imported resolved argument metadata. Local code is MIT under
[LICENSE](../LICENSE); the `rregex` dependency is Apache-2.0 with its notice retained separately.
