# pi-hem (Helix Editor Mode for Pi)

HEM replaces **Pi's main prompt editor only**, in interactive sessions. It starts in **insert
mode**; press `Escape` for normal mode. Pickers, dialogs, transcript navigation and the external
editor are not replaced. This is a **substantial Zed-compatible text editor** for the prompt, not
certified byte-for-byte Zed or Helix parity. Exact reachable bindings and pending status are
tracked in `src/compatibility.ts` and the generated `reference/runtime-coverage.json` inventory;
consult those moving inventories rather than a fixed coverage count.

## Editing

The buffer supports multiple grapheme-based selections with a primary selection, counts, normal,
select, insert and replace modes, undo/redo, and grouped insert edits. Highlights include:

- `h j k l`, word motions and logical-line motions; `v` toggles selection extension.
- `x` expands to whole logical lines including newlines, repeating downward. It does not itself
  force select mode. `I` inserts at first non-whitespace, not necessarily column zero; `A` appends
  at line end. `l` can reach the empty position after the final character.
- `d c y p P`, selection replacement, case changes, joins, indentation and repeat edits.
- Text objects and surround operations, including `md`/`mr`; these are textual heuristics, not
  syntax-aware parsing. Directional objects currently cover words, WORDs, paragraphs and sentences.
- Multiple-selection occurrence operations, regex selection/splitting and search with `/`, `n` and
  `N`. Regex syntax is Rust regex syntax, including inline flags, not JavaScript regex syntax.
  Invalid patterns keep the search prompt active; cancellation restores prior selections.
- Private unnamed and named registers, uppercase append, blackhole, yank register `0`, small-delete
  register `-`, and numbered multiline deletion history. Fragment-aware paste distributes register
  fragments across selections, repeating the final fragment when necessary. Explicit `+` and `*`
  registers address the system clipboard and primary selection respectively.
- Bounded macro recording/replay, in-buffer marks, selection-snapshot jump/change lists, basic
  logical-line rectangular selections, and a partial digraph table.

This is not an exhaustive command reference. The digraph table is not a complete
upstream-equivalent table. Syntax-aware objects are excluded. Saved jump/change offsets are not
rebased through edits; jump history does not capture every motion. Rectangles use logical lines
rather than full visual-row semantics. There is no horizontal viewport. Paging depends on host
viewport callbacks; command coverage alone does not establish real-terminal viewport behavior or
upstream semantic parity. Private registers are the default; the system clipboard is used only when
explicitly requested.

Macro and dot replay are text-only: they do not repeat provider requests, clipboard subprocesses,
submission, or host viewport effects. Accepted completion edits and clipboard paste values are
captured for replay rather than fetching them again.

### Intentional scope exclusions

No file/project/workspace/tab/pane management; no language-server, syntax-tree, diagnostic or
code-navigation actions; no IDE task/debug/terminal management; no filesystem save/open commands;
no shell-command or external-program execution through modal commands. The prompt is not a file
editor, and no general Ex command language is provided. These are exclusions, not silently emulated
IDE actions. Pi's own external editor remains a host feature.

### Pi integration and precedence

Normal/select modal bindings and pending prefixes are consumed before overlapping extension/app
shortcuts. Unhandled keys fall through to Pi; insert-mode app shortcuts generally remain available.
History and completion handling have their own earlier routing. Escape first cancels completion or
pending input, then leaves the mode/collapses selections, and only then invokes Pi's interrupt.
There is a **25 ms Escape ambiguity window** for terminal sequences: delayed legacy Alt input may
be interpreted as Escape followed by another key. This is not an unconditional guarantee for every
terminal protocol or timing.

`Enter` submits outside pending modal input; `Shift+Enter`/`Ctrl+J` inserts a newline in insert
mode. Submission and programmatic editor replacement restore insert mode. Bracketed paste enters
insert mode. Completion opens automatically for slash commands and attachment triggers such as `@`
and `#`; use `Tab` to request path completion. Large pasted text is rendered in full rather than
collapsed into Pi's paste marker. The editor wraps by words, then graphemes, and shows a mode label
when space permits. Installation does not rewrite user configuration or keybindings.

