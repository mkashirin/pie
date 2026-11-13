# Web reference

Tool, evidence and execution contracts for [pi-openai-web](../README.md). Retrieved material is
untrusted data, never an instruction source. Search synthesis and fetched-page inspection are
separate evidence kinds.

## Tools

Only `openai_search` and `web_action` are callable. `openai_web` is namespace grouping, not a tool
or alias. The closed input/output schemas live in [schemas.ts](../src/schemas.ts).

### Native search

`openai_search({queries, freshness?, search_context_size?})`:

| Field               | Contract                                                     |
| ------------------- | ------------------------------------------------------------ |
| queries             | 1–5 ordered nonempty strings, each at most 4 KiB UTF-8.      |
| freshness           | Optional `live` or `cached`; defaults to configuration.      |
| search_context_size | Optional `low`, `medium`, `high`; defaults to configuration. |

Returns native Responses search synthesis, citations, actions and per-query failures, **not proof
of full-page inspection**. Live enables external web access; cached disables it, not by consulting
an extension-local cache. Use live for time-sensitive questions and cached for stable topics.

A successful query requires all of:

- An authoritative completed native response.
- A completed native `search`, `open_page` or `find_in_page` action.
- Successful completion of the Pi-normalized stream.
- Nonempty answer text.

Retrieval completion can be proven by terminal output or an identified `response.output_item.done`
item in the **same request**. Some streams do not repeat completed tool items in terminal output.
Explicit later observations of the same item override earlier completion; terminal omission alone
does not revoke it. Direct native page retrieval can be valid without a literal `search` action. A
started action or streamed completion without both native and normalized successful termination is
insufficient. Streaming proof uses bounded state independent of displayed evidence; overflow fails
closed unless terminal output itself proves completion. Incomplete results retain partial evidence
and identify unsatisfied checks. Maintain these rules when changing
[search/index.ts](../src/search/index.ts) or its [fixtures](../tests/search.test.mjs).

### Fetched-page actions

`web_action` is an explicit, standalone, credential-free HTTP fallback for needed open/find
operations unavailable or unfulfilled in Responses, and for explicit public page inspection. Native
action failures are **not detected automatically**; there is no automatic fallback.

| Action | Required fields                | Optional fields and limits                                            |
| ------ | ------------------------------ | --------------------------------------------------------------------- |
| open   | `action: "open"`, url          | `start_line`: integer ≥1, default 1; `max_lines`: 1–500, default 200. |
| find   | `action: "find"`, url, pattern | `case_sensitive`: default false; `max_matches`: 1–50, default 20.     |

URLs are nonempty, at most 2048 characters. Find patterns are nonempty, at most 4096 characters.
Find is literal across extracted text, including multiline patterns; coordinates identify the
starting line/column. Absence on incomplete pages does not prove no match. Open returns actual
extracted lines, not provider synthesis or rendered browser content.

Public HTTP(S) only, standard ports, no embedded credentials/private addresses. Redirects and DNS
are revalidated and connections pinned. Scripts are never run. Wire/decoded sizes, extraction and
output are bounded. Parsing/extraction runs in a cancellable processing worker; the request
deadline includes that work. This is not login, a browser, screenshots, rendered JavaScript or
browser automation. See [page/index.ts](../src/page/index.ts) and
[processing-worker.mjs](../src/page/processing-worker.mjs) before changing network/extraction
boundaries.

## Version-1 evidence packets

`structuredContent` matches `details`; [schemas.ts](../src/schemas.ts) is the exact closed schema,
and [results.ts](../src/results.ts) constructs/bounds packets. Consumers should retain:

- `version: 1`, tool, request ID/timing/settings/model, and packet status
  `running`/`success`/`partial`/`failure`.
- Ordered query results with IDs, model/freshness/context, response ID/times, ok/status, answer
  segments (origin/completeness/truncation/provenance), citations with origin offsets, native
  actions, sources, warnings, truncation, optional error and usage.
