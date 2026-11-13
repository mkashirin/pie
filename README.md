# Pi extensions

Six source-based extensions for Pi: a modal prompt editor, specialist delegation, explicit OpenAI
account selection, web tools, language-server tools, and Plan Mode. Pi loads the sources directly;
there is no build step.

## What's included

| Extension                                            | What it adds                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [pi-hem](pi-hem/README.md)                           | Insert-first, Helix-style prompt editing with multiple selections, registers, regex search, and macros.     |
| [pi-openai-subagents](pi-openai-subagents/README.md) | Specialist delegation and orchestration, including optional, convention-aware Gardener cleanup/refactoring. |
| [pi-openai-multi](pi-openai-multi/README.md)         | Opt-in, explicit per-session ChatGPT account selection for OpenAI models.                                   |
| [pi-openai-web](pi-openai-web/README.md)             | Native OpenAI web search and safe public-page reading.                                                      |
| [pi-lsp](pi-lsp/README.md)                           | Language-server diagnostics and conservative single-file fix previews/application.                          |
| [pi-plan](pi-plan/README.md)                         | Interactive planning, questionnaires, saved plans, and implementation handoff.                              |

The bundle also includes [onboard](skills/onboard/SKILL.md),
[researcher](skills/researcher/SKILL.md), and the Russian-text skills
[ru-check](skills/ru-check/SKILL.md), [ru-score](skills/ru-score/SKILL.md), and
[ru-text](skills/ru-text/SKILL.md). The private shared [pi-kit workspace](docs/pi-kit.md) is
supporting code, not a seventh extension.

## Install

Requires **Node.js 22.19.0+**, npm, Git, and an installed Pi using the `@earendil-works` APIs.
Development tooling targets Pi **1.5.0**.

With Pi already installed, clone into a subdirectory of its extension directory:

```sh
mkdir -p ~/.pi/agent/extensions
git clone <your-repository-url> ~/.pi/agent/extensions/pi-extensions
cd ~/.pi/agent/extensions/pi-extensions
./install.sh
```

Replace the URL with your repository's clone URL. After installation, start Pi from your intended
project directory (not necessarily this checkout); auto-discovery loads the bundle, and existing
project sessions can use `/reload`. With a custom `PI_CODING_AGENT_DIR`, use that agent directory's
`extensions/` directory instead.

The installer installs locked runtime dependencies in this checkout. It does not install Pi,
register skills, copy credentials, or change Pi settings. Do not install separately in child
packages. Do **not** also register an auto-discovered checkout in Pi's `packages` settings; remove
older copies or registrations of these extensions to avoid duplicate loading.

See [installation and updates](docs/installation.md) for Pi-managed Git installation, Windows,
installation scope, and skill registration.

## First use

- **Editor:** HEM starts in insert mode. Press `Escape` for normal mode; `/hem` shows help.
- **Planning:** open `/plan`, or start with `/plan <your request>`. Use `/plan settings` for
  preferences and `/plan exit` to leave.
- **Language servers:** install your server executable separately, configure `pi-lsp.json`, then
  use `/lsp status` to check configuration and executable availability without starting servers.
- **Web:** use `/openai-web status` to inspect configuration.
- **Delegation:** inspect `/subagents list`, then enable orchestration with `/subagents on`.
- **Accounts:** follow [pi-openai-multi](pi-openai-multi/README.md) to add/select your own account;
  installing this bundle does not opt other consumers into account routing.

OpenAI search and default subagent assignments need your own authentication and an eligible,
available physical `openai` or `openai-multi` model using the `openai-responses` API. Use `/login
openai` and select an eligible model in Pi. Subagents inherit an eligible active OpenAI model by
default; configure one explicitly when needed:

```text
/subagents model default openai/<installed-model-id> --save
```

Without an eligible active model, subagents currently fall back to `openai/gpt-6.1-sol`; do not
assume that fallback is available to your account. Public-page `web_action` needs network access
but no OpenAI credentials. Without explicit model settings, subagents and web tools can inherit an
eligible active `openai-multi` model. Selecting it does not rewrite saved assignments; configure
each consumer explicitly if you need routing independent of the foreground selection.

## Skills

For one invocation, start Pi from this checkout with `pi --skill ./skills`. Auto-discovery from an
extension-directory clone loads extensions, **not** the bundled skills. For persistent skill
registration and example workflows, see [using skills](docs/installation.md#using-skills).

`onboard` distills inspected repository knowledge into `AGENTS.md`; `researcher` supports paper
discussion, source checking, and English/Russian academic editing. Neither installs tools or
changes settings by default. Research retrieval uses the connected AlphaXiv MCP when available;
language-only editing is not a fact-check.

## Development

From the bundle root, use `./install.sh --dev` for shared tooling, then `npm run check` for root
and workspace checks. There are **seven workspaces and six Pi entrypoints**, one root lockfile, and
no child installation step. See [development and verification](docs/development.md),
[pi-kit architecture](docs/pi-kit.md), and the [agent operating guide](AGENTS.md).

## License

Local release **0.1.0**, MIT. See [LICENSE](LICENSE) and each package's license and notices,
including [HEM's third-party notices](pi-hem/THIRD_PARTY_NOTICES.md). Dependency versions are
independent of the bundle version.
