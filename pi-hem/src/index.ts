import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
    type AutocompleteProvider,
    type AutocompleteSuggestions,
    CURSOR_MARKER,
    type EditorTheme,
    SelectList,
    truncateToWidth,
    type TUI,
    type TuiMouseEvent,
    type TuiMouseEventResult,
    visibleWidth,
} from "@earendil-works/pi-tui";
import { graphemes, HelixBuffer } from "./model.ts";
import { CommandController } from "./commands.ts";
import { InputDecoder } from "./input.ts";
import { bindings as modalBindings, resolveBinding } from "./compatibility.ts";
import { createClipboard } from "./clipboard.ts";
import { layout as sharedLayout } from "./layout.ts";
type Matcher = (text: string, pattern: string) => { start: number; end: number }[];

type Row = {
    cells: { text: string; index: number; width: number }[];
    start: number;
    cursor: boolean;
};

export class HelixEditor extends CustomEditor {
    readonly buffer = new HelixBuffer();
    private manualViewport = false;
    readonly controller = new CommandController(this.buffer, {
        matcher: (text, pattern) => this.matcher?.(text, pattern) ?? [],
        clipboard: createClipboard(),
        feedback: (message) => {
            // deno-lint-ignore no-control-regex -- Strip terminal control characters from feedback.
            this.controller.status = message.replace(/[\x00-\x1f\x7f-\x9f]/g, "�");
            if (!this.disposed) this.tui.requestRender();
        },
        changed: () => {
            if (!this.disposed) this.changed();
        },
        requestRender: () => {
            if (!this.disposed) this.tui.requestRender();
        },
        requestCompletion: () => this.requestCompletion(true),
        view: {
            pageSize: 10,
            scroll: (lines) => {
                this.offset = Math.max(
                    0,
                    Math.min(Math.max(0, this.rows.length - this.visibleRows), this.offset + lines),
                );
                this.manualViewport = true;
            },
            align: (where) => {
                const current = Math.max(0, this.rows.findIndex((row) => row.cursor));
                this.offset = Math.max(
                    0,
                    current - (where === "top"
                        ? 0
                        : where === "center"
                        ? Math.floor(this.visibleRows / 2)
                        : this.visibleRows - 1),
                );
                this.manualViewport = true;
            },
            middle: () =>
                this.rows[
                    Math.min(this.rows.length - 1, this.offset + Math.floor(this.visibleRows / 2))
                ]?.start ?? 0,
            wordLabels: () => this.wordLabels(),
            boundary: (where, count) => this.moveBoundary(where, count),
            moveVisual: (direction, count) => this.moveVisual(direction, count),
            page: (direction, count, half) =>
                this.moveVisual(
                    direction,
                    count * Math.max(1, Math.floor(this.visibleRows / (half ? 2 : 1))),
                ),
            viewport: (where) => {
                const row = this.rows[
                    this.offset + (where === "top"
                        ? 0
                        : where === "middle"
                        ? Math.floor(this.visibleRows / 2)
                        : this.visibleRows - 1)
                ];
                if (row) {
                    this.buffer.moveTo(row.start);
                }
            },
        },
    });
    private wordTargets: { label: string; index: number }[] = [];
    private wordPrefix = "";