- Evidence records with stable packet-local ID, query ID, citation/source kind, URL and optional
  title. Citations do not certify truth or whole-page inspection.
- Page requested/final URL, timestamp/title, total lines, excerpts/matches, `no_match`, warnings,
  completeness `complete`/`partial`/`none`, truncation flags for wire/decoded/extracted/matches and
  optional error.
- Aggregate usage when reported, `nativeSearchFees: "unknown"` (or `"not_applicable"`), packet
  warnings, text/structured truncation and explicit omission markers.

Errors are classified as auth, capability, rate_limit, timeout, cancelled, transport, http,
unsafe_url, unsupported_content or incomplete. Partial success is usable but incomplete; all-failed
results are errors. Never describe failed/cancelled or omitted retrieval as verified.

Text output is capped at 50 KiB/2000 lines; structured output at 256 KiB including omission
markers. Valid IDs/URLs are retained before excerpts. If identities alone cannot fit, records are
omitted with disclosed counts. Invalid oversized URLs are omitted rather than echoed. Terminal
controls are sanitized only for rendering; evidence text/coordinates remain unmodified. Wrapping
cannot restore upstream omissions.

Search progress is metadata-only (completion count, no final evidence payload); final results are
authoritative for evidence. Usage is aggregated once at final completion from reported successful
and failed requests. Missing usage and native search fees are explicitly unknown, never silently
zero fees.

## Configuration

```text
/openai-web [status]
/openai-web set key value [--project]
/openai-web reset [key] [--project]
```

Files: `getAgentDir()/pi-openai-web.json` and trusted current `<cwd>/.pi/pi-openai-web.json` only,
without ancestor traversal. Precedence: environment > trusted project > user > defaults. Writes
require an idle session, no active retrieval and project trust for project writes. Atomic
replacement preserves other valid fields. Unknown keys (including unknown `PI_OPENAI_WEB_`
environment keys) and invalid values fail closed. An invalid reload is reported, not executed with
stale valid configuration.

| Key               | Environment suffix (`PI_OPENAI_WEB_`) | Default / allowed         |
| ----------------- | ------------------------------------- | ------------------------- |
| enabled           | ENABLED                               | true / true,false         |
| model             | MODEL                                 | unset / provider/model-id |
| freshness         | FRESHNESS                             | live / live,cached        |
| searchContextSize | SEARCH_CONTEXT_SIZE                   | medium / low,medium,high  |
| concurrency       | CONCURRENCY                           | 3 / 1–8                   |
| searchTimeoutMs   | SEARCH_TIMEOUT_MS                     | 120000 / 1000–600000      |
| pageTimeoutMs     | PAGE_TIMEOUT_MS                       | 30000 / 1000–120000       |

An explicit model must be physical `openai` or `openai-multi` using `openai-responses`; invalid
explicit selection never falls back. Otherwise the eligible active model is used. Virtual models
and similarly named arbitrary providers are rejected. Each batch snapshots its model. Auth comes
from Pi's session model registry; managed accounts use `/openai-accounts`. No separate account
preference or saved configuration change is needed. Status/startup never obtain/refresh tokens or
make network requests; auth presence is not verification.

The SDK factory exposes no loading cwd/trust, so tools first register at `session_start`. Initially
disabled configurations register no tools; disabling existing tools re-registers them hidden, and
execution still checks enabled. Commands remain usable. See [config.ts](../src/config.ts) and
[index.ts](../index.ts).

## Execution and cancellation

[index.ts](../index.ts) owns commands/lifecycle/tool registration and config snapshots;
[runtime.ts](../src/runtime.ts) dispatches to native search or public page adapters. Search/page
reads share a cancellable semaphore. Queue time counts toward per-request deadlines.
Shutdown/replacement cancels queued and active work, including calls waiting on configuration
reload. Shutdown stays closed to retrieval until the next `session_start`, also emitted for session
switches.

