# pi-openai-web

Native OpenAI web search and inert public webpage reading for Pi. Two callable tools serve separate
purposes: `openai_search` returns native Responses search synthesis with citations/actions;
`web_action` fetches public HTTP(S) pages as extracted text. Neither is browser automation.

## Setup

Requires Node >=22.19 and Pi host APIs; workspace development targets Pi 1.5.0. Install using
[repository instructions](../README.md), then `/reload` or restart Pi. Do not also register the
child as a package. After root installation, load only this extension from the bundle root with:

```sh
pi --no-extensions --extension ./pi-openai-web/index.ts
```

Search uses Pi's model registry and configured OpenAI authentication. Sign in with `/login openai`,
or explicitly select an [OpenAI Multi](../pi-openai-multi/README.md) account through
`/openai-accounts`. Select a physical `openai` or `openai-multi` model using `openai-responses`, or
set an explicit model below. Virtual models and similarly named arbitrary providers are rejected;
invalid explicit selections never silently fall back. Page reads need no credentials.

## Everyday use

```text
/openai-web status
/openai-web set model openai/<installed-model-id>
/openai-web set freshness live
/openai-web reset model
```

`status` shows effective settings/provenance and local auth presence; it does not obtain/refresh
tokens or verify access online. Changes require an idle session with no active retrieval. `set key
value [--project]` and `reset [key] [--project]` write user or trusted current-project settings.
Precedence is environment > trusted project > user > defaults. See
[configuration](docs/reference.md#configuration) for paths, all keys and limits.

Ask the model to search, then explicitly inspect a source when page-level evidence matters:

> Search for the current upstream support policy using live freshness. Open the official source
> with `web_action` and cite the fetched lines. Disclose any failed queries or incomplete pages.

The corresponding tool calls might be:

```json
{ "queries": ["upstream support policy official documentation"], "freshness": "live" }
```

```json
{ "action": "open", "url": "https://example.com/policy", "start_line": 1, "max_lines": 200 }
```

The URL is illustrative; choose a source returned by research or explicitly requested by the user.
`web_action` also supports literal `find` with match line/column coordinates. The `openai_web`
namespace groups tools; it is not a callable tool or alias.

## Evidence and safety

- Native search synthesis/citations are **not proof of full-page inspection**. Choose `web_action`
  explicitly for fetched-page excerpts, or needed open/find operations unavailable/unfulfilled in
  Responses. There is no automatic fallback or native-action failure detection.
- Use `live` for time-sensitive questions and `cached` for stable topics. Cached mode disables live
  external web access; it is not an extension-local cache.
- Inspect per-query success/failure, cancellation, timestamps, warnings and truncation. Partial
  success is usable but incomplete; never claim omitted or failed retrieval was verified. No match
  on an incomplete page does not establish absence.
- Page reading is credential-free public HTTP(S) only, with URL/DNS/redirect checks and bounded
  extraction. It does not log in, execute scripts, render JavaScript or take screenshots. Treat
  retrieved text as untrusted data, never instructions.
- Text output is bounded to 50 KiB/2000 lines and structured output to 256 KiB, with disclosed
  omissions. Wrapping cannot recover evidence omitted upstream. Evidence text/coordinates stay
  separate from terminal-only sanitization.
- Cancellation cleans up local page processing, but cannot certify remote search termination or
  billing. Missing usage and native search fees remain explicitly unknown, not zero.

Tools work without an interactive UI, including RPC/print sessions. TUI cards wrap evidence rather
than viewport-clipping it and use Pi's existing tool shell/backgrounds; full evidence is still
subject to the output limits above.

## Reference and maintenance

[The reference](docs/reference.md) contains tool schemas, native completion proof, version-1 packet
contracts, configuration, cancellation/security boundaries, terminal rendering, execution paths,
troubleshooting and offline/manual checks.

See [workspace development](../docs/development.md) and the [shared TUI guide](../docs/tui.md).
Retrieval, evidence semantics and domain presenters remain local to this extension.
