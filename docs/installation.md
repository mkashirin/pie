# Installation, updates, and skills

[Bundle overview](../README.md) · [Development](development.md)

## Choose one loading method

The bundle requires Node.js **22.19.0+**, npm, and Pi with the `@earendil-works` APIs. Git is
needed for checkout-based installation. Development uses Pi **1.5.0**. Sources load directly; no
compiled output, manual workspace symlinks, or paths to a second Pi installation are needed.

### Extension-directory checkout

The recommended layout leaves space for unrelated extensions:

```sh
mkdir -p ~/.pi/agent/extensions
git clone <your-repository-url> ~/.pi/agent/extensions/pi-extensions
cd ~/.pi/agent/extensions/pi-extensions
./install.sh
```

For a custom `PI_CODING_AGENT_DIR`, use its `extensions/` directory instead. The root manifest
lists all six extension entrypoints, so Pi discovers this nested checkout as one bundle. After
installation, start Pi from your intended project directory (not necessarily this checkout);
auto-discovery loads the bundle, and existing project sessions can use `/reload`.

Cloning directly into an **empty** `~/.pi/agent/extensions` also works, but a root manifest there
takes precedence over scanning sibling extension directories. Prefer a nested checkout if you want
to retain unrelated extensions.

Do **not** additionally add an auto-discovered checkout to `packages` in Pi settings. Remove old
copies or duplicate registrations of the six extensions before loading the bundle. In particular,
do not load an older LSP or npm Plan Mode provider alongside the local one.

### Pi-managed Git package

Once the repository is available remotely:

```sh
pi install git:github.com/<owner>/<repository>
```

Use this **instead of** an auto-discovered clone. Pi manages the checkout and installs root runtime
dependencies. For a published release tag, append `@v0.1.0` (the tag must actually exist). The root
`pi.skills` manifest also registers the bundled skills for this loading method.

### Windows without a POSIX shell

From the checkout root, use this instead of `install.sh`:

```sh
npm ci --omit=dev --legacy-peer-deps --global=false
```

## What the installer does

[`install.sh`](../install.sh) validates Node/npm prerequisites and every declared workspace,
extension entrypoint, and skill root. Paths must exist inside the checkout, including after symlink
resolution. It then runs one root installation:

- Default: `npm ci --omit=dev`, with explicit checkout prefix, non-global mode, and
  `--legacy-peer-deps`.
- `--dev`: the same local installation with `--include=dev` instead.
- `--help`: usage only. Other options, including the removed `--check`, are rejected.

The explicit prefix and non-global flags keep installation in this checkout even when invoked from
another directory or with inherited npm prefix/global settings. npm may still use its normal
external cache and logs. Installation requires access to the locked dependencies unless cached.

The script does **not** run checks, create test checkouts, install Pi or language servers, copy
extensions/skills elsewhere, register packages, migrate authentication, or modify user settings.
Running it again reinstalls the locked dependency set; it is not a merge with local `node_modules`
edits.

All seven workspaces share one root `package-lock.json`. npm creates workspace links; do not run
child installs or create child lockfiles. Host Pi packages are peers supplied by Pi at runtime;
[`.npmrc`](../.npmrc) prevents installing duplicate host peers during normal setup.

Runtime dependencies include web parsing/address libraries, account locking, HEM's offline `rregex`
WASM runtime, and LSP's JSON-RPC/protocol/process-launch libraries. Shared TUI interactions use
only Pi host APIs, not another Pi extension. Exact versions live in the
[root lockfile](../package-lock.json) and package manifests rather than a second dependency
inventory here. Copying only TypeScript sources is not a runtime installation. The source-only
[`@pi-extensions/pi-kit`](pi-kit.md) workspace is private support code, not another Pi extension or
a separately installed package.

## Updates and rollback

For a manually cloned checkout, update from its root:

```sh
git pull
./install.sh
```

Preserve or reconcile local changes before pulling. Then `/reload` or restart Pi. Pi-managed
packages use `pi update --extensions` instead. Development dependency changes require another root
`./install.sh --dev`; do not repair workspaces with independent child installs.

