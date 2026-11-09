# Pi local extensions

A source-based Pi extension bundle, release **0.1.0**. All six extension packages use the same
local release version; upstream provenance and dependency versions remain independent.

- **pi-hem**: insert-first modal prompt editor with multiple selections, counts, textual objects,
  registers, Rust-regex search and bounded macros. A substantial Zed-compatible text editor, not
  certified byte-for-byte parity; exact binding and pending status live in the generated coverage
  inventory. See its [coverage and limitations](pi-hem/README.md), including the 25 ms Escape
  ambiguity window.
- **pi-openai-subagents**: specialist delegation and orchestration, with bundled agent definitions.
- **pi-openai-multi**: opt-in multi-account OpenAI routing; consumers configure their own accounts.
- **pi-openai-web**: native OpenAI web search and safe public-page reading.
- **pi-plan**: local Plan Mode fork with word-wrapped menus and questionnaires.
- **pi-lsp**: source-native language-server diagnostics and conservative fix previews/application.
  See its [configuration and safety reference](pi-lsp/README.md); install server executables
  separately.
- **onboard skill**: evidence-backed architecture, style, workflow, and guideline distillation into
  `AGENTS.md`, with optional parallel read-only scouts.
- **researcher skill**: academic discussion, source/citation checking, and English/Russian paper
  editing, with connected AlphaXiv MCP retrieval and optional research/validation specialists.

Requires **Node.js 22.19.0 or newer**, npm, Git, and Pi with the `@earendil-works` APIs
(development checks use Pi **1.5.0**). There is no build step.

## Fresh installation

With Pi already installed, clone this repo into a subdirectory of its extension directory:

```sh
mkdir -p ~/.pi/agent/extensions
git clone <your-repository-url> ~/.pi/agent/extensions/pi-local-extensions
cd ~/.pi/agent/extensions/pi-local-extensions
./install.sh
```

Replace `<your-repository-url>` with your clone URL. Then start Pi, or run `/reload` in an existing
session. For a custom `PI_CODING_AGENT_DIR`, use its `extensions/` directory instead.

`install.sh` checks the Node/npm prerequisites, validates that the declared workspaces, extensions,
and skill roots exist inside this checkout, and runs one root `npm ci --omit=dev` to install the
locked runtime dependencies. npm is explicitly pinned to this checkout in non-global mode, even
when the script is invoked from another working directory. It can be rerun after updates. It does
not install Pi, copy extensions or skills elsewhere, change user settings, register packages, or
copy credentials. npm may still use its normal external cache and logs. On Windows without a POSIX
shell, run `npm ci --omit=dev --legacy-peer-deps --global=false` from this checkout instead.

All bundled skills stay under `skills/`: `onboard`, `researcher`, `ru-check`, `ru-score`, and
`ru-text`. Installing dependencies does not register them with Pi. Use `pi --skill ./skills` from
this checkout for one invocation, or follow the skill-registration instructions below.

The root `package.json` explicitly lists all six entry points, so Pi discovers this nested checkout
as one bundle. The root lockfile installs the shared runtime dependencies (`@narumitw/pi-tui-kit`,
`cheerio`, `ipaddr.js`, workspace dependency `proper-lockfile`, and HEM's exact `rregex@1.13.5`
dependency with its offline Node WASM runtime, plus LSP's exact `vscode-jsonrpc@8.2.0`,
`vscode-languageserver-protocol@3.17.5`, and `cross-spawn@7.0.6`). Pi supplies host peers at
runtime; the repo's `.npmrc` prevents npm from installing duplicate copies. No per-extension
install is needed for normal use, and no manually configured symlinks, compiled output, or paths to
another Pi installation are required. npm creates the workspace links itself.

You can also clone directly into an **empty** `~/.pi/agent/extensions` directory; the same root
manifest and `./install.sh` work there. A nested checkout is preferable because it leaves space for
unrelated extensions. A root manifest in the extension directory takes precedence over scanning
other sibling extension directories.

Do **not** also add this auto-discovered checkout to Pi's `packages` settings. Remove older copies
of these six extensions or duplicate package registrations before loading this bundle.

### Alternative: let Pi manage the Git checkout

Once pushed to GitHub:

```sh
pi install git:github.com/<owner>/<repository>
```

Pi clones the bundle and installs its root runtime dependencies. Use this **instead of** an
auto-discovered clone. For a pinned release, append `@v0.1.0` after creating and pushing that tag.
Managed updates use `pi update --extensions`; manually cloned checkouts use `git pull` followed by
`./install.sh` and `/reload`.

### First use

