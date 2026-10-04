# pi-hem (Helix Editor Mode for Pi)

This user extension replaces **Pi's main prompt editor only**. Built-in pickers, dialogs,
transcript navigation, and the external editor keep their normal behavior. It starts in **insert**
mode so you can type immediately; press `Escape` for normal mode. The editor works in interactive
Pi, not print/JSON/RPC modes.

## Normal-mode keys

- `h j k l`: left, down, up, right (`l` can move past the final character).
- `w b e`: next word, previous word, word end.
- `0 $`: start/end of logical line.
- `v`: toggle selection extension.
- `x`: select whole logical lines (including newlines); repeat to extend to the next line.
- `i a`: insert before/after selected character.
- `Shift+I` / `Shift+A`: insert at beginning / append at end of logical line.
- `d c y p u`: delete, change, yank, paste after selection, undo.
- `Escape`: leave insert/selection mode; in normal mode, use Pi's interrupt.
- `Enter`: submit; `Shift+Enter`/`Ctrl+J` inserts a newline in insert mode.

Pi's Working status remains at the left of the editor's top border; short line segments frame both
sides of the mode label on the right (hidden in very narrow terminals to leave room for status).
Prompt text wraps between words when possible, and splits a word by grapheme only if it cannot fit
on one visual line. Selections are single, grapheme-based and include the character under the
cursor. `y`/`p` use a private register, not the system clipboard. Normal mode does not implement
every Helix command (in particular no multiple cursors, counts, text objects, command mode, or
registers). Paste into a normal-mode prompt enters insert mode. Programmatic editor replacement or
submission restores insert mode. Pi's Ctrl+G external editor and other app shortcuts remain
available.

The editor reimplements prompt history and autocomplete using Pi's public provider interface.
Completion opens automatically only for slash commands or attachment triggers such as `@` and `#`;
it stays visible while suggestions refresh and a space dismisses it. Press `Tab` to request path
completion explicitly. Submitting with `Enter` clears the prompt and restores insert mode. Unlike
Pi's default editor, large pasted text is rendered in full rather than collapsed into a marker. If
you rely heavily on the default editor's advanced editing or paste-marker behavior, disable this
extension.

In normal mode, `l` (or Right Arrow) can reach the empty position after the final character. Press
`i` there to type at the end—no `a` required. Select-mode motions can reach that position too,
without selecting an extra character.

## Line selection with `x`

In normal or select mode, `x` expands the current selection to whole logical lines, including their
terminating newlines. If those lines are already fully selected, it includes the next line.
Soft-wrapped visual rows do not affect the selection. Existing backward selections are normalized
to a forward selection; extension is always downward. This enters **select** mode, so motions can
continue extending the selection. Use `d` to delete, `c` to replace, `y` to yank, or `Escape` to
collapse it. A final line without a newline is selected through its last grapheme; repeated presses
at EOF stop extending. In insert mode, `x` types normally.

## Installation

Requires Pi with the `@earendil-works` package APIs (tested with Pi 1.0.0). Development and tests
require Node.js 22.19.0 or newer and the repository's root workspace setup. No build step is
needed: Pi loads the TypeScript entry point directly.

Install the workspace bundle using [the repository instructions](../README.md). For a one-session
editor-only load from this directory after root installation:

```sh
pi --no-extensions --extension ./index.ts
```

Once published to npm:

```sh
pi install npm:pi-hem
```

Pi also auto-loads a checkout at `~/.pi/agent/extensions/pi-hem/`. Choose one installation method
to avoid loading the extension twice. Run `/reload` after changes. To disable a package install,
run `pi remove <same-source-used-for-install>`; for an auto-loaded checkout, move it outside
`extensions` and run `/reload`. The current draft should be transferred back to Pi's default
editor.

## Project layout

```text
pi-hem/
├── index.ts             # Thin Pi discovery entry point
├── src/
│   ├── index.ts         # Extension lifecycle and HelixEditor implementation
│   └── model.ts         # Grapheme-based editor buffer
├── tests/
│   ├── editor.test.mjs  # Editor integration regressions
│   └── model.test.mjs   # Buffer regressions
├── package.json
├── tsconfig.json
├── dprint.json
├── README.md
└── LICENSE
```

The root entry point forwards the default extension factory and named exports to `src/index.ts`. It
contains no implementation logic. Pi still discovers exactly one root entry point; no build step or
duplicate package registration is needed. Tests and development tooling are not included in the
published package; its file list includes the root entry point, `src/` and public docs.

## Development

Install shared tooling once with `npm run setup:dev` from the repository root. All four extensions
are npm workspaces using one root `package-lock.json`; child manifests retain runtime dependencies
and host peers, but no child development dependencies or lockfiles.

From the repository root:

```sh
npm run format
npm run check
```

After root setup, this directory also supports `npm run check` and `npm pack --dry-run`.

`npm run format` runs **dprint** with 4-space indentation, spaces (not tabs), and double quotes for
TypeScript/JavaScript, and parentheses around arrow-function parameters. `npm run format:check`
checks formatting without changing files. Plugin versions are pinned in `dprint.json`. `npm run
check` checks formatting and TypeScript, then runs the buffer and editor integration tests using
the centralized root development dependencies. Checks require the workspace checkout and root
setup, not a managed Pi installation. There is no CI workflow.

- `index.ts`: thin Pi discovery shim, forwarding the existing public exports.
- `src/model.ts`: grapheme-based buffer, motions, selections, register, and undo.
- `src/index.ts`: Pi extension lifecycle, keyboard/mouse handling, wrapping, rendering, history,
  and completion.
- `tests/model.test.mjs` / `tests/editor.test.mjs`: buffer and editor regression tests.

## Publishing

The repository uses `main`. Before publishing, choose an available npm name (the current name is
`pi-hem`), create an empty remote repository, and add its real URL to the `repository` field in
`package.json`. Commit that metadata, then push:

```sh
git remote add origin <your-repository-url>
git push -u origin main
```

To release on npm, authenticate with `npm login`, verify the package contents with `npm pack
--dry-run`, then run `npm publish --access public`. The `prepack` hook runs all local checks before
packing/publishing. The package includes only its TypeScript sources and public documentation; Pi
provides the peer dependencies at runtime. Tag the release after publication, for example `git tag
v0.1.0 && git push origin v0.1.0`.

## License

MIT. See [LICENSE](LICENSE).