Keep configuration backups before changing providers. LSP-specific cutover/rollback guidance is in
[the LSP reference](../pi-lsp/docs/reference.md#cutover-and-rollback). No personal settings or
credentials are automatically copied, migrated, or deleted by bundle installation.

## Authentication and first checks

OpenAI features require your own account access. Use `/login openai` and an eligible physical
`openai` model using the `openai-responses` API, or explicitly select a managed `openai-multi`
account/model. Subagents inherit an eligible active model, otherwise currently falling back to
`openai/gpt-6.1-sol`. Prefer an installed model explicitly:

```text
/subagents model default openai/<installed-model-id> --save
/subagents list
/openai-web status
/lsp status
```

`web_action` public-page reading is credential-free but still requires network access. LSP
executables must be installed separately and configured before diagnostics can run.

[Multi-account selection](../pi-openai-multi/README.md) is opt-in. Adding accounts does not select
one, change native credentials, or rewrite consumer settings. Unconfigured subagent assignments and
web search inherit an eligible active model, including `openai-multi`. Explicit model settings take
precedence; set them per consumer for routing independent of foreground selection. Never commit
credentials to this repository.

## Using skills

Bundled skills remain under [`skills/`](../skills): `onboard`, `researcher`, `ru-check`,
`ru-score`, and `ru-text`. Dependency installation does not copy or register them.

- **Pi-managed package:** the root `pi.skills` manifest includes `./skills`.
- **Auto-discovered extension-directory clone:** only extensions are discovered. Add this
  checkout's absolute `skills` directory to the agent-directory `settings.json` `skills` array,
  preserving existing entries. Registering the directory once covers all bundled skills.
- **One session:** run `pi --skill /absolute/path/to/this-checkout/skills` from any project, or `pi
  --skill ./skills` from this checkout.
- **Copy a single skill instead:** copy its complete directory, including references, into
  `~/.pi/agent/skills/`; avoid maintaining duplicate registrations of the same skill.

Run `/reload` after persistent registration or edits. Skills do not configure their external
services, model assignments, or authentication automatically.

### Repository onboarding

[`onboard`](../skills/onboard/SKILL.md) inventories a repository, inspects architecture, style,
workflow, and guidelines, then compacts durable knowledge into `AGENTS.md`. Examples:

```text
/skill:onboard
/skill:onboard check
/skill:onboard refresh no subagents
/skill:onboard inspect packages/api and create packages/api/AGENTS.md
```

Arguments are natural language, not a rigid parser. `check`/`dry-run` proposes without writing;
`refresh` conservatively updates existing guidance. Scope defaults to the Git root, or current
directory outside Git, and can be narrowed to a subtree. Installation does not itself generate
agent guidance.

The skill preserves human guidance and overrides/nested instructions. By default it does not
refactor code, install dependencies, run project checks, or change settings. Optional scouts are
read-only: the foreground inventories paths and supplies explicit files because scouts cannot run
shell commands. One bounded batch normally covers architecture, style, workflow, and guidelines. No
orchestration mode is required. Without callable/authenticated subagents it continues locally where
permitted and reports gaps. Inspect assignments with `/subagents models`; configure models yourself
if needed.

The foreground verifies claims before writing. In read-only orchestrator mode, use a scoped worker
followed by linked reviewer inspection, or return a draft. Reload Pi to load newly written agent
guidance. See also [maintenance verification](development.md#documentation-and-agent-maintenance).

### Academic research and editing

[`researcher`](../skills/researcher/SKILL.md) supports paper discussion, comparison, claim/citation
checking, and conservative English/Russian editing or translation. Examples:

```text
/skill:researcher Explain the assumptions and limitations of arXiv:2307.12307
/skill:researcher Compare these two papers, using subagents to check the main claims
/skill:researcher Polish this English abstract; language only, no subagents
/skill:researcher Проверь, подтверждают ли эти источники утверждения в введении
/skill:researcher Отредактируй этот раздел на русском, сохрани формулы и ссылки
/skill:researcher Переведи этот абзац на английский; только предоставленные источники
```

The skill discovers connected AlphaXiv MCP tools (`mcp__alphaxiv`) through `codemode` and their
current schemas. Inspect `/mcp` if unavailable. Generated intermediate reports are not original
paper text; targeted PDF pages establish only partial coverage. Use appropriate sources outside
arXiv coverage and disclose unavailable retrieval.

Optional `researcher` and `research-validator` delegation is read-only. Validation follows settled
research with actual run/evidence IDs; bundled profiles require each child's own successful
`openai_search`, which AlphaXiv-only retrieval cannot replace. If search/delegation is prohibited
or unavailable, work locally where permitted and label verification honestly. Language-only editing
usually needs neither retrieval nor delegation and is not fact-checking.

Preserve scientific meaning, uncertainty, numbers, citation keys, and LaTeX. Keep factual
corrections and author queries separate from stylistic changes. Editing does not authorize
uploading unpublished manuscripts, changing private library state, or writing files: applying or
saving edits requires a request.
