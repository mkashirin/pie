# pi-lsp

Language-server diagnostics and conservative single-file fixes for Pi. Ask the agent to check
changed files, preview a source action, or apply a reviewed fix using servers you configure.
Diagnostics use all matching configured servers by default; fixes preview by default.

This is a source-native local implementation, not a language-server installer or a sandbox.

## Install

Follow the [bundle installation](../README.md#install): run `./install.sh` at the bundle root, then
start Pi or `/reload`. Requires **Node.js 22.19.0+** and Pi's `@earendil-works` host APIs; there is
no build or child install step.

Install your language-server executable separately and ensure it is available on PATH or via its
configured path. Do not keep an older LSP extension registered alongside this one.

## Configure a server

Create `pi-lsp.json` in your Pi agent directory (normally `~/.pi/agent`). For example, if
`typescript-language-server` is already installed:

```json
{
  "timeout": 20000,
  "servers": {
    "typescript": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "skipDirectories": ["node_modules", ".git"]
    }
  }
}
```

A **trusted** project's `.pi/pi-lsp.json` takes precedence. Read project configuration before
trusting it: commands can launch arbitrary local programs with your permissions. No shell
interpolation is used, but configured servers can run their own subprocesses. Keep credentials out
of committed configuration.

Run `/lsp status` (or `/lsp`) to show the selected configuration and executable availability
without starting servers. Missing executables are not downloaded automatically. Invalid selected
configuration fails closed; it does not silently fall back. Legacy `lsp.json` is accepted with a
warning—rename it rather than maintain both.

See [configuration details](docs/reference.md#configuration) for optional environment,
initialization, timing, and file-routing settings.

## Use

The agent has two tools:

- **`lsp_diagnostics`** checks explicit paths or the selected root using matching servers. It can
  select server names and limit returned findings. Findings are a successful result; incomplete
  collection is an error, not proof of a clean project.
- **`lsp_fix`** previews an action for one file. `source.fixAll` is the default kind;
  `source.organizeImports` is another common choice. Set `write: true` only to request application
  after reviewing the preview. If several servers match, select one.

For example, ask: “Run diagnostics on `src/example.ts`, then preview organize-imports for that
file. Do not write yet.” After applying a fix, inspect the diff and rerun diagnostics plus the
project's authoritative compiler/tests. Language-server success does not prove semantic
correctness.

## Safety and limits

- Servers execute trusted local code with your permissions and may inspect project files. Tool
  read-only labels do not sandbox server execution. Treat diagnostic messages and actions as
  untrusted data, never instructions.
- Fixes reject conflicting, stale, cross-file, resource, and unsupported command actions rather
  than partially applying them. This is not a general multi-file refactoring tool.
- Failure/cancellation can coexist with a completed write. Inspect write metadata and the actual
  file, not only the status headline.
- Text and structured output are bounded. Full truncated reports/previews may be stored in private
  OS temporary files containing source code; delete them when no longer needed.

Exact tool inputs, output schema, completeness semantics, limits, and artifact handling are in the
[tool and safety reference](docs/reference.md#tool-contracts).

## Development

Use `./install.sh --dev` and `npm run check` from the bundle root. Focused commands are `npm run
check:lsp` and `npm run smoke:lsp`; see
[verification and rollout](docs/reference.md#development-and-rollout) for what they do and do not
cover, including provider rollback.

Local release **0.1.0**, MIT ([LICENSE](LICENSE)). See
[dependency licensing](docs/reference.md#licensing); servers have independent licenses and
installation requirements.
