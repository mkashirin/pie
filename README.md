# Pi local extensions

A source-based Pi extension bundle, release **0.1.0**. All four extension packages use the same
local release version; upstream provenance and dependency versions remain independent.

- **pi-hem**: Helix-style modal prompt editor.
- **pi-openai-subagents**: specialist delegation and orchestration, with bundled agent definitions.
- **pi-openai-web**: native OpenAI web search and safe public-page reading.
- **pi-plan**: local Plan Mode fork with word-wrapped menus and questionnaires.

Requires **Node.js 22.19.0 or newer**, npm, Git, and Pi with the `@earendil-works` APIs
(development checks use Pi **1.0.0**). There is no build step.

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

`install.sh` checks the Node/npm prerequisites and runs one root `npm ci --omit=dev` to install the
locked runtime dependencies. It works from any current directory and can be rerun after updates. It
does not install Pi, change user settings, register duplicate packages, or copy credentials. On
Windows without a POSIX shell, run `npm ci --omit=dev --legacy-peer-deps` from this checkout
instead.

The root `package.json` explicitly lists all four entry points, so Pi discovers this nested
checkout as one bundle. The root lockfile installs the shared runtime dependencies
(`@narumitw/pi-tui-kit`, `cheerio`, and `ipaddr.js`). Pi supplies host peers at runtime; the repo's
`.npmrc` prevents npm from installing duplicate copies. No per-extension install is needed for
normal use, and no manually configured symlinks, compiled output, or paths to another Pi
installation are required. npm creates the workspace links itself.

You can also clone directly into an **empty** `~/.pi/agent/extensions` directory; the same root
manifest and `./install.sh` work there. A nested checkout is preferable because it leaves space for
unrelated extensions. A root manifest in the extension directory takes precedence over scanning
other sibling extension directories.

Do **not** also add this auto-discovered checkout to Pi's `packages` settings. Remove older copies
of these four extensions or duplicate package registrations before loading this bundle.

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

See each extension's README for behavior, tool policies, configuration, and manual TUI checks.

## Development and verification

The normal install above is runtime-only. To install the centralized, pinned development tooling,
run `./install.sh --dev`, which runs one root `npm ci --include=dev` instead. To install and run
the full verification locally:

```sh
./install.sh --check
```

`--check` includes `--dev`, then runs `npm run check` and `npm run smoke`. These checks are opt-in;
there is no GitHub Actions workflow or other hosted CI. You can also run the commands separately:

```sh
npm run setup:dev
npm run check
npm run smoke
```

`setup:dev` runs `npm ci --include=dev --legacy-peer-deps` once at the repository root. It does not
modify Pi's managed installation or user settings. All four child packages are npm workspaces;
development dependencies and tooling are installed at the root, and the single root
`package-lock.json` belongs in Git. There are no child lockfiles. Run setup again after
dependency/lockfile updates. Individual extensions also support `npm run check` from their own
directories after root setup; they use the shared root tooling, including for sibling web-contract
tests. Do not install development dependencies separately in child directories.

`check` uses native npm workspace commands to run the child checks and verifies bundle manifests,
synchronized versions, runtime dependencies, formatting, TypeScript, and all offline regression
suites. `smoke` creates a clean temporary runtime-only checkout, installs only the root
dependencies, and checks Pi's actual discovery, loader, and offline session startup for **both
nested and flat extension-directory layouts**. It also checks local package registration. The smoke
install needs npm registry access; no credentials, paid model requests, or live web retrieval are
used.

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
