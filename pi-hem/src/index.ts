import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
    type AutocompleteProvider,
    type AutocompleteSuggestions,
    CURSOR_MARKER,
    decodeKittyPrintable,
    type EditorTheme,
    matchesKey,
    SelectList,
    truncateToWidth,
    type TUI,
    type TuiMouseEvent,
    type TuiMouseEventResult,
    visibleWidth,
} from "@earendil-works/pi-tui";
import { HelixBuffer } from "./model.ts";

type Row = {
    cells: { text: string; index: number; width: number }[];
    start: number;
    cursor: boolean;
};

export class HelixEditor extends CustomEditor {
    readonly buffer = new HelixBuffer();
    private readonly editorTheme: EditorTheme;
    private readonly bindings: KeybindingsManager;
    private provider?: AutocompleteProvider;
    private suggestions?: AutocompleteSuggestions;
    private list?: SelectList;
    private pending?: AbortController;
    private timer?: ReturnType<typeof setTimeout>;
    private requestId = 0;
    private suggestionsVersion = -1;
    private bracketedPaste: string | undefined;
    private promptHistory: string[] = [];
    private promptIndex = -1;
    private promptDraft = "";
    private offset = 0;
    private rows: Row[] = [];
    private padding = 0;
    private maxSuggestions = 5;
    private visibleRows = 0;

    constructor(tui: TUI, theme: EditorTheme, bindings: KeybindingsManager) {
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
        if (!text && previous) this.buffer.reset();
        else this.buffer.setText(text);
        this.cancelCompletion();
        if (previous !== this.buffer.text) this.changed(false);
        this.tui.requestRender();
    }