### Clipboard requirements

Private registers require no desktop integration. System clipboard actions require `pbcopy` and
`pbpaste` on macOS, `wl-copy`/`wl-paste` plus a Wayland display on Linux, `xclip` plus an X11
display, or `powershell.exe` with `Get-Clipboard`/`Set-Clipboard` on Windows. Primary selection is
Linux-only. Missing tools/displays and subprocess failures are errors, not successful destructive
cuts. Clipboard contents are passed on stdin, not interpolated into shell commands. Desktop
clipboard interoperability still needs manual verification on the target machine.

## Installation and runtime

Use [the bundle installation instructions](../README.md), choosing one installation method to avoid
duplicate loading. Run `/reload` after updates. For a single-session load after workspace setup:

```sh
pi --no-extensions --extension ./index.ts
```

The package engine is Node.js **>=22.18.0**; the bundle/development baseline is **>=22.19.0** with
Pi **1.5.0** and its `@earendil-works` APIs. Pi loads the TypeScript entry directly; no build is
needed. Pi supplies the host peer packages. The runtime dependency **`rregex` is pinned exactly to
1.13.5**: its Node entry loads packaged WASM synchronously from disk, without a network fetch.
Runtime-only installs must include this dependency, not only copy HEM's TypeScript files.

The published allowlist includes `index.ts`, all `src/` modules, README, LICENSE and
`THIRD_PARTY_NOTICES.md`, plus the runtime-imported `reference/resolved-arguments.ts` metadata.
Tests, other reference fixtures, development configuration and lockfiles are excluded. See the
notices for regex engine attribution.

## Development and verification

Install shared tooling once with `npm run setup:dev` at the repository root. The five extensions
share one root lockfile and development dependencies; do not install separately in this package.

```sh
npm run check
node --test tests/packaging.test.mjs
```

Run these from this package after root setup. `check` runs dprint, TypeScript and offline tests.
The packaging regression uses `npm pack --ignore-scripts` to avoid recursive `prepack`, extracts
into an isolated temporary directory, copies locally available runtime dependencies and jiti, and
loads the actual package entry and regex WASM in a child Node process without installing from the
network. It checks the exact regex dependency, required sources/notices and development exclusions.
It requires npm, tar and the local development dependency baseline. It is not a clean registry
installation or a live Pi UI smoke test.

The normal `prepack` hook runs all checks. Before publication, verify package metadata, name
availability and registry contents with `npm pack --dry-run`, then publish only after review.
Automated tests do not establish full keymap parity. Real-terminal behavior (including resizing and
staged Escape timing), native clipboard interoperability, and the declared minimum Node version
have not yet been manually verified.

## Affected implementation summary

`src/model.ts` owns selections and edits; `src/commands.ts` dispatches modal commands;
`src/registers.ts` owns private registers; `src/regex.ts` loads the regex runtime; `src/input.ts`
decodes terminal input; `src/clipboard.ts` handles clipboard subprocesses; `src/index.ts`
integrates the editor with Pi. `index.ts` preserves the default Pi extension and `HelixEditor`
exports and explicitly exposes the reusable core:

- `HelixBuffer`, `graphemes`; types `Selection`, `RangeEdit`, `Mode`.
- `CommandController`; types `CommandOptions`, `CommandView`.
- `InputDecoder`; type `InputEvent`.
- `RegisterBank`; types `RegisterValue`, `RegisterOperation`.

These modules are included by the package's `src/` allowlist. Regex is deliberately not re-exported
at the root: Pi integration loads it dynamically inside a fallback catch so a regex initialization
failure does not prevent the editor from loading. `tests/public-api.test.mjs` exercises the actual
root exports; packaging tests also load the packed entry.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