    private wordLabels(): void {
        const units = graphemes(this.buffer.text);
        const positions = this.rows.slice(this.offset, this.offset + this.visibleRows)
            .flatMap((row) => row.cells)
            .filter((cell) =>
                /[\p{L}\p{N}_]/u.test(units[cell.index] ?? "")
                && !/[\p{L}\p{N}_]/u.test(units[cell.index - 1] ?? "")
            );
        const double = positions.length > 26;
        this.wordTargets = positions.slice(0, 676).map((cell, i) => ({
            label: double
                ? String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26)
                : String.fromCharCode(97 + i),
            index: cell.index,
        }));
        this.wordPrefix = "";
        this.controller.status = this.wordTargets.length ? "Jump label" : "No visible words";
        this.tui.requestRender();
    }

    private decoder = new InputDecoder();
    private escapeTimer?: ReturnType<typeof setTimeout>;
    private modalPrefix: string[] = [];
    private disposed = false;
    private readonly editorTheme: EditorTheme;
    private readonly bindings: KeybindingsManager;
    private provider?: AutocompleteProvider;
    private suggestions?: AutocompleteSuggestions;
    private list?: SelectList;
    private pending?: AbortController;
    private timer?: ReturnType<typeof setTimeout>;
    private requestId = 0;
    private suggestionsVersion = -1;
    private completionSnapshot = "";
    private snapshot(): string {
        return JSON.stringify([
            this.buffer.revision,
            this.buffer.primaryId,
            this.buffer.selections,
        ]);
    }
    private promptHistory: string[] = [];
    private promptIndex = -1;
    private promptDraft = "";
    private offset = 0;
    private rows: Row[] = [];
    private padding = 0;
    private maxSuggestions = 5;
    private visibleRows = 0;

    constructor(
        tui: TUI,
        theme: EditorTheme,
        bindings: KeybindingsManager,
        private matcher?: Matcher,
    ) {
        super(tui, theme, bindings, { embedWorkingStatus: true });
        this.editorTheme = theme;
        this.bindings = bindings;
    }

    override getText(): string {
        return this.buffer.text;
    }

    override getExpandedText(): string {
        return this.buffer.text;
    }

    override getLines(): string[] {
        return this.buffer.text.split("\n");
    }

    override getCursor(): { line: number; col: number } {
        return this.buffer.position;
    }

    override setText(text: string): void {
        const previous = this.buffer.text;
        this.controller.cancelPending();
        this.modalPrefix = [];
        this.wordTargets = [];
        this.wordPrefix = "";
        if (!text && previous) this.buffer.reset();
        else this.buffer.setText(text);
        this.buffer.enterInsert();
        this.cancelCompletion();
        if (previous !== this.buffer.text) this.changed(false);
        this.tui.requestRender();
    }

    override insertTextAtCursor(text: string): void {
        if (this.buffer.mode !== "insert") this.buffer.enterInsert();
        if (this.buffer.insert(text)) {
            this.controller.recordInsertion(text);
            this.changed();
        }
    }

    override addToHistory(text: string): void {
        if (text && this.promptHistory.at(-1) !== text) this.promptHistory.push(text);
        this.promptIndex = -1;
    }

    override setAutocompleteProvider(provider: AutocompleteProvider): void {
        this.provider = provider;
    }

    override setPaddingX(value: number): void {
        this.padding = Math.min(3, Math.max(0, value));
        this.tui.requestRender();
    }

    override setAutocompleteMaxVisible(value: number): void {
        this.maxSuggestions = Math.max(3, value);
    }

    override isShowingAutocomplete(): boolean {
        return !!this.list;
    }

    private cancelCompletionRequest(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        this.pending?.abort();
        this.pending = undefined;
        this.requestId++;
    }

    private cancelCompletion(): void {
        this.cancelCompletionRequest();
        this.suggestions = undefined;
        this.suggestionsVersion = -1;
        this.list = undefined;
        this.tui.requestRender();
    }

    private completionContext(): { automatic: boolean; slashCommand: boolean } {
        const { line, col } = this.getCursor();
        const before = (this.getLines()[line] ?? "").slice(0, col);
        // Spaces terminate automatic completion. Slash command arguments and plain
        // paths remain accessible via explicit Tab, not on every word boundary.
        const slashCommand = line === 0 && /^\s*\/\S*$/.test(before);
        const triggers = ["@", "#", ...(this.provider?.triggerCharacters ?? [])]
            .filter((char) => char.length === 1 && !/\s|\//.test(char));
        const escaped = triggers.map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
            "",
        );
        const attachment = escaped
            && new RegExp(`(?:^|[\\s([{<\\x60])[${escaped}][^\\s]*$`, "u").test(before);
        return { automatic: !!(slashCommand || attachment), slashCommand };
    }

    private requestCompletion(force = false): void {
        if (!this.provider || this.buffer.mode !== "insert") {
            this.cancelCompletion();
            return;
        }
        const context = this.completionContext();
        if (!force && !context.automatic) {
            this.cancelCompletion();
            return;
        }
        const { line, col } = this.getCursor();
        if (
            force && !context.slashCommand
            && this.provider.shouldTriggerFileCompletion?.(this.getLines(), line, col) === false
        ) {
            this.cancelCompletion();
            return;
        }
        // Keep the existing popup in place during debounce/network refresh; only
        // invalidate its contents for acceptance until the new result arrives.
        this.cancelCompletionRequest();
        const id = this.requestId;
        this.timer = setTimeout(
            () => void this.fetchCompletion(id, force && !context.slashCommand),
            force ? 0 : 100,
        );
    }

    private async fetchCompletion(id: number, force: boolean): Promise<void> {
        const provider = this.provider;
        if (this.disposed || !provider || id !== this.requestId) return;
        const controller = new AbortController();
        this.pending = controller;
        const { line, col } = this.getCursor();
        const revision = this.buffer.revision;
        const selection = JSON.stringify([this.buffer.primaryId, this.buffer.selections]);
        try {
            const result = await provider.getSuggestions(this.getLines(), line, col, {
                signal: controller.signal,
                force,
            });
            if (
                this.disposed || controller.signal.aborted || id !== this.requestId
                || revision !== this.buffer.revision
                || selection !== JSON.stringify([this.buffer.primaryId, this.buffer.selections])
            ) return;
            this.pending = undefined;
            if (!result?.items.length) {
                this.cancelCompletion();
                return;
            }
            const selected = this.list?.getSelectedItem();
            const selectedValue = selected
                && this.suggestions?.items[Number(selected.value)]?.value;
            this.completionSnapshot = this.snapshot();
            this.suggestions = result;
            this.suggestionsVersion = id;
            this.list = new SelectList(
                result.items.map((item, index) => ({
                    value: String(index),
                    label: item.label,
                    description: item.description,
                })),
                this.maxSuggestions,
                this.editorTheme.selectList,
            );
            const selectedIndex = result.items.findIndex((item) => item.value === selectedValue);
            if (selectedIndex >= 0) this.list.setSelectedIndex(selectedIndex);
            this.list.onSelect = () => this.acceptCompletion();
            this.tui.requestRender();
        } catch { // Cancellation and file lookup failures must not break prompt input.
            if (id === this.requestId) this.cancelCompletion();
        }
    }

    private acceptCompletion(): boolean {
        if (
            this.disposed || this.suggestionsVersion !== this.requestId
            || this.completionSnapshot !== this.snapshot()
        ) return false;
        const item = this.list?.getSelectedItem();
        const choice = item && this.suggestions?.items[Number(item.value)];
        if (!choice || !this.suggestions || !this.provider) return false;
        const { line, col } = this.getCursor();
        const result = this.provider.applyCompletion(
            this.getLines(),
            line,
            col,
            choice,
            this.suggestions.prefix,
        );
        const before = this.buffer.text;
        const after = result.lines.join("\n");
        const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
        const oldCells = this.buffer.cells;
        const newCells = Array.from(segmenter.segment(after), (part) => part.segment);
        let prefix = 0, start = 0;
        while (
            prefix < oldCells.length && prefix < newCells.length
            && oldCells[prefix] === newCells[prefix]
        ) {
            start += oldCells[prefix]!.length;
            prefix++;
        }
        let oldEnd = oldCells.length, newEnd = newCells.length;
        let end = before.length, afterEnd = after.length;
        while (
            oldEnd > prefix && newEnd > prefix
            && oldCells[oldEnd - 1] === newCells[newEnd - 1]
        ) {
            end -= oldCells[--oldEnd]!.length;
            afterEnd -= newCells[--newEnd]!.length;
        }
        const primaryHead = this.buffer.visualHead();
        // Replay the logical token replacement, not just its changed letters.
        // Keep the actual broadcast edit minimal and its context checks unchanged.
        let replayStart = start, replayEnd = end, replayAfterEnd = afterEnd;
        let tokenStart = primaryHead, tokenEnd = primaryHead;
        const boundaries = [0];
        for (const cell of oldCells) boundaries.push(boundaries.at(-1)! + cell.length);
        const headCell = boundaries.indexOf(primaryHead);
        if (headCell >= 0) {
            let left = headCell, right = headCell;
            while (left > 0 && !/\s/u.test(oldCells[left - 1]!)) left--;
            while (right < oldCells.length && !/\s/u.test(oldCells[right]!)) right++;
            tokenStart = boundaries[left]!;
            tokenEnd = boundaries[right]!;
            const providerPrefix = this.suggestions.prefix;
            const providerStart = primaryHead - providerPrefix.length;
            if (
                providerPrefix && providerStart >= tokenStart && providerStart <= start
                && boundaries.includes(providerStart)
                && before.slice(providerStart, primaryHead) === providerPrefix
            ) tokenStart = providerStart;
            const tokenAfterEnd = after.length - (before.length - tokenEnd);
            if (
                start >= tokenStart && end <= tokenEnd
                && tokenAfterEnd >= tokenStart
                && !/\s/u.test(after.slice(tokenStart, tokenAfterEnd))
            ) {
                replayStart = tokenStart;
                replayEnd = tokenEnd;
                replayAfterEnd = tokenAfterEnd;
            }
        }
        const saved = this.buffer.selections.map((s) => ({ ...s }));
        const relativeStart = start - primaryHead, relativeEnd = end - primaryHead;
        const context = (head: number) => before.slice(0, head).split(/\s/u).at(-1);
        const matching = saved.every((s) => {
            const head = this.buffer.visualHead(s);
            return context(head) === context(primaryHead) && head + relativeStart >= 0
                && before.slice(head + relativeStart, head + relativeEnd)
                    === before.slice(start, end);
        });
        const active = matching ? saved : [{ ...this.buffer.primary }];
        if (!matching) this.buffer.setSelections(active, this.buffer.primaryId);
        const edits = active.map((s) => {
            const head = this.buffer.visualHead(s);
            return {
                start: head + relativeStart,
                end: head + relativeEnd,
                text: after.slice(start, afterEnd),
            };
        });
        this.buffer.replaceRanges(edits);
        const target = result.lines.slice(0, result.cursorLine).join("\n").length
            + (result.cursorLine ? 1 : 0) + result.cursorCol;
        let utf16 = 0;
        let index = 0;
        for (const cell of this.buffer.cells) {
            if (utf16 >= target) break;
            utf16 += cell.length;
            index++;
        }
        this.buffer.enterInsert();
        if (matching && active.length > 1) {
            this.buffer.setSelections(
                active.map((s, i) => {
                    const edit = edits[i]!;
                    const delta = edits.filter((e) => e.start < edit.start).reduce(
                        (n, e) => n + e.text.length - (e.end - e.start),
                        0,
                    );
                    const position = edit.start + delta + target - start;
                    return { ...s, start: position, end: position, reversed: false };
                }),
                this.buffer.primaryId,
            );
        } else this.buffer.moveTo(index);
        this.cancelCompletion();
        if (before !== this.buffer.text) {
            this.controller.recordCompletion(
                replayStart - primaryHead,
                replayEnd - primaryHead,
                after.slice(replayStart, replayAfterEnd),
                target - replayStart,
            );
            this.changed(false);
        }
        return true;
    }

    private changed(completion = true): void {
        this.onChange?.(this.buffer.text);
        this.tui.requestRender();
        if (completion) this.requestCompletion();
    }

    private browse(direction: -1 | 1): void {
        if (!this.promptHistory.length) return;
        if (this.promptIndex < 0) this.promptDraft = this.buffer.text;
        const next = this.promptIndex + direction;
        if (next < -1 || next >= this.promptHistory.length) return;
        this.promptIndex = next;
        this.setText(
            next < 0 ? this.promptDraft : this.promptHistory[this.promptHistory.length - 1 - next]!,
        );
    }

    private submit(): void {
        if (this.disableSubmit || !this.buffer.text.trim()) return;
        const text = this.buffer.text.trim();
        this.cancelCompletion();
        // Pi's default Editor clears itself before calling onSubmit. Pi's normal
        // submission handler does not clear the buffer, so do that here as well.
        this.controller.cancelPending();
        this.buffer.reset();
        this.promptIndex = -1;
        this.onChange?.("");
        this.tui.requestRender();
        this.onSubmit?.(text);
    }

    override handleInput(data: string): void {
        if (this.disposed) return;
        if (this.escapeTimer) clearTimeout(this.escapeTimer);
        const events = this.decoder.feed(data);
        this.escapeTimer = setTimeout(() => {
            this.escapeTimer = undefined;
            if (this.disposed) return;
            for (const event of this.decoder.flushEscape()) {
                if (event.type === "key") this.handleKey(event.key, "\x1b");
                else this.insertTextAtCursor(event.text);
            }
        }, 25);
        for (const event of events) {
            if (event.type === "paste") this.insertTextAtCursor(event.text);
            else this.handleKey(event.key, events.length === 1 ? data : event.key);
        }
    }

    private handleKey(key: string, data: string): void {
        const kb = this.bindings;
        if (this.wordTargets.length) {
            const prefix = this.wordPrefix + key;
            const target = this.wordTargets.find((item) => item.label === prefix);
            if (target) this.buffer.moveTo(target.index);
            if (
                key !== "escape" && !target
                && this.wordTargets.some((item) => item.label.startsWith(prefix))
            ) {
                this.wordPrefix = prefix;
            } else {
                this.wordTargets = [];
                this.wordPrefix = "";
                this.controller.status = "";
            }
            this.tui.requestRender();
            return;
        }
        if (kb.matches(data, "tui.editor.historyPrevious")) {
            this.browse(1);
            return;
        }
        if (kb.matches(data, "tui.editor.historyNext")) {
            this.browse(-1);
            return;
        }
        if (key === "escape" || kb.matches(data, "app.interrupt")) {
            if (this.list) {
                this.cancelCompletion();
                return;
            }
            if (this.modalPrefix.length) {
                this.modalPrefix = [];
                this.controller.cancelPending();
                this.tui.requestRender();
                return;
            }
            if (this.controller.cancelPending()) {
                this.tui.requestRender();
                return;
            }
            if (this.buffer.mode !== "normal") {
                this.buffer.escape();
                this.tui.requestRender();
                return;
            }
            const primary = this.buffer.primary;
            if (this.buffer.selections.length > 1 || primary.start !== primary.end) {
                const head = this.buffer.visualHead();
                this.buffer.setSelections([{
                    id: primary.id,
                    start: head,
                    end: head,
                    reversed: false,
                }]);
                this.tui.requestRender();
                return;
            }
            (this.onEscape ?? this.actionHandlers.get("app.interrupt"))?.();
            return;
        }
        if (this.buffer.mode === "normal" || this.buffer.mode === "select") {
            const owned = this.controller.hasPending;
            const sequence = [...this.modalPrefix, key];
            const resolved = resolveBinding(this.buffer.mode, sequence);
            const hadPrefix = this.modalPrefix.length > 0;
            this.modalPrefix = resolved.prefix && !resolved.binding ? sequence : [];
            if (
                key === "enter" && !hadPrefix && !owned
            ) {
                this.submit();
                return;
            }
            if (hadPrefix && !resolved.binding && !resolved.prefix && !this.controller.pending) {
                return;
            }
            if (resolved.binding?.classification === "excluded") {
                this.controller.cancelPending();
                this.modalPrefix = [];
                this.controller.status = resolved.binding.reason ?? "Unavailable in prompt";
                this.tui.requestRender();
                return;
            }
            if (
                resolved.prefix && !resolved.binding && !this.controller.pending
                && !modalBindings.some((binding) =>
                    binding.classification !== "excluded"
                    && binding.modes.includes(this.buffer.mode)
                    && sequence.every((part, i) => binding.keys[i] === part)
                )
            ) {
                this.controller.status = `${sequence.join(" ")} …`;
                this.tui.requestRender();
                return;
            }
            if (key === "enter" && (owned || hadPrefix) && !this.controller.search) {
                this.controller.cancelPending();
                this.modalPrefix = [];
                this.controller.status = "Cancelled pending command";
                this.tui.requestRender();
                return;
            }
            const handled = this.controller.handleKey(key);
            if (resolved.binding?.classification === "pending" && !handled) {
                this.controller.status = resolved.binding.reason ?? "Not available in this editor";
            }
            if (handled || owned || hadPrefix || resolved.prefix || this.controller.pending) {
                this.cancelCompletion();
                this.tui.requestRender();
                return;
            }
        }
        // Pi's application bindings take precedence, except Esc (the mode switch).
        if (this.onExtensionShortcut?.(data)) return;
        if (kb.matches(data, "app.clipboard.pasteImage")) {
            this.onPasteImage?.();
            return;
        }
        if (kb.matches(data, "app.exit") && !this.buffer.text) {
            this.onCtrlD?.();
            return;
        }
        if (kb.matches(data, "app.clear")) {
            this.actionHandlers.get("app.clear")?.();
            return;
        }
        if (kb.matches(data, "app.interrupt")) {
            if (this.list) {
                this.cancelCompletion();
                return;
            }
            if (this.buffer.mode !== "normal") {
                this.cancelCompletion();
                this.buffer.escape();
                this.tui.requestRender();
                return;
            }
            (this.onEscape ?? this.actionHandlers.get("app.interrupt"))?.();
            return;
        }
        if (kb.matches(data, "tui.editor.historyPrevious")) {
            this.browse(1);
            return;
        }
        if (kb.matches(data, "tui.editor.historyNext")) {
            this.browse(-1);
            return;
        }
        for (const [action, handler] of this.actionHandlers) {
            if (
                action !== "app.interrupt" && action !== "app.exit" && action !== "app.clear"
                && kb.matches(data, action)
            ) {
                handler();
                return;
            }
        }
        if (
            this.list && (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down"))
        ) {
            this.list.handleInput(data);
            this.tui.requestRender();
            return;
        }
        if (
            this.list && (kb.matches(data, "tui.input.tab") || kb.matches(data, "tui.input.submit"))
        ) {
            const slash = this.suggestions?.prefix.startsWith("/");
            const accepted = this.acceptCompletion();
            if (accepted && (!slash || kb.matches(data, "tui.input.tab"))) return;
        }
        if (this.controller.hasPending) {
            this.controller.handleKey(key);
            this.tui.requestRender();
            return;
        }
        if (kb.matches(data, "tui.input.submit")) {
            if (this.buffer.mode === "replace") {
                this.controller.handleKey("enter");
                return;
            }
            this.submit();
            return;
        }
        if (this.buffer.mode === "insert" || this.buffer.mode === "replace") {
            if (kb.matches(data, "tui.input.tab")) {
                this.requestCompletion(true);
                return;
            }
        }
        const aliases = [
            ["tui.input.newLine", "enter"],
            ["tui.editor.undo", "ctrl+z"],
            ["tui.editor.cursorUp", "up"],
            ["tui.editor.cursorDown", "down"],
            ["tui.editor.cursorLeft", "left"],
            ["tui.editor.cursorRight", "right"],
            ["tui.editor.cursorLineStart", "home"],
            ["tui.editor.cursorLineEnd", "end"],
            ["tui.editor.cursorWordLeft", "ctrl+left"],
            ["tui.editor.cursorWordRight", "ctrl+right"],
            ["tui.editor.deleteCharBackward", "backspace"],
            ["tui.editor.deleteCharForward", "delete"],
            ["tui.editor.deleteToLineStart", "ctrl+u"],
            ["tui.editor.deleteToLineEnd", "delete-line-end"],
            ["tui.editor.deleteWordBackward", "ctrl+w"],
            ["tui.editor.yank", "ctrl+r"],
        ] as const;
        const canonical = aliases.find(([action]) => kb.matches(data, action))?.[1] ?? key;
        if (canonical === "ctrl+z") {
            const inserting = this.buffer.mode === "insert" || this.buffer.mode === "replace";
            if (inserting) this.controller.handleKey("ctrl+o");
            this.controller.handleKey("u");
        } else if (kb.matches(data, "tui.editor.yank")) {
            this.controller.handleKey("ctrl+r");
            this.controller.handleKey("\"");
        } else this.controller.handleKey(canonical);
        this.tui.requestRender();
    }

    override render(width: number): string[] {
        if (width < 1) return [];
        const pad = Math.min(this.padding, Math.floor((width - 1) / 2));
        const columns = Math.max(1, width - 2 * pad - (pad ? 0 : 1));
        this.rows = sharedLayout(this.buffer, columns);
        const current = Math.max(0, this.rows.findIndex((row) => row.cursor));
        const maxRows = Math.max(5, Math.floor((this.tui.terminal.rows || 24) * 0.3));
        this.controller.options.view!.pageSize = maxRows;
        if (!this.manualViewport) {
            this.offset = Math.max(0, Math.min(this.offset, current));
            if (current >= this.offset + maxRows) this.offset = current - maxRows + 1;
        }
        this.manualViewport = false;
        const shown = this.rows.slice(this.offset, this.offset + maxRows);
        this.visibleRows = shown.length;
        const ranges = this.buffer.selections.map((s) => this.buffer.effectiveRange(s));
        const heads = new Set(
            this.buffer.selections.map((s) =>
                this.buffer.utf16ToGrapheme(this.buffer.visualHead(s))
            ),
        );
        const top = this.renderTopBorder(width, this.offset);
        // deno-lint-ignore no-control-regex -- Status must not inject terminal controls.
        const status = this.controller.status.replace(/[\x00-\x1f\x7f-\x9f]/g, "�");
        const detail = truncateToWidth(status, Math.max(0, width - 32), "");
        const modeLabel = `── ${this.buffer.mode.toUpperCase()}${detail ? ` ${detail}` : ""} ──`;
        // Preserve Pi's working indicator at the left of the top border. Short
        // border segments frame both sides of the right-aligned mode indicator.
        // At narrow widths, prioritize the complete working indicator instead.
        const result = [
            width >= visibleWidth(modeLabel) + 16
                ? truncateToWidth(top, width - visibleWidth(modeLabel), "")
                    + this.borderColor(modeLabel)
                : top,
        ];
        for (const row of shown) {
            let output = " ".repeat(pad);
            let used = 0;
            for (const item of row.cells) {
                if (item.index === this.buffer.cursor && this.focused) output += CURSOR_MARKER;
                const unit = this.buffer.graphemeToUtf16(item.index);
                const selected = this.buffer.mode !== "insert"
                    && ranges.some(([a, b]) => unit >= a && unit < b);
                const cursor = heads.has(item.index);
                const label = this.wordTargets.find((target) =>
                    item.index >= target.index
                    && item.index < target.index + target.label.length - this.wordPrefix.length
                );
                const glyph = label
                    ? truncateToWidth(
                        label.label.slice(
                            this.wordPrefix.length + item.index - label.index,
                            this.wordPrefix.length + item.index - label.index + 1,
                        ),
                        item.width,
                        "",
                    )
                        .padEnd(item.width, " ")
                    : item.text;
                output += selected || cursor || label
                    ? `\x1b[${cursor ? "7;4" : "7"}m${glyph}\x1b[0m`
                    : glyph;
                used += item.width;
            }
            const edge = row.cells.length
                ? row.cells[row.cells.length - 1]!.index + 1
                : row.start;
            if (
                heads.has(edge)
                && (row.cursor
                    || !this.rows.some((other) =>
                        other !== row
                        && (other.start === edge || other.cells.some((c) => c.index === edge))
                    ))
            ) {
                const primary = row.cursor && edge === this.buffer.cursor;
                if (primary && this.focused) output += CURSOR_MARKER;
                if (used < columns) {
                    output += "\x1b[7;4m \x1b[0m";
                    used++;
                }
            }
            result.push(output + " ".repeat(Math.max(0, width - pad - used)));
        }
        result.push(this.renderBottomBorder(width, this.rows.length - this.offset - shown.length));
        if (this.list) {
            for (const line of this.list.render(Math.max(1, width - pad * 2))) {
                const clipped = truncateToWidth(line, Math.max(1, width - pad * 2), "");
                result.push(
                    " ".repeat(pad) + clipped
                        + " ".repeat(Math.max(0, width - pad - visibleWidth(clipped))),
                );
            }
        }
        return result;
    }

    override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
        if (event.type !== "click" || event.button !== "left") return undefined;
        if (this.list && event.y >= this.visibleRows + 2) {
            const result = this.list.handleMouse?.({ ...event, y: event.y - this.visibleRows - 2 });
            if (result) return { ...result, focus: true };
        }
        const row = this.rows[this.offset + event.y - 1];
        if (!row || event.y < 1 || event.y > this.visibleRows) return undefined;
        let col = Math.min(this.padding, Math.floor((event.width - 1) / 2));
        let index = row.start;
        for (const item of row.cells) {
            if (event.x < col + item.width) {
                index = item.index;
                break;
            }
            col += item.width;
            index = item.index + 1;
        }
        this.buffer.moveTo(index);
        this.tui.requestRender();
        return { handled: true, focus: true };
    }

    private moveBoundary(
        where: "start" | "end" | "firstNonblank" | "middle",
        count: number,
    ): void {
        if (!this.rows.length) return;
        this.buffer.setSelections(
            this.buffer.selections.map((s) => {
                const head = this.buffer.utf16ToGrapheme(this.buffer.visualHead(s));
                let rowIndex = this.rows.findIndex((row) =>
                    row.cells.some((c) => c.index === head)
                );
                if (rowIndex < 0) rowIndex = this.rows.findIndex((row) => row.start === head);
                const row = this
                    .rows[Math.min(this.rows.length - 1, Math.max(0, rowIndex) + count - 1)]!;
                let index = row.start;
                if (where === "end") index = row.cells.at(-1)?.index ?? row.start;
                if (where === "firstNonblank") {
                    index = row.cells.find((c) => !/^\s+$/u.test(c.text))?.index ?? row.start;
                }
                if (where === "middle") {
                    const middle = row.cells.reduce((n, c) => n + c.width, 0) / 2;
                    let used = 0;
                    for (const cell of row.cells) {
                        index = cell.index;
                        used += cell.width;
                        if (used >= middle) break;
                    }
                }
                const unit = this.buffer.graphemeToUtf16(index);
                if (this.buffer.mode !== "select") {
                    return { ...s, start: unit, end: unit, reversed: false };
                }
                const anchor = s.reversed
                    ? this.buffer.utf16ToGrapheme(s.end) - 1
                    : this.buffer.utf16ToGrapheme(s.start);
                return {
                    ...s,
                    start: this.buffer.graphemeToUtf16(Math.min(anchor, index)),
                    end: this.buffer.graphemeToUtf16(
                        Math.min(this.buffer.length, Math.max(anchor, index) + 1),
                    ),
                    reversed: index < anchor,
                };
            }),
            this.buffer.primaryId,
        );
    }

    private moveVisual(direction: -1 | 1, count: number): void {
        if (!this.rows.length) {
            for (let i = 0; i < count; i++) this.buffer.moveVertical(direction);
            return;
        }
        this.buffer.setSelections(
            this.buffer.selections.map((s) => {
                const head = this.buffer.utf16ToGrapheme(this.buffer.visualHead(s));
                let current = this.rows.findIndex((row) => row.cells.some((c) => c.index === head));
                if (current < 0) current = this.rows.findIndex((row) => row.start === head);
                current = Math.max(0, current);
                const source = this.rows[current]!;
                const column = s.goalColumn
                    ?? source.cells.filter((c) => c.index < head).reduce((n, c) => n + c.width, 0);
                const target = this
                    .rows[
                        Math.max(0, Math.min(this.rows.length - 1, current + direction * count))
                    ]!;
                let used = 0, index = target.start;
                for (const cell of target.cells) {
                    if (used > column) break;
                    index = cell.index;
                    used += cell.width;
                }
                const unit = this.buffer.graphemeToUtf16(index);
                if (this.buffer.mode !== "select") {
                    return { ...s, start: unit, end: unit, reversed: false, goalColumn: column };
                }
                const anchor = s.reversed
                    ? this.buffer.utf16ToGrapheme(s.end) - 1
                    : this.buffer.utf16ToGrapheme(s.start);
                return {
                    ...s,
                    start: this.buffer.graphemeToUtf16(Math.min(anchor, index)),
                    end: this.buffer.graphemeToUtf16(
                        Math.min(this.buffer.length, Math.max(anchor, index) + 1),
                    ),
                    reversed: index < anchor,
                    goalColumn: column,
                };
            }),
            this.buffer.primaryId,
        );
    }

    dispose(): void {
        this.disposed = true;
        if (this.escapeTimer) clearTimeout(this.escapeTimer);
        this.controller.dispose();
        this.controller.cancelPending();
        this.cancelCompletion();
    }
}

