# Shared TUI

`@pi-extensions/tui` is the private, source-only `0.1.0` workspace at [`tui/`](../tui). It is not a
Pi extension and does not create a renderer. The root bundle still registers exactly six
extensions; all six depend on this workspace. Pi supplies the host packages as peers; this
workspace has no runtime library dependencies. Install from the bundle root with the shared
lockfile, not inside a child. Independent consumer tarballs require the private workspace too; they
are not standalone registry installs. Root bundle packing includes its sources and manifests.

## Ownership and integration

Use native `ctx.ui` dialogs/status/widgets when sufficient. Import host TUI components and local
interaction contracts through `@pi-extensions/tui`; do not import its private `src/` paths from
consumer runtime code. The package owns generic display mechanics and menu/questionnaire rendering
only. Extension registration, tool/evidence payloads, HEM's editor-offset mapping,
OAuth/credentials, fleet leases/heartbeats, Plan workflow state, persistence, and cancellation
authority stay in consumers. There is no shared lifecycle/clock abstraction.

The host contract is described in the installed coding-agent `docs/tui.md` and `docs/extensions.md`
(Pi 1.5.0). A `Component` returns rows fitting `render(width)`, implements `invalidate()`, and
requests rendering through the injected TUI after state changes. Forward focus to input/editor
children. Complete `ui.custom()` with its supplied `done`, not overlay `hide`. Dispose owned
listeners/timers and reject stale session commits locally.

## Public API

The sole export is [`tui/src/index.ts`](../tui/src/index.ts):

- All host `@earendil-works/pi-tui` values/types are re-exported unchanged, including `Component`,
  `Text`, `Markdown`, `Box`, `Input`, `SelectList`, key parsing, and width helpers.
- `defineMenu<State>(definition: MenuDefinition<State>)` defines local screen/action factories.
  `runMenu(ctx, definition, { getState, signal?, isCurrent?, onUnsupportedMode? })` supports
  actions, detail, choice, settings, input, and multi-select screens. Screen IDs and routing remain
  separate from sanitized display labels. `runQuestionnaire(ctx, { questions, allowNotes?, title?,
  ...owner })` supports choices, custom answers, notes, and review. Public types live in
  [`interaction/types.ts`](../tui/src/interaction/types.ts); implementations are strict TypeScript
  under `tui/src/interaction/`, with no third-party Pi-extension imports or type aliases.
- TUI interactions use native `ui.custom()` and host input components; RPC uses `ui.select`,
  `ui.input`, and `ui.editor`. Menus return `closed`, `stale`, or `unsupported`; questionnaires can
  also return `submitted` with raw answers. Abort/ownership changes prevent late routing, commits,
  and notifications, even when a pending RPC dialog ignores cancellation. No-UI/unsupported modes
  invoke the optional fallback callback and return `unsupported` without opening TUI components.
  `sanitizeTerminalText(value)` is a multiline display-only sanitizer with tabs replaced by spaces.
- `sanitizeDisplayText(value: string, options: DisplayTextOptions): string`. Options require
  `multiline: boolean` and `tabs: "preserve" | "space" | "expand" | "remove"`; optional `controls:
  "space" | "remove"` defaults to removal. `expand` means four spaces, not tab stops.
  CRLF/CR/LF/NEL/Unicode line separators become LF in multiline mode, otherwise spaces. Terminal
  CSI/OSC/DCS/PM/APC sequences (including unterminated strings), C0/C1 controls and bidi direction
  controls are removed or replaced; terminal-string contents are never exposed as display text.
- `inlineText(value: string): string` sanitizes to one line, collapses whitespace, and trims.
  `escapeMarkdownText(value: string): string` escapes Markdown metacharacters; sanitize first.
  `clipText(value: string, width: number): string` uses host cell/grapheme clipping with `...`
  (one/two dots at widths one/two). It does **not** sanitize.
- `wrapPreservingText(text: string, width: number): string[]` is the evidence policy: preserve
  spaces, expand tabs to four spaces, word-wrap/split tokens, preserve SGR and OSC8 across rows,
  close/reopen links, and use selective style resets without clearing the host background.
  Graphemes wider than the viewport become ASCII `\u{...}` code-point escapes, themselves wrapped.
- `hardWrapText(text: string, width: number): string[]` is the plain LSP policy: hard-wrap
  graphemes, preserve line breaks/spaces, expand four-space tabs, replace an oversized grapheme
  with `?`. It does not interpret ANSI.
- `wrapProse(text: string, width: number, oversized: "?" | "." = "?"): string[]` delegates to host
  ANSI word wrapping, without token ellipsis. A resulting row still wider than the viewport is
  replaced by the chosen single-cell placeholder. This is distinct from pickers, whose private
  `wrapWords` intentionally clips oversized words.
- `new ThemedLines(lines: () => readonly string[], options?: PresentationOptions)` and `new
  ThemedText(text: () => string, options?: PresentationOptions)` are unframed components.
  `PresentationOptions` has `outputPad?: number` and `wrap?: (text: string, width: number) =>
  string[]`. Default wrapping is `wrapProse`; a custom wrapper must return width-safe rows. These
  components accept **trusted styled text**, not raw untrusted display data.
