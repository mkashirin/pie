# pi-hem — Helix Editor Mode for Pi

HEM adds insert-first modal editing to **Pi's main interactive prompt**. It supports multiple
selections, counts, textual objects, registers, Rust-regex search, and bounded macros. Pickers,
dialogs, transcript navigation, and Pi's external editor are unchanged.

This is a substantial Zed-compatible prompt editor, not certified byte-for-byte Helix or Zed
parity. The [binding inventory](reference/runtime-coverage.json) records reachable, pending, and
excluded commands; it is more precise than a fixed feature count.

## Install and start

Use the [bundle installation](../README.md#install), from its root:

```sh
./install.sh
```

Start Pi or run `/reload`. Do not add a duplicate package registration or install dependencies
inside this package. The bundle baseline is **Node.js 22.19.0+**, with Pi's `@earendil-works` host
APIs; sources load without a build step.

HEM starts in **insert mode**. Press `Escape` for normal mode. `/hem` displays help. For an
isolated single-session load after root workspace setup, run from this package directory:

```sh
pi --no-extensions --extension ./index.ts
```

## Everyday editing

| Key / command           | Use                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `Escape`                | Cancel completion/pending input, then leave the mode or collapse selections, before Pi interrupt. |
| `h j k l`               | Move in normal mode.                                                                              |
| `v`                     | Toggle selection extension.                                                                       |
| `i`, `I`, `A`           | Insert; insert at first non-whitespace; append at line end.                                       |
| `x`                     | Expand to whole logical lines, including newlines; repeat downward.                               |
| `d c y p P`             | Delete, change, yank, and paste selections.                                                       |
| `/`, `n`, `N`           | Rust-regex search and next/previous match.                                                        |
| `Enter`                 | Submit outside pending modal input.                                                               |
| `Shift+Enter`, `Ctrl+J` | Insert a newline in insert mode.                                                                  |
| `Tab`                   | Request path completion.                                                                          |

The editor also offers select/replace modes, undo/redo with grouped insert edits, text objects and
surround operations, regex selection/splitting, occurrence selections, marks, and jump/change
lists. These are textual operations, not syntax-tree navigation. See the
[editing and integration reference](docs/reference.md#editing-contract) for exact caveats and links
to the authoritative binding sources.

Completion opens automatically for slash commands and attachment triggers such as `@` and `#`.
Large pasted text is shown in full rather than collapsed into a paste marker. Submission and
programmatic replacement restore insert mode; bracketed paste enters insert mode.

## Registers and clipboard

Registers are private by default: ordinary yank/delete/paste does not require desktop clipboard
integration. Explicit `+` and `*` registers address the system clipboard and primary selection.
Primary selection is Linux-only.

System clipboard operations need `pbcopy`/`pbpaste` on macOS, Wayland `wl-copy`/`wl-paste`, X11
`xclip`, or Windows `powershell.exe`. Linux also needs the matching display. Missing tools,
displays, and subprocess failures are errors, not successful destructive cuts. See
[clipboard requirements](docs/reference.md#clipboard) for platform and replay behavior.

## Reference and development

Read the [reference](docs/reference.md) for registers, integration precedence, runtime/package
closure, public exports, provenance, and focused automated/manual checks. Development setup is
centralized: `./install.sh --dev` and `npm run check` from the bundle root; do not install child
tooling separately. [Development guide](../docs/development.md).

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), including the
Apache-2.0 regex runtime attribution. Local release **0.1.0**.