export default function(pi: ExtensionAPI) {
    let active: HelixEditor | undefined;
    let generation = 0;
    pi.registerCommand("hem", {
        description: "Helix editor help",
        handler: (_args, ctx) => {
            ctx.ui.notify(
                "Helix prompt editor: insert/select/replace modes; counts and motions; selections and multi-cursor edits; registers, yank/paste, undo/redo; / and ? regex search; macros and repeat. Escape cancels completion, pending command, mode, then selection before interrupt. Syntax/tree-sitter, LSP, files, windows and shell commands are excluded. Some bindings remain pending: see the compatibility manifest for per-key status.",
                "info",
            );
            return Promise.resolve();
        },
    });
    pi.on("session_start", async (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        const current = ++generation;
        try {
            const { initializeRegex, findRegex } = await import("./regex.ts");
            await initializeRegex();
            if (current !== generation) return;
            ctx.ui.setEditorComponent((tui, theme, keybindings) => {
                active?.dispose();
                active = new HelixEditor(tui, theme, keybindings, findRegex);
                return active;
            });
        } catch (error) {
            if (current !== generation) return;
            active?.dispose();
            active = undefined;
            ctx.ui.setEditorComponent(undefined);
            ctx.ui.notify(`Helix editor unavailable: ${String(error)}`, "error");
        }
    });
    pi.on("session_shutdown", () => {
        generation++;
        active?.dispose();
        active = undefined;
    });
}
