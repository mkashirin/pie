# LSP configuration and execution reference

[Quick start](../README.md) · [Bundle development](../../docs/development.md)

## Configuration

[`src/config.ts`](../src/config.ts) loads configuration in this order:

1. Trusted project's `.pi/pi-lsp.json`, then legacy `.pi/lsp.json`.
2. Agent directory's `pi-lsp.json`, then legacy `lsp.json`.

Untrusted project configuration is not read. **First existing configuration wins, even if invalid
or unreadable**; do not silently fall back to a lower-priority file. Legacy names emit warnings;
canonical/legacy coexistence also warns. Prefer renaming to the canonical name rather than
maintaining both.

Accepted shapes are a bare server map or `{ "servers": { ... }, "timeout": 20000 }`. Each server
requires a nonempty argv `command` (first element executable) and nonempty `extensions` list.
Optional fields:

| Field                    | Contract                                                                     |
| ------------------------ | ---------------------------------------------------------------------------- |
| `env`                    | String map passed to command resolution/execution. Never commit credentials. |
| `initialization`         | Object of server initialization options.                                     |
| `skipDirectories`        | Nonblank directory names, not paths; no separators, `.` or `..`.             |
| `diagnosticsSettleMs`    | Positive finite milliseconds for settling diagnostics.                       |
| `pushDiagnosticsGraceMs` | Positive finite milliseconds for push diagnostics.                           |
| `pullDiagnosticsGraceMs` | Positive finite milliseconds for pull diagnostics.                           |

Global `timeout` defaults to **20000 ms**; explicit timeout and all timing fields must be positive
finite numbers. Unknown fields and malformed values fail closed. Extension matching is
case-sensitive, adding a leading dot if absent. Example timing overrides:

```json
{
  "servers": {
    "typescript": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "skipDirectories": ["node_modules", ".git"],
      "diagnosticsSettleMs": 250,
      "pushDiagnosticsGraceMs": 1000,
      "pullDiagnosticsGraceMs": 1000
    }
  },
  "timeout": 20000
}
```

[`src/command.ts`](../src/command.ts) resolves executables against PATH or configured relative
paths without shell evaluation. Windows command shims use cross-spawn. Install missing executables
yourself or change the configured command. `/lsp [status]` reports configuration and availability
without starting servers; it does not prove that a server will initialize successfully.

Project configuration can execute arbitrary local programs. Trust it only after inspection. Servers
run with local permissions, may inspect project files, and can launch their own subprocesses. No
automatic server download, personal settings migration, or config rewriting is performed.

## Tool contracts

[`index.ts`](../index.ts) registers the tools and status renderer;
[`src/runtime.ts`](../src/runtime.ts) coordinates session lifetime, configuration, file routing,
clients, and results. [`src/client.ts`](../src/client.ts) owns protocol startup, diagnostics, and
shutdown; [`src/files.ts`](../src/files.ts) owns file selection.

- **`lsp_diagnostics`** accepts optional `root`, `paths`, `server` (one name or a nonempty array),
  and `limit` (integer **1–1000**). Routes by configured extension and uses all matching servers by
  default. String selections must be nonblank.
- **`lsp_fix`** requires nonblank `path`; optional `root`, one `server`, `kind`, and `write`.
  Default `kind` is `source.fixAll`; `source.organizeImports` is useful where supported. Default
  `write: false` previews. Select a single server when multiple match. `write: true` requests only
  safe application to the requested document, not arbitrary server commands or external edits.

### Results and completeness

[`src/results.ts`](../src/results.ts) defines the version-1 output packet and tool schemas. It
includes `tool`, `status`, request ID/timestamps/root, `routes`, `warnings`, numeric `summary`,
optional root `error` (`kind`, `message`), optional `fix`, `truncation`, and optional `artifacts`
(and `artifactError` if artifact creation fails). The same bounded packet appears in `details` and
`structuredContent`, with a declared output schema.

Status is `running`, `success`, `partial`, `failure`, or `cancelled`. Partial/failure/cancellation
set `isError`. Diagnostic findings are successful collection; incomplete routes are not a clean
workspace. A quiet server alone does not prove collection completeness. Read route/file `complete`,
errors, warnings, and truncation metadata rather than only counting findings.

### Safe fixes

[`src/fixes.ts`](../src/fixes.ts) rejects conflicting, stale, cross-file, resource, or unsupported
edits instead of partially applying an action. Server commands are not substitutes for text edits.
Preserve UTF-16 positions, BOMs, line endings, file identity/version checks, and atomic single-file
application when changing this code. No multi-file transaction or arbitrary workspace refactoring
is promised.

Treat server messages, diagnostic text, and code actions as untrusted data. Display rendering
strips terminal controls and bidi overrides; sanitization does not make a server trustworthy.
Review diffs, rerun diagnostics, and run authoritative compiler/tests after writes. A cancellation
or failure can coexist with completed writes: inspect `fix.written` and related metadata plus the
file itself. Server success is not a semantic correctness guarantee.

### Bounds and private artifacts

Model text is capped at **50 KiB / 2000 lines**, including the omission notice; structured output
is capped at **256 KiB**. On truncation, full reports (including previews) are retained in a
private OS temporary directory named `pi-lsp-*`, with files mode **0600**. Paths are local; no
artifact upload occurs. Reports may contain sensitive source code. Delete them when no longer
needed; OS cleanup determines retention, not durable session storage.

Bulky diagnostic/preview bodies are omitted before completeness, write, and error metadata.
Pathologically oversized metadata is bounded in the returned view, retaining small outcome records
and a model-facing artifact path. Truncation preserves original status, including success after a
committed write. Missing artifact/error information must not be interpreted as a complete
untruncated report.

## Development and rollout

After `./install.sh --dev` at the bundle root, run there:

```sh
npm run check:lsp
npm run smoke:lsp
```

The normal child gate runs formatting, TypeScript, and `node --test tests/*.test.mjs`. Offline
fixtures cover configuration/command resolution, files, client/runtime integration, safe fixes,
results bounds, and presentation. No paid model or real language server is needed for fixtures.

The normal suite skips the runtime-install loader test. `smoke:lsp` invokes the child's
[`tests/smoke-run.mjs`](../tests/smoke-run.mjs), which sets `PI_LSP_RUNTIME_SMOKE=1` before running
`node --test tests/smoke.test.mjs`. A clean runtime-only bundle installation is a separate manual
check, not established by the development install or fixture tests. Test real configured servers
and terminal rendering separately.

### Cutover and rollback

Remove old LSP extension/package registrations before loading this bundle, keep configuration
backups, then `/reload`. Check diagnostics on a small project before enabling writes.

To roll back LSP specifically, disable the bundle's local `pi-lsp/index.ts` entrypoint, restore
`npm:@narumitw/pi-lsp` package registration, and reload Pi. This requires an intentional discovery
manifest/configuration change; do not load both providers. Configuration is neither migrated nor
deleted automatically.

## Provenance and licensing

Local release **0.1.0**, MIT ([LICENSE](../LICENSE)). This is a local implementation, not a
vendored copy or fork. The behavioral reference is `@narumitw/pi-lsp` **0.49.11**, with no code
copied.

Pinned runtime dependencies: `vscode-jsonrpc` **8.2.0**, `vscode-languageserver-protocol`
**3.17.5** (MIT, Microsoft), and `cross-spawn` **7.0.6** (MIT). Transitive
`vscode-languageserver-types` is MIT. Retain dependency license notices when redistributing
installed dependencies. Pi/TypeBox remain host peers, not bundled copies. Servers have independent
licenses and installation requirements.