- HEM starts in insert mode; press Escape for Helix-style normal mode.
- Plan Mode is available through `/plan` and `/plan settings`.
- OpenAI features need your own Pi authentication and an available physical
  `openai/openai-responses` model. Use `/login openai`, then select an eligible model in Pi.
- Subagents are enabled with `/subagents on`. They inherit an eligible active OpenAI model by
  default; to choose one explicitly, use `/subagents model default openai/<installed-model-id>
  --save`.
- Check web configuration with `/openai-web status` and agent configuration with `/subagents list`.

Cloning does not copy credentials, model access, sessions, personal settings, or other Pi
extensions. Without an eligible active OpenAI model, subagents currently fall back to
`openai/gpt-6.1-sol`; configure an available model explicitly rather than relying on that fallback.
Public-page `web_action` needs network access but no OpenAI credentials.

### Multi-account OpenAI routing

The bundle includes [`pi-openai-multi`](pi-openai-multi/README.md), but installing it does not
configure accounts or opt existing OpenAI consumers into routing. Follow that package's README to
configure your own accounts and explicitly select an `openai-multi` model in each consumer that
should use it. Selecting a model for the foreground does not implicitly reconfigure subagents or
web tools; configure those consumers explicitly where supported. Existing consumers can keep using
their current OpenAI configuration unchanged.

Installation does not read or copy credentials, modify user settings, or migrate authentication. Do
not commit account credentials to this checkout. See the package README for supported account
configuration, routing behavior, and limitations.

See each extension's README for behavior, tool policies, configuration, and manual TUI checks.

## Repository onboarding skill

[`skills/onboard/SKILL.md`](skills/onboard/SKILL.md) teaches the model to inventory a project,
inspect architecture, code style, development commands, and guidelines, then compact the useful
knowledge into a concise `AGENTS.md`. It preserves existing human guidance, checks consequential
claims against sources, and discloses conflicts and coverage gaps. It does not refactor code,
install dependencies, execute project checks, or change model/settings assignments by default.

Pi-managed package installations load the skill through the root `pi.skills` manifest. An
**auto-discovered extension-directory clone only loads extensions**, not bundled skills. For that
installation, add this checkout's absolute `skills` directory to the `skills` array in your
agent-directory `settings.json` (preserving existing entries), or copy the `skills/onboard`
directory into `~/.pi/agent/skills/onboard`. For a one-session trial from any project directory:

```sh
pi --skill /absolute/path/to/this-checkout/skills/onboard
```

Use `/reload` after registering or editing the skill. In the target project, invoke:

```text
/skill:onboard
/skill:onboard check
/skill:onboard refresh no subagents
/skill:onboard inspect packages/api and create packages/api/AGENTS.md
```

Arguments are natural-language requests: `check`/`dry-run` proposes a document or diff without
writing, and `refresh` conservatively updates existing guidance. The skill defaults to the Git root
(or current directory outside Git), with explicit subtree scope supported. Running it on this
bundle is a separate operation; installing the skill does not generate an `AGENTS.md`.

For larger projects the model can use one bounded `subagents_run` batch, normally three or four
`scout` tasks covering architecture, style, workflow, and guidelines. Scouts cannot run shell
commands: the foreground inventories paths first and supplies explicit files and a compact
evidence-report contract. No orchestration mode is required. Without callable/authenticated
subagents, or when requested, the foreground follows the same workflow alone. Inspect available
assignments with `/subagents models`; configure an available model yourself if necessary.

The foreground verifies and compacts the findings before writing. In read-only orchestrator mode,
writing requires a scoped `worker` followed by linked `reviewer` inspection, or the model returns a
draft. Existing overrides/nested instructions remain untouched by default. Reload Pi after
generating guidance to load the updated context.

## Academic researcher skill

[`skills/researcher/SKILL.md`](skills/researcher/SKILL.md) supports paper discussion, literature
comparison, claim/citation checking, and conservative academic editing or translation in English
and Russian. It preserves scientific meaning, uncertainty, numbers, citation keys, and LaTeX
markup; factual corrections and author queries stay separate from stylistic changes.

The skill uses the connected **AlphaXiv MCP** (`mcp__alphaxiv`) through Pi's `codemode` discovery
and current tool schemas. It distinguishes generated intermediate reports from original extracted
text and targeted PDF pages, and uses appropriate external sources outside arXiv coverage. It does
not configure MCP, upload unpublished manuscripts, or modify private notes/library state by
default. Inspect the connection with `/mcp` if AlphaXiv is unavailable.

The root `pi.skills` manifest already includes this skill for Pi-managed package installs. For an
**auto-discovered extension-directory clone**, use the same registration described above: add this
checkout's absolute `skills` directory to the agent-directory `settings.json` `skills` array
(preserving existing entries). If already registered for onboarding, no additional entry is needed.
Alternatively, copy `skills/researcher` to `~/.pi/agent/skills/researcher`, or try:

