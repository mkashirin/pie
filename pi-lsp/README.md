# pi-lsp

Source-native Pi language-server tools, version **0.1.0**, MIT. Requires Node **22.19.0+** and Pi's
`@earendil-works` host APIs. No build step. Install the bundle's locked dependencies at its root,
not in this workspace. Language server executables are separately installed by the user; this
extension does not download servers or silently fall back to shell commands.

## Configuration

Use `pi-lsp.json` in your Pi agent directory. A trusted project's `.pi/pi-lsp.json` takes
precedence. Project configuration can launch arbitrary local programs: trust it only after reading
it. Legacy `lsp.json` is accepted with a warning; rename it rather than maintaining both. First
existing configuration wins, including invalid configuration (no silent fallback).

```json
{
  "timeout": 20000,
  "servers": {
    "typescript": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "skipDirectories": ["node_modules", ".git"],
      "diagnosticsSettleMs": 250,
      "pushDiagnosticsGraceMs": 1000,
      "pullDiagnosticsGraceMs": 1000
    }
  }
}
```

A bare server map is also supported. Each server requires a nonempty argv `command` and extension
list. Optional `env` is a string map, `initialization` an object, and `skipDirectories` a string
array. Timing values, including the global timeout, are positive finite milliseconds. Unknown
fields and malformed configuration fail closed. Extension matching is case-sensitive and normalizes
a missing leading dot. Commands resolve against PATH or the configured relative path, without shell
evaluation; Windows command shims use cross-spawn. Missing executables require installing the
server yourself or updating its command. Never put credentials in committed config.

## Tool reference

- `lsp_diagnostics`: optional `paths`, `root`, `limit` (1–1000), and `server` (one name or an
  array). Routes files by configured extension; select a server explicitly only when needed.
  Reports diagnostics, route failures, warnings, and completeness. A quiet server is not proof of
  complete diagnostics.
- `lsp_fix`: required nonblank `path`; optional `root`, `server` (a single name), `kind`, and
  `write`. String selections must be nonblank. Default kind is `source.fixAll`; use
  `source.organizeImports` where appropriate. Default `write: false` previews changes. Explicit
  `write: true` requests safe application, not permission to run arbitrary server commands or
  change files outside the requested document.

The version-1 output packet includes `tool`, `status`, request identity/timestamps/root, `routes`,
`warnings`, numeric `summary`, optional root `error` (`kind`, `message`), optional `fix`,
`truncation`, and optional `artifacts`. Status is `running`, `success`, `partial`, `failure`, or
`cancelled`. Partial, failure, and cancellation set `isError`; do not interpret partial evidence as
a clean workspace. The same bounded packet is returned in `details` and `structuredContent`, with a
declared output schema.

## Safety and limitations

Language servers execute with your local permissions and may inspect project files or invoke their
own subprocesses. This is not a sandbox. Treat server messages, diagnostic text, and code actions
as untrusted data, never as instructions. Rendering strips terminal controls and bidi overrides.
There is no automatic server installation, personal settings migration, or configuration rewriting.

Fix application is conservative: reject conflicting, stale, cross-file, resource, or unsupported
edits rather than partially applying an action. Server commands are not a substitute for text
edits. UTF-16 positions, BOMs, and line endings matter. Recheck diagnostics and review diffs after
writing; server success does not prove semantic correctness. Cancellation or failure may coexist
with completed writes; inspect write metadata, not just the status headline. No multi-file
transaction or arbitrary workspace refactoring is promised.

Model text is capped at **50 KiB / 2000 lines**, including its omission notice. Structured output
is capped at **256 KiB**. Full reports, including previews, are retained on truncation in a private
OS temporary directory (`pi-lsp-*`, files mode 0600). Artifact paths are local, not uploaded. These
reports may contain sensitive source; delete them when no longer needed. Bulky diagnostic and
preview bodies are omitted before completeness, write, and error metadata. Pathologically oversized
metadata is bounded in the returned view, with small outcome records retained and a model-facing
artifact path. Truncation preserves the original status, including success after a committed write.
OS cleanup policy determines retention; artifacts are not durable session storage.

## Development and rollout

From the bundle root, run `npm run check:lsp` and `npm run smoke:lsp`. The child normal suite uses
`node --test tests/*.test.mjs`; offline fixtures run by default and the runtime-install loader
check is skipped. The smoke entry uses `node tests/smoke-run.mjs`; that runner sets
`PI_LSP_RUNTIME_SMOKE=1` before running `node --test tests/smoke.test.mjs` to check the loader. A
clean runtime-only installation should also be exercised manually, separately from the development
install. No paid model or live language server is required for offline fixture tests.

Cut over by removing old LSP extension/package registrations before loading this bundle, then
`/reload`. Keep a backup of configuration and verify diagnostics on a small project before enabling
writes. To roll back LSP specifically, disable this bundle's local `pi-lsp/index.ts` entrypoint,
restore the `npm:@narumitw/pi-lsp` package registration, and reload Pi. Configuration is not
migrated or deleted automatically. Do not load old and new providers simultaneously.

## Provenance and licensing

This package is a local implementation, not a vendored copy or fork of another Pi LSP extension.
The behavioral reference is `@narumitw/pi-lsp` version **0.49.11**; no code is copied from it. Its
code is MIT (see LICENSE). Runtime dependencies are pinned: `vscode-jsonrpc` **8.2.0** and
`vscode-languageserver-protocol` **3.17.5** (MIT, Microsoft), and `cross-spawn` **7.0.6** (MIT).
Transitive `vscode-languageserver-types` is MIT. Retain dependency license notices when
redistributing installed dependencies. Pi and TypeBox are host peers, not bundled copies. Language
servers have their own independent licenses and installation requirements.