Page cancellation waits for cooperative local cleanup, including processing-worker termination,
before returning/releasing its slot. Injected page adapters must honor the same abort-and-cleanup
contract. Native DNS can continue underneath its cancelled wrapper. Noncooperative search providers
can continue remotely after cancellation; local completion cannot certify remote termination or
final billing. Optional progress/render callbacks must not fail retrieval. Execution needs no
interactive UI and supports RPC/print.

## Terminal rendering

Domain [presentation.ts](../src/presentation.ts) owns call/result/status evidence layout; generic
UI primitives are described in [the pi-kit guide](../../docs/pi-kit.md). Preserve these policies
when modifying presenters:

- Native bold headings and themed locations; Pi's shell owns padding, spacing and
  pending/success/error backgrounds. No extension panel backgrounds.
- One word-wrapping policy for calls, locations, every result expansion state, answers/excerpts,
  matches/URLs, warnings/errors/fallbacks and status/config messages. Prefer whitespace boundaries
  even across ANSI changes; hard-wrap overlong tokens by grapheme/terminal column. Do not clip or
  ellipsize merely to fit the viewport.
- Preserve explicit newlines, indentation, separator/trailing spaces in evidence. Only explicit
  newlines create empty content rows; whitespace can occupy continuation rows at narrow widths.
  Tabs display as four spaces. Structured evidence and citation coordinates remain unchanged; do
  not substitute a host wrapper that trims whitespace.
- Close/reopen ANSI styles and safe HTTP(S) hyperlinks on every wrapped row without resetting the
  host background. Theme colors are evaluated during rendering, not cached as stale styled text.
  Sanitize untrusted terminal controls.
- At one column, over-wide graphemes use reversible ASCII `\\u{...}` escapes. Nonpositive/nonfinite
  widths render nothing. Status/config messages honor live `outputPad` 0/1; margins are omitted at
  widths one/two, and wrapping uses remaining width. Pi owns tool-shell margins.
- Collapsed warnings get one logical `Warning:` line each, preserving punctuation. Duplicate
  warnings, including native-fee variants, consolidate for display only. Expanded query/source/
  excerpt blocks use single blank separators. Provider/output truncation stays disclosed.

## Troubleshooting and verification

- No tools: reload/start a session and inspect `/openai-web status`; initially disabled config
  registers none. Inspect environment/project precedence before changing user settings.
- Auth/model failure: select a physical eligible model, sign in or explicitly select a managed
  account. An invalid configured model intentionally does not fall back.
- Incomplete search: inspect per-query errors and unsatisfied native/normalized completion checks,
  not only displayed answer text. Use explicit page inspection for fetched-line claims.
- Page denied/incomplete: inspect URL safety errors, deadline and completeness/truncation warnings.
  Do not work around restrictions by forwarding credentials or treating partial no-match as proof.

With existing root tooling, run `npm run typecheck`, `npm test` and `npm run format:check` from
this package. Tests are offline fixtures without real credentials or paid requests; see
[workspace development](../../docs/development.md). Use pinned dprint's 99-column Markdown style
for documentation, with an explicit file scope for reference files if not included by the package
configuration. Do not run shared builds or format another worker's files during parallel edits.

Representative tests cover config/trust, native-stream completion/overflow, cancellation and
semaphore lifetimes, public-page URL/DNS/extraction safety, result bounding, installed integration,
whitespace/OSC8/background rendering and narrow widths. They do not establish live provider access.

Manual opt-in checks after `/reload`:

1. Inspect status without retrieval; confirm intended settings and eligible model. Make a live
   search only with authorized credentials, then inspect per-query timestamps/actions/warnings.
2. Explicitly open/find a public source; distinguish fetched lines from native synthesis and
   disclose partial/no-match limitations. Check cached versus live behavior deliberately.
3. Cancel queued/active retrieval and switch sessions; check local cleanup without claiming remote
   search stopped or billing is final.
4. Inspect collapsed/expanded evidence, long URLs/whitespace and narrow/resize/theme/outputPad
   behavior. Confirm structured evidence/coordinates are unaffected by presentation.