    override insertTextAtCursor(text: string): void {
        if (this.buffer.mode !== "insert") this.buffer.enterInsert();
        if (this.buffer.insert(text)) this.changed();
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
        if (!provider || id !== this.requestId) return;
        const controller = new AbortController();
        this.pending = controller;
        const { line, col } = this.getCursor();
        try {
            const result = await provider.getSuggestions(this.getLines(), line, col, {
                signal: controller.signal,
                force,
            });
            if (controller.signal.aborted || id !== this.requestId) return;
            this.pending = undefined;
            if (!result?.items.length) {
                this.cancelCompletion();
                return;
            }
            const selected = this.list?.getSelectedItem();
            const selectedValue = selected
                && this.suggestions?.items[Number(selected.value)]?.value;
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
        if (this.suggestionsVersion !== this.requestId) return false;
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
        this.buffer.setText(result.lines.join("\n"));
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
        this.buffer.moveTo(index);
        this.cancelCompletion();
        if (before !== this.buffer.text) this.changed(false);
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
        this.buffer.reset();
        this.promptIndex = -1;
        this.onChange?.("");
        this.tui.requestRender();
        this.onSubmit?.(text);
    }

    private handleBracketedPaste(data: string): boolean {
        if (this.bracketedPaste === undefined && !data.includes("\x1b[200~")) return false;
        if (this.bracketedPaste === undefined) {
            const start = data.indexOf("\x1b[200~");
            this.bracketedPaste = data.slice(start + 6);
        } else this.bracketedPaste += data;
        const end = this.bracketedPaste.indexOf("\x1b[201~");
        if (end >= 0) {
            const text = this.bracketedPaste.slice(0, end);
            const rest = this.bracketedPaste.slice(end + 6);
            this.bracketedPaste = undefined;
            if (text) this.insertTextAtCursor(text);
            if (rest) this.handleInput(rest);
        }
        return true;
    }

    override handleInput(data: string): void {
        if (this.handleBracketedPaste(data)) return;
        const kb = this.bindings;
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
        if (kb.matches(data, "tui.input.submit")) {
            this.submit();
            return;
        }
        if (this.buffer.mode === "insert") {
            if (kb.matches(data, "tui.input.tab")) {
                this.requestCompletion(true);
                return;
            }
            if (kb.matches(data, "tui.input.newLine")) {
                if (this.buffer.insert("\n")) this.changed();
                return;
            }
            if (kb.matches(data, "tui.editor.undo")) {
                if (this.buffer.undo()) this.changed(false);
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
            if (kb.matches(data, "tui.editor.cursorUp")) {
                this.buffer.moveVertical(-1);
                this.requestCompletion();
                this.tui.requestRender();
                return;
            }
            if (kb.matches(data, "tui.editor.cursorDown")) {
                this.buffer.moveVertical(1);
                this.requestCompletion();
                this.tui.requestRender();
                return;
            }
            if (kb.matches(data, "tui.editor.cursorLeft")) {
                this.buffer.moveHorizontal(-1);
                this.requestCompletion();
                this.tui.requestRender();
                return;
            }
            if (kb.matches(data, "tui.editor.cursorRight")) {
                this.buffer.moveHorizontal(1);
                this.requestCompletion();
                this.tui.requestRender();
                return;
            }
            if (kb.matches(data, "tui.editor.cursorLineStart")) {
                this.buffer.moveLineEnd(true);
                this.tui.requestRender();
                return;
            }
            if (kb.matches(data, "tui.editor.cursorLineEnd")) {
                this.buffer.moveLineEnd();
                this.tui.requestRender();
                return;
            }
            if (kb.matches(data, "tui.editor.cursorWordLeft")) {
                this.buffer.moveWord("back");
                this.tui.requestRender();
                return;
            }
            if (kb.matches(data, "tui.editor.cursorWordRight")) {
                this.buffer.moveWord("next");
                this.tui.requestRender();
                return;
            }
            if (
                kb.matches(data, "tui.editor.deleteCharBackward")
                || matchesKey(data, "shift+backspace")
            ) {
                if (this.buffer.deleteAt(true)) this.changed();
                return;
            }
            if (kb.matches(data, "tui.editor.deleteCharForward")) {
                if (this.buffer.deleteAt(false)) this.changed();
                return;
            }
            if (kb.matches(data, "tui.editor.deleteToLineStart")) {
                if (this.buffer.deleteRange(this.buffer.lineRange()[0], this.buffer.cursor)) {
                    this.changed();
                }
                return;
            }
            if (kb.matches(data, "tui.editor.deleteToLineEnd")) {
                if (this.buffer.deleteRange(this.buffer.cursor, this.buffer.lineRange()[1])) {
                    this.changed();
                }
                return;
            }
            if (kb.matches(data, "tui.editor.deleteWordBackward")) {
                const end = this.buffer.cursor;
                this.buffer.moveWord("back");
                if (this.buffer.deleteRange(this.buffer.cursor, end)) this.changed();
                return;
            }
            if (kb.matches(data, "tui.editor.yank")) {
                if (this.buffer.insert(this.buffer.register)) this.changed();
                return;
            }
            const printable = decodeKittyPrintable(data)
                ?? (data.length === 1 && data.charCodeAt(0) >= 32 ? data : undefined);
            if (printable) {
                if (this.buffer.insert(printable)) this.changed();
                return;
            }
            return;
        }
        // Check Shift explicitly as Kitty terminals can report the base letter
        // rather than its uppercase printable form in CSI-u sequences.
        if (matchesKey(data, "shift+i")) {
            this.buffer.moveTo(this.buffer.lineRange()[0]);
            this.buffer.enterInsert();
            this.tui.requestRender();
            return;
        }
        if (matchesKey(data, "shift+a")) {
            this.buffer.moveTo(this.buffer.lineRange()[1]);
            this.buffer.enterInsert();
            this.tui.requestRender();
            return;
        }
        const key = decodeKittyPrintable(data) ?? data;
        switch (key) {
            case "i":
                this.buffer.enterInsert();
                break;
            case "a":
                this.buffer.enterInsert(true);
                break;
            case "v":
                this.buffer.toggleSelect();
                break;
            case "x":
                this.buffer.selectLine();
                break;
            case "h":
                this.buffer.moveHorizontal(-1);
                break;
            case "l":
                this.buffer.moveHorizontal(1);
                break;
            case "j":
                this.buffer.moveVertical(1);
                break;
            case "k":
                this.buffer.moveVertical(-1);
                break;
            case "w":
                this.buffer.moveWord("next");
                break;
            case "b":
                this.buffer.moveWord("back");
                break;
            case "e":
                this.buffer.moveWord("end");
                break;
            case "0":
                this.buffer.moveLineEnd(true);
                break;
            case "$":
                this.buffer.moveLineEnd();
                break;
            case "d":
                if (this.buffer.deleteSelection()) this.changed(false);
                break;
            case "c":
                if (this.buffer.deleteSelection(true)) this.changed(false);
                break;
            case "y":
                this.buffer.yank();
                break;
            case "p":
                if (this.buffer.paste()) this.changed(false);
                break;
            case "u":
                if (this.buffer.undo()) this.changed(false);
                break;
            default:
                if (kb.matches(data, "tui.editor.cursorLeft")) this.buffer.moveHorizontal(-1);
                else if (kb.matches(data, "tui.editor.cursorRight")) this.buffer.moveHorizontal(1);
                else if (kb.matches(data, "tui.editor.cursorUp")) this.buffer.moveVertical(-1);
                else if (kb.matches(data, "tui.editor.cursorDown")) this.buffer.moveVertical(1);
                else if (kb.matches(data, "tui.editor.undo") && this.buffer.undo()) {
                    this.changed(false);
                }
                break;
        }
        this.tui.requestRender();
    }

    private layout(columns: number): Row[] {
        const rows: Row[] = [];
        const cells = this.buffer.cells;

        const isSpace = (cell: string) => /^\s+$/u.test(cell);

        const display = (index: number) => {
            const text = cells[index]!;
            // A cluster wider than the whole editor cannot be drawn without clipping.
            return visibleWidth(text) > columns ? "?" : text;
        };

        let lineStart = 0;
        for (let lineEnd = 0; lineEnd <= cells.length; lineEnd++) {
            if (lineEnd < cells.length && cells[lineEnd] !== "\n") continue;
            if (lineStart === lineEnd) {
                rows.push({
                    cells: [],
                    start: lineStart,
                    cursor: this.buffer.cursor === lineStart,
                });
            }
            let start = lineStart;
            while (start < lineEnd) {
                let end = start;
                let used = 0;
                let breakAfterSpace = -1;
                while (end < lineEnd) {
                    const width = Math.max(1, visibleWidth(display(end)));
                    if (end > start && used + width > columns) break;
                    used += width;
                    end++;
                    // Keep whitespace on the preceding visual line. Break before the
                    // next word instead of splitting that word across the right edge.
                    if (isSpace(cells[end - 1]!) && end < lineEnd && !isSpace(cells[end]!)) {
                        breakAfterSpace = end;
                    }
                }
                if (end < lineEnd && breakAfterSpace > start) end = breakAfterSpace;
                const rowCells = Array.from({ length: end - start }, (_, offset) => {
                    const index = start + offset;
                    const text = display(index);
                    return { text, index, width: Math.max(1, visibleWidth(text)) };
                });
                rows.push({
                    cells: rowCells,
                    start,
                    cursor: this.buffer.cursor >= start && this.buffer.cursor < end,
                });
                start = end;
            }
            if (this.buffer.cursor === lineEnd && lineStart < lineEnd) {
                const last = rows[rows.length - 1]!;
                const used = last.cells.reduce((total, cell) => total + cell.width, 0);
                if (used >= columns) rows.push({ cells: [], start: lineEnd, cursor: true });
                else last.cursor = true;
            }
            lineStart = lineEnd + 1;
        }
        return rows;
    }

    override render(width: number): string[] {
        if (width < 1) return [];
        const pad = Math.min(this.padding, Math.floor((width - 1) / 2));
        const columns = Math.max(1, width - 2 * pad - (pad ? 0 : 1));
        this.rows = this.layout(columns);
        const current = Math.max(0, this.rows.findIndex((row) => row.cursor));
        const maxRows = Math.max(5, Math.floor((this.tui.terminal.rows || 24) * 0.3));
        this.offset = Math.max(0, Math.min(this.offset, current));
        if (current >= this.offset + maxRows) this.offset = current - maxRows + 1;
        const shown = this.rows.slice(this.offset, this.offset + maxRows);
        this.visibleRows = shown.length;
        const [a, b] = this.buffer.selection;
        const top = this.renderTopBorder(width, this.offset);
        const modeLabel = `── ${this.buffer.mode.toUpperCase()} ──`;
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
                const selected = this.buffer.mode !== "insert" && item.index >= a && item.index < b;
                const cursor = item.index === this.buffer.cursor;
                output += selected || cursor
                    ? `\x1b[${cursor ? "7;4" : "7"}m${item.text}\x1b[0m`
                    : item.text;
                used += item.width;
            }
            if (row.cursor && !row.cells.some((item) => item.index === this.buffer.cursor)) {
                if (used >= columns) { // There is no room for a cursor at the right edge.
                    output += this.focused ? CURSOR_MARKER : "";
                } else {
                    output += (this.focused ? CURSOR_MARKER : "") + "\x1b[7m \x1b[0m";
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

    dispose(): void {
        this.cancelCompletion();
    }
}

export default function(pi: ExtensionAPI) {
    let active: HelixEditor | undefined;
    pi.on("session_start", (_event, ctx) => {
        if (ctx.mode !== "tui") return;
        try {
            ctx.ui.setEditorComponent((tui, theme, keybindings) => {
                active?.dispose();
                active = new HelixEditor(tui, theme, keybindings);
                return active;
            });
        } catch (error) {
            active?.dispose();
            active = undefined;
            ctx.ui.setEditorComponent(undefined);
            ctx.ui.notify(`Helix editor unavailable: ${String(error)}`, "error");
        }
    });
    pi.on("session_shutdown", () => {
        active?.dispose();
        active = undefined;
    });
}