- `new ThemedMarkdown(text: () => string, theme: () => MarkdownTheme, style?: () =>
  DefaultTextStyle)` evaluates the text callback on every render, including invalid widths, to
  detect content changes. On valid widths it sanitizes only changed text (or after invalidation),
  retains one zero-padding host Markdown across text changes and resizes, and caches final rows for
  the current width/content. Theme/style callbacks run only when constructing the host, initially
  or on the next valid render after `invalidate()`; freshly allocated theme objects do not cause
  rebuilds. Invalidation discards styled caches so active theme/style callbacks are reacquired.
  Markdown syntax is intentionally interpreted; escape literal interpolated prose separately. All
  three components have `render(width): string[]` and `invalidate(): void`; `ThemedLines` and
  `ThemedText` evaluate their callbacks on each valid render without caching.
- `formatInteractionHints(keybindings: InteractionKeybindings, hints: readonly InteractionHint[]):
  string` formats injected keybindings with native arrow glyphs and `·` separators.
  `formatHintKeys(keys: readonly string[]): string` deduplicates and joins with `/`, rendering
  arrow keys as `↑`, `↓`, `←`, `→`, and `alt` as `option` on macOS. Format generated chrome only,
  never user/model content.

All shared wrappers/components floor finite widths and return no rows for widths below one.
Clipping returns an empty string for those widths. Measure terminal cells with `visibleWidth`, not
JavaScript string length; do not split graphemes or transliterate Unicode content.

## Security, theme, and padding policy

Sanitize only a display copy, **before** applying trusted theme styling. Never sanitize persisted
plans, answers, IDs, URLs used for retrieval, evidence, tool/model payloads, or editor buffers.
Wrapping is not sanitization. `wrapPreservingText` accepts trusted SGR/OSC8 only; callers must
strip other terminal controls and validate link targets before constructing trusted links. Markdown
sanitization removes terminal injection, not Markdown structure or URL semantics.

Evaluate styles using the active callback theme during rendering. Do not store theme-colored
strings in domain state. Cached components must rebuild styled content on `invalidate()`, including
`ThemedMarkdown`; its theme/style callbacks are not polled on every render. `ThemedLines` and
`ThemedText` evaluate styles on each valid render. Use the injected keybinding manager for custom
interactions and render-context hints for tool/message renderers; do not create a global manager
that misses host remappings.

Pi's normal tool `Box` owns margins/background and `outputPad`. Its child components use no extra
padding. Widgets are full-width. Self-shell/message renderers that explicitly own padding can pass
`outputPad: 1` to `ThemedLines`/`ThemedText`: one space per side only at widths of at least three;
other values mean no padding. Do not double-pad or add decorative framing. Match native Pi chrome:
`→` selection, arrow-key hints, `✓` completion marks, and dot separators. Reuse host indicators;
keep the host's `...` overflow markers and `[x]`/`[ ]` checkboxes rather than inventing
replacements.

```ts
import { inlineText, ThemedText, wrapPreservingText } from "@pi-extensions/tui";

// Inside a renderer callback: no inner padding; the host tool shell owns it.
const component = new ThemedText(() => theme.fg("muted", inlineText(result.label)));
// For validated/trusted styled evidence, choose its distinct whitespace policy.
const evidence = new ThemedText(() => trustedEvidence, { wrap: wrapPreservingText });
```

## Verification and manual smoke

From the bundle root: `npm run typecheck`, `npm run check --workspaces`, and `npm test`. All six
consumers use the shared import boundary; `tests/tui-boundary.test.mjs` enforces it. Tests can
inspect private shared components and use the local `tests/interaction-harness.mjs` host driver.
`tests/tui-types.test.mjs` compiles a strict consumer with `allowJs: false` through the public
entrypoint, including invalid state/action contracts. `tests/tui-packaging.test.mjs` checks the
host-only dependency graph and packed TypeScript runtime closure. Root and shared pack checks are
offline dry runs with scripts disabled; they do not prove a clean runtime-only install. All child
formatter configs cover their docs; root formatting covers root `AGENTS.md` and `docs/**/*.md`.

In a real Pi terminal, with this bundle loaded once:

1. Open `/plan`, search/select with remapped navigation/confirm/cancel keys, go back, and cancel.
   Exercise multi-select, settings inputs, and questionnaires with numeric and custom answers;
   verify raw answers and notes are unchanged and cancellation commits nothing stale.
2. Resize through one/two columns and ordinary narrow/wide widths; inspect long tokens, combining
   marks, emoji, CJK, multiline text, leading/repeated spaces, and tabs. Verify no overflow or
   unintended ellipsis; pickers and evidence intentionally use different wrapping policies.
3. Change dark/light themes while components are visible; check active colors, host background,
   `outputPad` zero/one, no duplicate margins, OSC8 closure, focus/IME, and regular/fullscreen
   modes.
4. Exercise RPC dialogs and print/JSON/no-UI fallbacks without TUI components. Cancel during an
   asynchronous menu action and replace the session; verify disposed resources and no stale state.

Automated harness tests cannot establish real-terminal timing, IME, or theme integration.