```sh
pi --skill /absolute/path/to/this-checkout/skills/researcher
```

Run `/reload` after registration or edits, then invoke with natural-language requests:

```text
/skill:researcher Explain the assumptions and limitations of arXiv:2307.12307
/skill:researcher Compare these two papers, using subagents to check the main claims
/skill:researcher Polish this English abstract; language only, no subagents
/skill:researcher Проверь, подтверждают ли эти источники утверждения в введении
/skill:researcher Отредактируй этот раздел на русском, сохрани формулы и ссылки
/skill:researcher Переведи этот абзац на английский; только предоставленные источники
```

Delegation to `researcher` and `research-validator` is optional and read-only. The skill sequences
validation after settled research and supplies actual run/evidence IDs. The bundled research
profiles require each child's own successful `openai_search`; AlphaXiv-only retrieval cannot
satisfy that completion gate. When delegation/search is unavailable or prohibited, the skill
continues in the foreground where permitted and labels verification honestly. Short explanations
and language-only edits normally need no delegation; editing alone is not a fact-check. Files are
changed only when applying/saving edits is requested.

## UI symbol policy

Extension-authored UI chrome uses ASCII arrows, markers, spinners, separators, and ellipses.
Unicode box-drawing lines, corners, and junctions remain allowed. Model prompts, documentation,
code examples, and user-provided content are not transliterated. The Plan menu adapts vendor
interaction hints at the call site rather than editing the installed dependency.

Run the development audit after updating extension sources:

```sh
npm run audit:ui
npm run audit:ui -- --json
```

The audit checks source string/template literals, including decoded escapes, and exempts the non-UI
model prompt. Root regression tests also enforce this policy and verify ASCII menu selection when
the search input shares the same `>` prefix. Truncation budgets allow three cells for `...`.

## Development and verification

The normal install above is runtime-only. To install the centralized, pinned development tooling,
run `./install.sh --dev`, which runs one root `npm ci --include=dev` instead. Verification is a
separate, opt-in development step; the installer does not run tests or create temporary checkouts.
The former `--check` option was removed because its root clean-install smoke script is no longer
present. There is no GitHub Actions workflow or other hosted CI.

```sh
./install.sh --dev
node --test tests/install-scope.test.mjs
npm run check --workspaces
```

`setup:dev` runs `npm ci --include=dev --legacy-peer-deps` once at the repository root. It does not
modify Pi's managed installation or user settings. All six child packages are npm workspaces;
development dependencies and tooling are installed at the root, and the single root
`package-lock.json` belongs in Git. There are no child lockfiles. Run setup again after
dependency/lockfile updates. Individual extensions also support `npm run check` from their own
directories after root setup; they use the shared root tooling, including for sibling web-contract
tests. Do not install development dependencies separately in child directories.

`npm run check --workspaces` runs each extension's formatting, TypeScript, and offline regression
checks. The installer regression tests use isolated fixtures and a stub npm executable to verify
local install scope, argument handling, and rejection of missing or out-of-checkout resources; they
do not install dependencies or make network requests.

LSP-specific checks are `npm run check:lsp` and `npm run smoke:lsp`; the latter runs the child
loader smoke test. Separately verify a clean runtime-only installation. Do not keep an older LSP
extension registered alongside this bundle. Rollback and configuration details are in
[pi-lsp/README.md](pi-lsp/README.md).

Local automated checks do not replace live terminal verification of the editor, menus,
questionnaires, and resizing.

## Source style

Use the existing per-extension dprint configuration: four spaces, no tabs, double quotes,
parenthesized arrow parameters, 100-column source lines, LF endings, and Markdown wrapped at 99
columns. Preserve import/export declaration order. Lockfiles and dependencies are not formatted.
Root scripts, tests, manifest, and documentation use the same configuration. The root formatter
command uses dprint installed in the root `node_modules/.bin`, with the root and child
configurations:

```sh
npm run format
```

## GitHub and releases

Create an empty GitHub repository, then from this checkout:

```sh
git add .
git commit -m "Initial Pi extensions bundle"
git remote add origin <your-repository-url>
git push -u origin main
```

After verification, an optional release tag is `git tag v0.1.0` followed by `git push origin
v0.1.0`. Keep the root and child package versions and their entries in the root lockfile in sync
for future releases. The bundle and Plan Mode are marked private to prevent accidental npm
publication; this does not affect GitHub or Pi Git installation.

## License

MIT. Each extension retains its own LICENSE and upstream attribution; see especially
`pi-plan/README.md` for the original Plan Mode and TUI Kit provenance.
