import { graphemes, HelixBuffer, type Selection } from "./model.ts";
import { handleInsertCommand, insertText } from "./insert.ts";
import { extraTextAction, type TextActionView } from "./text-actions.ts";
import type { ClipboardKind, TextClipboard } from "./clipboard.ts";
import { RegisterBank, type RegisterValue } from "./registers.ts";
export { RegisterBank, type RegisterOperation, type RegisterValue } from "./registers.ts";

export interface CommandView extends TextActionView {
    boundary?(position: "start" | "end" | "firstNonblank" | "middle", count: number): void;
    moveVisual?(direction: -1 | 1, count: number): void;
    viewport?(position: "top" | "middle" | "bottom"): void;
    wordLabels?(): void;
    page?(direction: -1 | 1, count: number, half: boolean): void;
}
export interface CommandOptions {
    view?: CommandView;
    feedback?(message: string): void;
    requestRender?(): void;
    requestCompletion?(): void;
    changed?(): void;
    matcher?(text: string, pattern: string): { start: number; end: number }[];
    clipboard?: TextClipboard;
}
type CompletionEdit = {
    relativeStart: number;
    relativeEnd: number;
    text: string;
    cursorDelta: number;
};
type RecordedCommand = string | { insertion: string } | CompletionEdit | {
    value: RegisterValue;
    before: boolean;
    count: number;
};
/** Host-independent text commands. Unknown keys return false, including host actions. */
export class CommandController {
    pending = "";
    status = "";
    search: { pattern: string; backward: boolean } | null = null;
    get hasPending(): boolean {
        return !!(this.count || this.rejectedCount || this.pending || this.search);
    }
    private temporaryNormal = false;
    private changeTransaction = false;
    private visualSnapshot: Selection[] = [];
    private visualPrimary = "";
    private lastFind: { command: string; key: string; count: number } | null = null;
    private marks = new Map<string, Selection[]>();
    private jumps: Selection[][] = [];
    private jumpIndex = -1;
    private changes: Selection[][] = [];
    private changeIndex = -1;
    private rectangle: number | null = null;
    private saved: Selection[] = [];
    private savedPrimary = "";
    private count = "";
    private register = "\"";
    private registers = new RegisterBank();
    private disposed = false;
    dispose(): void {
        this.closeChangeTransaction();
        this.disposed = true;
        this.pending = "";
        this.search = null;
        this.transaction = [];
    }
    private macros = new Map<string, RecordedCommand[]>();
    private recording: string | null = null;
    private lastMacro = "\"";
    private regexPrompt = false;
    private rejectedCount = false;
    private recorded: RecordedCommand[] = [];
    private replayDepth = 0;
    private budget = 10000;
    private lastChange: RecordedCommand[] = [];
    private transaction: RecordedCommand[] = [];
    private searchPattern = "";
    readonly buffer: HelixBuffer;
    readonly options: CommandOptions;
    constructor(buffer: HelixBuffer, options: CommandOptions = {}) {
        this.buffer = buffer;
        this.options = options;
    }
    private closeChangeTransaction(): void {
        if (this.changeTransaction) this.buffer.endTransaction();
        this.changeTransaction = false;
    }
    /** Record literal host paste text, never input keys. */
    recordInsertion(text: string): void {
        if (this.disposed || this.replayDepth || !text) return;
        const command = { insertion: text };
        if (this.recording) this.recorded.push(command);
        this.transaction.push(command);
        this.lastChange = [...this.transaction];
    }
    recordCompletion(
        relativeStart: number,
        relativeEnd: number,
        text: string,
        cursorDelta: number,
    ): void {
        if (this.disposed || this.replayDepth) return;
        const command = { relativeStart, relativeEnd, text, cursorDelta };
        if (this.recording) this.recorded.push(command);
        this.transaction.push(command);
        this.lastChange = [...this.transaction];
    }
    private replayCompletion(command: CompletionEdit): boolean {
        const b = this.buffer, before = b.text;
        const boundaries = (text: string) => {
            const result = new Set([0]);
            let offset = 0;
            for (const cell of graphemes(text)) result.add(offset += cell.length);
            return result;
        };
        const valid = boundaries(before);
        const selections = b.selections.map((s) => ({ ...s }));
        const edits = selections.map((s) => {
            const head = b.visualHead(s);
            return {
                start: head + command.relativeStart,
                end: head + command.relativeEnd,
                text: command.text,
            };
        });
        const sorted = [...edits].sort((a, z) => a.start - z.start);
        if (
            edits.some((e) => !valid.has(e.start) || !valid.has(e.end) || e.start > e.end)
            || sorted.some((e, i) => i > 0 && e.start < sorted[i - 1]!.end)
        ) {
            this.tell("Completion replay range is invalid");
            return false;
        }
        let after = before;
        for (const e of [...sorted].reverse()) {
            after = after.slice(0, e.start) + e.text + after.slice(e.end);
        }
        const targets = edits.map((e) =>
            e.start + command.cursorDelta
            + edits.filter((other) => other.start < e.start).reduce(
                (n, other) => n + other.text.length - (other.end - other.start),
                0,
            )
        );
        const afterBoundaries = boundaries(after);
        if (targets.some((p) => !afterBoundaries.has(p))) {
            this.tell("Completion replay cursor is invalid");
            return false;
        }
        const changed = b.replaceRanges(edits);
        b.setSelections(
            selections.map((s, i) => ({
                ...s,
                start: targets[i]!,
                end: targets[i]!,
                reversed: false,
            })),
            b.primaryId,
        );
        return changed;
    }
    cancelPending(): boolean {
        this.closeChangeTransaction();
        const active = !!(this.pending || this.count || this.search || this.rejectedCount);
        if (this.search) this.buffer.setSelections(this.saved, this.savedPrimary);
        this.pending = "";
        this.count = "";
        this.search = null;
        this.status = "";
        this.regexPrompt = false;
        this.rejectedCount = false;
        this.options.requestRender?.();
        return active;
    }
    private tell(message: string): void {
        this.status = message;
        this.options.feedback?.(message);
    }
    private ranges() {
        return this.buffer.selections.map((s) => this.buffer.effectiveRange(s));
    }
    private transform(fn: (text: string) => string): void {
        this.buffer.replaceRanges(
            this.ranges().map(([start, end]) => ({
                start,
                end,
                text: fn(this.buffer.text.slice(start, end)),
            })),
        );
    }
    private replay(keys: RecordedCommand[], count: number): void {
        if (this.disposed) return;
        if (this.replayDepth >= 20) {
            this.tell("Replay depth limit reached");
            return;
        }
        if (!this.replayDepth) this.budget = 10000;
        if (!Number.isSafeInteger(count) || count < 1 || keys.length * count > this.budget) {
            this.tell("Replay key limit reached");
            return;
        }
        this.replayDepth++;
        try {
            for (let i = 0; i < count; i++) {
                for (const key of [...keys]) {
                    if (--this.budget < 0) {
                        this.tell("Replay key limit reached");
                        return;
                    }
                    if (typeof key === "string") this.handleKey(key);
                    else if ("relativeStart" in key) {
                        if (this.replayCompletion(key)) this.options.changed?.();
                    } else if ("value" in key) {
                        this.pasteValue(key.value, key.before, key.count);
                        this.options.changed?.();
                    } else {
                        const b = this.buffer;
                        const changed = b.mode === "insert" || b.mode === "replace"
                            ? insertText(b, key.insertion)
                            : b.replaceRanges(
                                b.selections.map((s) => ({
                                    start: s.start,
                                    end: s.start,
                                    text: key.insertion,
                                })),
                            );
                        if (changed) this.options.changed?.();
                    }
                }
            }
        } finally {
            this.replayDepth--;
        }
    }
    /** Explicit clipboard operations never delete text before a successful write. */
    async clipboard(
        action: "copy" | "cut" | "paste",
        kind: ClipboardKind = "clipboard",
        placement?: "p" | "P",
        count = 1,
        change = false,
    ): Promise<boolean> {
        if (this.disposed || this.replayDepth) return false;
        const clip = this.options.clipboard, b = this.buffer;
        if (!clip) {
            this.tell("Clipboard unavailable");
            return false;
        }
        const revision = b.revision,
            primary = b.primaryId,
            selections = JSON.stringify(b.selections),
            ranges = this.ranges();
        try {
            if (action === "paste") {
                const text = await clip.read(kind);
                if (
                    this.disposed || primary !== b.primaryId || revision !== b.revision
                    || selections !== JSON.stringify(b.selections)
                ) return false;
                if (placement) {
                    const command = {
                        value: { fragments: [text], linewise: false },
                        before: placement === "P",
                        count,
                    };
                    this.pasteValue(command.value, command.before, count);
                    if (this.recording) this.recorded.push(command);
                    this.lastChange = [command];
                } else b.replaceRanges(ranges.map(([start, end]) => ({ start, end, text })));
            } else {
                await clip.write(ranges.map(([a, z]) => b.text.slice(a, z)).join("\n"), kind);
                if (
                    this.disposed || primary !== b.primaryId || revision !== b.revision
                    || selections !== JSON.stringify(b.selections)
                ) return false;
                if (action === "cut") {
                    b.replaceRanges(ranges.map(([start, end]) => ({ start, end, text: "" })));
                    if (change) b.enterInsert();
                }
            }
            this.options.changed?.();
            this.options.requestRender?.();
            return true;
        } catch (error) {
            if (!this.disposed) this.tell(`Clipboard failed: ${String(error)}`);
            return false;
        }
    }
    private async insertClipboard(kind: ClipboardKind): Promise<void> {
        if (this.replayDepth || !this.options.clipboard) return;
        const b = this.buffer, revision = b.revision, selections = JSON.stringify(b.selections);
        try {
            const text = await this.options.clipboard.read(kind);
            if (
                !this.disposed && b.revision === revision
                && JSON.stringify(b.selections) === selections
                && (b.mode === "insert" || b.mode === "replace")
            ) {
                insertText(b, text);
                this.recordInsertion(text);
                this.options.changed?.();
                this.options.requestRender?.();
            }
        } catch (error) {
            this.tell(`Clipboard failed: ${String(error)}`);
        }
    }
    private capture(): RegisterValue {
        const fragments = this.ranges().map(([a, z]) => this.buffer.text.slice(a, z));
        const linewise = this.ranges().every(([a, z]) =>
            (a === 0 || this.buffer.text[a - 1] === "\n")
            && (z === this.buffer.text.length || this.buffer.text[z - 1] === "\n")
        );
        return { fragments, linewise };
    }
    private pasteValue(value: RegisterValue, before: boolean, count: number): void {
        const b = this.buffer;
        if (!value.fragments.length) return;
        b.replaceRanges(b.selections.map((s, i) => {
            let p = before ? s.start : b.effectiveRange(s)[1];
            let text = value.fragments[Math.min(i, value.fragments.length - 1)]!;
            if (value.linewise) {
                const [start, end] = b.lineRange(b.utf16ToGrapheme(b.visualHead(s)));
                p = b.graphemeToUtf16(before ? start : Math.min(b.length, end + 1));
                text = (text.endsWith("\n") ? text : text + "\n").repeat(count);
                if (!before && p === b.text.length && p > 0 && b.text[p - 1] !== "\n") {
                    text = "\n" + text.slice(0, -1);
                }
            } else text = text.repeat(count);
            return { start: p, end: p, text };
        }));
    }
    private matches(pattern: string) {
        if (!this.options.matcher) {
            this.tell("Regex matcher unavailable");
            return null;
        }
        try {
            return this.options.matcher(this.buffer.text, pattern);
        } catch (error) {
            this.tell(`Regex: ${String(error)}`);
            return null;
        }
    }
    private findSearch(pattern: string, backward: boolean): void {
        const matches = this.matches(pattern);
        if (!matches?.length) return;
        const primary = this.buffer.primaryId;
        this.buffer.setSelections(
            this.buffer.selections.map((selection) => {
                const match = backward
                    ? [...matches].reverse().find((m) =>
                        m.end <= selection.start
                        && m.start < selection.start
                    ) ?? matches.at(-1)!
                    : matches.find((m) =>
                        m.start >= selection.end
                        && m.start > selection.start
                    ) ?? matches[0]!;
                return { ...selection, ...match, reversed: backward };
            }),
            primary,
        );
    }
    handleKey(key: string): boolean {
        if (this.disposed) return false;
        const b = this.buffer, revision = b.revision;
        const restoreInsert = this.temporaryNormal;
        if (b.mode === "select") {
            this.visualSnapshot = b.selections.map((s) => ({ ...s }));
            this.visualPrimary = b.primaryId;
        }
        const sequence = [...this.transaction, key];
        if (this.recording && !this.replayDepth && !(key === "Q" && !this.pending)) {
            this.recorded.push(key);
        }
        let handled = true;
        try {
            handled = this.dispatch(key);
        } catch (error) {
            this.tell(String(error));
            this.pending = "";
        }
        if (restoreInsert && !this.hasPending) {
            b.enterInsert();
            this.temporaryNormal = false;
        }
        if (
            this.changeTransaction && b.mode !== "insert" && b.mode !== "replace"
            && !this.temporaryNormal
        ) {
            b.endTransaction();
            this.changeTransaction = false;
        }
        if (!this.replayDepth) {
            if (
                handled && !["u", "U", "ctrl+r", ".", "q", "@"].includes(key)
                && (b.revision !== revision
                    || ((key === "escape" || key === "esc") && this.transaction.length
                        && !this.pending))
            ) this.lastChange = sequence;
            if (
                handled
                && (this.pending || this.count || b.mode === "insert" || b.mode === "replace")
            ) this.transaction = sequence;
            else this.transaction = [];
        }
        if (b.revision !== revision) {
            this.changes.push(b.selections.map((s) => ({ ...s })));
            this.changeIndex = this.changes.length;
            this.options.changed?.();
        }
        if (
            this.rectangle !== null
            && ["h", "j", "k", "l", "left", "right", "up", "down"].includes(key)
        ) this.rectangularize();
        if (this.recording) this.status = `recording @${this.recording}`;
        if (handled) this.options.requestRender?.();
        return handled;
    }
    private extra(sequence: string[], count: number): boolean | undefined {
        const viewport = sequence[0] === "z"
            || ["M", "ctrl+e", "ctrl+y", "pageup", "pagedown"].includes(sequence[0]!);
        if (this.replayDepth && viewport) return true;
        const result = extraTextAction(this.buffer, sequence, {
            count,
            view: this.replayDepth ? undefined : this.options.view,
        });
        if (result.unsupported) {
            this.tell(result.unsupported);
            return false;
        }
        if (!result.handled) return undefined;
        if (result.intent) {
            for (let i = 0; i < count; i++) this.findSearch(this.searchPattern, true);
        }
        return true;
    }
    private dispatch(key: string): boolean {
        const b = this.buffer;
        // Replays are text-only: never dispatch viewport, labels, paging or history effects.
        if (
            this.replayDepth
            && ["u", "U", "ctrl+r", "ctrl+f", "ctrl+b", "ctrl+d", "ctrl+u"].includes(key)
        ) return true;
        if (this.replayDepth && this.pending === "g" && ["t", "c", "b", "w"].includes(key)) {
            this.pending = "";
            return true;
        }
        if (key === "escape" || key === "esc" || key === "ctrl+[") {
            if (!this.cancelPending()) b.escape();
            return true;
        }
        if (this.search) {
            if (key === "space") key = " ";
            if (key === "enter") {
                if (!this.matches(this.search.pattern)) return true;
                if (this.regexPrompt) {
                    b.setSelections(this.saved, this.savedPrimary);
                    if (!this.selectRegex(this.search.pattern)) return true;
                } else this.searchPattern = this.search.pattern;
                this.search = null;
                this.regexPrompt = false;
                this.status = "";
                return true;
            }
            if (key === "backspace") {
                this.search.pattern = graphemes(this.search.pattern).slice(0, -1).join("");
            } else if (graphemes(key).length === 1) this.search.pattern += key;
            else return false;
            b.setSelections(this.saved, this.savedPrimary);
            this.findSearch(this.search.pattern, this.search.backward);
            this.status = `${this.search.backward ? "?" : "/"}${this.search.pattern}`;
            return true;
        }
        if (this.pending) {
            const pending = this.pending;
            this.pending = "";
            if (pending === "\"") {
                if (graphemes(key).length !== 1) return false;
                this.register = key;
                return true;
            }
            if (pending === "@") {
                if (graphemes(key).length !== 1) return false;
                this.replay(this.macros.get(key) ?? [], Number(this.count) || 1);
                this.count = "";
                return true;
            }
            if (pending === "register") {
                if (graphemes(key).length !== 1) return false;
                if (key === "+" || key === "*") {
                    void this.insertClipboard(key === "*" ? "primary" : "clipboard");
                } else {
                    const value = this.registers.read(key);
                    const fragments = value?.fragments ?? [b.register];
                    b.replaceRanges(
                        b.selections.map((s, i) => ({
                            start: s.start,
                            end: s.start,
                            text: fragments[Math.min(i, fragments.length - 1)] ?? "",
                        })),
                    );
                }
                return true;
            }
            if (pending === "literal") {
                insertText(
                    b,
                    key === "enter"
                        ? "\n"
                        : key === "tab"
                        ? "\t"
                        : key === "space"
                        ? " "
                        : /^ctrl\+[a-z]$/.test(key)
                        ? String.fromCodePoint(key.charCodeAt(5) - 96)
                        : key,
                );
                return true;
            }
            if (pending === "digraph") {
                if (key === "space") key = " ";
                if (graphemes(key).length !== 1) return false;
                this.pending = `digraph:${key}`;
                return true;
            }
            if (pending.startsWith("digraph:")) {
                if (key === "space") key = " ";
                if (graphemes(key).length !== 1) return false;
                const pair = pending.slice(8) + key;
                const table: Record<string, string> = {
                    "ae": "æ",
                    "AE": "Æ",
                    "oe": "œ",
                    "ss": "ß",
                    "<<": "«",
                    ">>": "»",
                    "o/": "ø",
                    "a:": "ä",
                    "o:": "ö",
                    "u:": "ü",
                    "e'": "é",
                };
                for (
                    const [suffix, mark] of Object.entries({
                        "'": "\u0301",
                        "`": "\u0300",
                        "^": "\u0302",
                        "~": "\u0303",
                        ":": "\u0308",
                        "-": "\u0304",
                        "u": "\u0306",
                        "o": "\u030a",
                        ",": "\u0327",
                        "v": "\u030c",
                    })
                ) {
                    for (const letter of "aAeEiIoOuUyYcCnNsSzZ") {
                        const composed = (letter + mark).normalize("NFC");
                        if (graphemes(composed).length === 1 && composed.length === 1) {
                            table[letter + suffix] = composed;
                        }
                    }
                }
                Object.assign(table, {
                    "OE": "Œ",
                    "O/": "Ø",
                    "!!": "¡",
                    "??": "¿",
                    "c/": "¢",
                    "Pd": "£",
                    "Ye": "¥",
                    "Eu": "€",
                    "Co": "©",
                    "Rg": "®",
                    "DG": "°",
                    "+-": "±",
                    "xx": "×",
                    "-:": "÷",
                    "12": "½",
                    "14": "¼",
                    "34": "¾",
                    "->": "→",
                    "<-": "←",
                    "==": "≡",
                    "!=": "≠",
                    "=<": "≤",
                    ">=": "≥",
                    "PI": "Π",
                    "pi": "π",
                    "a*": "α",
                    "b*": "β",
                    "g*": "γ",
                    "d*": "δ",
                    "l*": "λ",
                    "s*": "σ",
                    "w*": "ω",
                });
                if (table[pair]) insertText(b, table[pair]);
                else this.tell(`Unknown digraph: ${pair}`);
                return true;
            }
            const n = Number(this.count) || 1;
            this.count = "";
            if (pending === "space") {
                if (key === "h") {
                    this.occurrences("all");
                    return true;
                }
                return false;
            }
            if (pending === "mark") {
                this.marks.set(key, b.selections.map((s) => ({ ...s })));
                return true;
            }
            if (pending === "'") {
                const mark = this.marks.get(key);
                if (mark) {
                    this.pushJump();
                    b.setSelections(mark);
                }
                return true;
            }
            if (pending === "[" || pending === "]") {
                this.nextObject(key, pending === "]", n);
                return true;
            }
            if (pending === "surround-delete" || pending === "surround-replace") {
                this.surround(key, pending === "surround-delete");
                return true;
            }
            if (pending.startsWith("surround-new:")) {
                this.surround(pending.slice(13), false, key);
                return true;
            }
            if (pending === "r") {
                if (key === "space") key = " ";
                if (graphemes(key).length !== 1) return false;
                b.replaceSelection(key.repeat(n));
                return true;
            }
            if (["f", "t", "F", "T"].includes(pending)) {
                if (key === "space") key = " ";
                if (graphemes(key).length !== 1) return false;
                this.lastFind = { command: pending, key, count: n };
                const backward = pending === pending.toUpperCase();
                b.setSelections(b.selections.map((s) => {
                    let index = b.utf16ToGrapheme(b.visualHead(s));
                    for (let i = 0; i < n; i++) {
                        let next = index + (backward ? -1 : 1);
                        while (next >= 0 && next < b.length && b.cells[next] !== key) {
                            next += backward ? -1 : 1;
                        }
                        if (next < 0 || next >= b.length) return s;
                        index = next;
                    }
                    if (pending.toLowerCase() === "t") index += backward ? 1 : -1;
                    const p = b.graphemeToUtf16(index),
                        anchor = b.mode === "select"
                            ? (s.reversed ? b.visualHead({ ...s, reversed: false }) : s.start)
                            : b.visualHead(s);
                    return {
                        ...s,
                        start: Math.min(anchor, p),
                        end: b.graphemeToUtf16(b.utf16ToGrapheme(Math.max(anchor, p)) + 1),
                        reversed: p < anchor,
                    };
                }));
                return true;
            }
            if (pending === "z") return this.extra(["z", key], n) ?? true;
            if (pending === "insert-ctrl-x") {
                if (key === "ctrl+z") return true;
                if (key === "ctrl+o") {
                    if (this.replayDepth) return true;
                    if (!this.options.requestCompletion) {
                        this.tell("Completion callback unavailable");
                        return false;
                    }
                    this.options.requestCompletion();
                    return true;
                }
                if (key === "ctrl+e" || key === "ctrl+y") {
                    if (!this.replayDepth) this.options.view?.scroll?.(key === "ctrl+e" ? n : -n);
                    return !!this.options.view?.scroll;
                }
                this.tell("Unsupported insert completion prefix");
                return false;
            }
            if (pending === "g") {
                const extra = this.extra(["g", key], n);
                if (extra !== undefined) return extra;
                if (key === ".") {
                    const last = this.changes.at(-1);
                    if (last) {
                        b.setSelections(
                            last.map((s) => ({
                                ...s,
                                start: b.graphemeToUtf16(
                                    b.utf16ToGrapheme(Math.min(s.start, b.text.length)),
                                ),
                                end: b.graphemeToUtf16(
                                    b.utf16ToGrapheme(Math.min(s.end, b.text.length)),
                                ),
                            })),
                        );
                    }
                    return true;
                }
                if (key === "*" || key === "#") {
                    const [a, z] = b.effectiveRange();
                    this.searchPattern = b.text.slice(a, z).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    for (let i = 0; i < n; i++) this.findSearch(this.searchPattern, key === "#");
                    return true;
                }
                if (key === "g") {
                    const lines = b.text.split("\n");
                    const row = Math.min(n, lines.length) - 1;
                    b.moveTo(
                        b.utf16ToGrapheme(
                            lines.slice(0, row).reduce((p, line) => p + line.length + 1, 0),
                        ),
                    );
                } else if (key === "e") b.moveTo(b.utf16ToGrapheme(b.text.lastIndexOf("\n") + 1));
                else if (["0", "home", "$", "end", "^", "_", "M"].includes(key)) {
                    if (!this.replayDepth) {
                        this.options.view?.boundary?.(
                            key === "0" || key === "home"
                                ? "start"
                                : key === "$" || key === "end"
                                ? "end"
                                : key === "M"
                                ? "middle"
                                : "firstNonblank",
                            n,
                        );
                    }
                } else if (key === "v") {
                    if (this.visualSnapshot.length) {
                        b.setSelections(this.visualSnapshot, this.visualPrimary);
                        b.mode = "select";
                    }
                } else if (key === "E") {
                    for (let i = 0; i < n; i++) {
                        const ends = [...b.text.matchAll(/\S+/gu)].map((m) =>
                            m.index + m[0].length - 1
                        );
                        const target = ends.filter((p) => p < b.visualHead()).at(-1);
                        if (target !== undefined) b.moveTo(b.utf16ToGrapheme(target));
                    }
                } else if (key === "h") b.moveLineEnd(true);
                else if (["l", "$", "end"].includes(key)) b.moveLineEnd();
                else if (["s", "^", "_"].includes(key)) {
                    b.moveLineEnd(true);
                    while (b.cells[b.cursor] === " " || b.cells[b.cursor] === "\t") {
                        b.moveHorizontal(1);
                    }
                } else if (key === "t" || key === "c" || key === "b") {
                    if (!this.options.view?.viewport) return false;
                    this.options.view.viewport(
                        key === "t" ? "top" : key === "c" ? "middle" : "bottom",
                    );
                } else if (
                    key === "a" || key === "L" || key === ">" || key === "<"
                ) {
                    this.occurrences(
                        key === "a"
                            ? "all"
                            : key === ">"
                            ? "next"
                            : key === "<"
                            ? "previous"
                            : "previous",
                        key === ">" || key === "<",
                    );
                } else if (key === ";" || key === ",") {
                    this.history(this.changes, key === ";" ? -1 : 1, true);
                } else if (key === "w") {
                    if (!this.options.view?.wordLabels) return false;
                    this.options.view.wordLabels();
                } else if (["j", "k", "down", "up"].includes(key)) {
                    const direction = key === "j" || key === "down" ? 1 : -1;
                    if (b.mode === "select" && !this.replayDepth && this.options.view?.moveVisual) {
                        this.options.view.moveVisual(direction, n);
                    } else for (let i = 0; i < n; i++) b.moveVertical(direction);
                } else return true;
                return true;
            }
            if (pending === "m") {
                if (key === "m") this.matchBracket();
                else if (key === "i" || key === "a") this.pending = `object:${key}`;
                else if (key === "s") this.pending = "surround";
                else if (key === "d" || key === "r") {
                    this.pending = key === "d"
                        ? "surround-delete"
                        : "surround-replace";
                } else return false;
                return true;
            }
            if (pending === "surround") {
                const close: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };
                this.transform((t) => key + t + (close[key] ?? key));
                return true;
            }
            if (pending.startsWith("object:")) {
                const extra = this.extra(["m", pending.endsWith("a") ? "a" : "i", key], n);
                if (extra !== undefined) return extra;
                this.object(key, pending.endsWith("a"));
                return true;
            }
            return false;
        }
        if (b.mode === "insert" || b.mode === "replace") {
            if (key === "ctrl+x") {
                this.pending = "insert-ctrl-x";
                return true;
            }
            const result = handleInsertCommand(b, key);
            if (result.pending) this.pending = result.pending;
            if (result.temporaryNormal) this.temporaryNormal = true;
            if (result.handled) return true;
            if (key === "space" || graphemes(key).length === 1) {
                return insertText(b, key === "space" ? " " : key);
            }
            return false;
        }
        if (key === "0" && !this.count) {
            b.moveLineEnd(true);
            return true;
        }
        if (/^[0-9]$/.test(key)) {
            if (Number(this.count + key) > 9999) {
                this.count = "";
                this.rejectedCount = true;
                this.tell("Count exceeds 9999");
            } else if (!this.rejectedCount) {
                this.count += key;
                this.status = this.count;
            }
            return true;
        }
        if (this.rejectedCount) {
            this.rejectedCount = false;
            this.tell("Count rejected");
            return true;
        }
        if (key === "insert") {
            b.enterInsert();
            return true;
        }
        if (!["ctrl+f", "ctrl+b"].includes(key)) {
            const extra = this.extra([key], Number(this.count) || 1);
            if (extra !== undefined) {
                this.count = "";
                return extra;
            }
        }
        if (["z", "g", "m", "f", "t", "F", "T", "r", "\"", "[", "]", "'", "space"].includes(key)) {
            this.pending = key;
            return true;
        }
        if (key === "Q") {
            if (this.recording) {
                this.macros.set(this.recording, this.recorded.slice(0, 10000));
                this.lastMacro = this.recording;
                this.recording = null;
                this.status = "";
            } else {
                this.recording = this.register;
                this.recorded = [];
                this.status = `recording @${this.recording}`;
            }
            return true;
        }
        if (key === "@") {
            this.pending = "@";
            return true;
        }
        if (key === "q") {
            const n = Number(this.count) || 1;
            this.count = "";
            this.replay(this.macros.get(this.lastMacro) ?? [], n);
            return true;
        }
        const n = Number(this.count) || 1, hadCount = !!this.count;
        this.count = "";
        this.status = "";
        const repeat = (fn: () => void) => {
            for (let i = 0; i < n; i++) fn();
        };
        switch (key) {
            case "alt+.":
                if (this.lastFind) {
                    const find = this.lastFind;
                    this.pending = find.command;
                    this.count = String(hadCount ? n : find.count);
                    return this.dispatch(find.key);
                }
                break;
            case "h":
            case "left":
            case "backspace":
                repeat(() => b.moveHorizontal(-1));
                break;
            case "l":
            case "right":
            case "space":
                repeat(() => b.moveHorizontal(1));
                break;
            case "j":
            case "down":
            case "ctrl+j":
                if (b.mode === "normal" && !this.replayDepth && this.options.view?.moveVisual) {
                    this.options.view.moveVisual(1, n);
                } else repeat(() => b.moveVertical(1));
                break;
            case "k":
            case "up":
                if (b.mode === "normal" && !this.replayDepth && this.options.view?.moveVisual) {
                    this.options.view.moveVisual(-1, n);
                } else repeat(() => b.moveVertical(-1));
                break;
            case "ctrl+f":
            case "ctrl+b":
            case "ctrl+d":
            case "ctrl+u":
                if (!this.options.view?.page) return false;
                this.options.view.page(
                    key === "ctrl+f" || key === "ctrl+d" ? 1 : -1,
                    n,
                    key === "ctrl+d" || key === "ctrl+u",
                );
                break;
            case "{":
            case "}":
            case "(":
            case ")": {
                const paragraph = key === "{" || key === "}", backward = key === "{" || key === "(";
                const boundaries = paragraph
                    ? [
                        0,
                        ...[...b.text.matchAll(/\n[ \t]*\n+/g)].map((m) => m.index + m[0].length),
                        b.text.length,
                    ]
                    : [
                        0,
                        ...[...b.text.matchAll(/[.!?][\"')\]]*\s+/g)].map((m) =>
                            m.index + m[0].length
                        ),
                        b.text.length,
                    ];
                repeat(() => {
                    const p = b.visualHead();
                    const target = backward
                        ? [...boundaries].reverse().find((x) => x < p)
                        : boundaries.find((x) => x > p);
                    if (target !== undefined) b.moveTo(b.utf16ToGrapheme(target));
                });
                break;
            }
            case "w":
            case "b":
            case "e":
                repeat(() => b.moveWord(key === "w" ? "next" : key === "b" ? "back" : "end"));
                break;
            case "W":
            case "B":
            case "E":
                repeat(() => this.bigWord(key));
                break;
            case "G":
                if (hadCount) {
                    const lines = b.text.split("\n");
                    b.moveTo(
                        b.utf16ToGrapheme(
                            lines.slice(0, n - 1).join("\n").length
                                + (n > 1 && n <= lines.length ? 1 : 0),
                        ),
                    );
                }
                break;
            case "home":
                b.moveLineEnd(true);
                break;
            case "end":
            case "$":
                b.moveLineEnd();
                break;
            case "^":
                b.moveLineEnd(true);
                while (b.cells[b.cursor] === " " || b.cells[b.cursor] === "\t") b.moveHorizontal(1);
                break;
            case "|":
                b.moveLineEnd(true);
                for (let i = 1; i < n; i++) b.moveHorizontal(1);
                break;
            case "ctrl+g": {
                const head = b.visualHead();
                const row = b.text.slice(0, head).split("\n").length;
                const start = b.text.lastIndexOf("\n", head - 1) + 1;
                this.tell(
                    `line ${row}, column ${b.utf16ToGrapheme(head) - b.utf16ToGrapheme(start) + 1}`,
                );
                break;
            }
            case "ctrl+o":
            case "ctrl+i":
                this.history(this.jumps, key === "ctrl+o" ? -1 : 1, false);
                break;
            case "ctrl+v":
            case "ctrl+q":
                if (this.rectangle === null) this.rectangle = b.visualHead();
                else this.rectangle = null;
                break;
            case "v":
                b.toggleSelect();
                break;
            case "i":
                b.enterInsert();
                break;
            case "a":
                b.enterInsert(true);
                break;
            case "I":
                b.moveLineEnd(true);
                while (b.cells[b.cursor] === " " || b.cells[b.cursor] === "\t") b.moveHorizontal(1);
                b.enterInsert();
                break;
            case "A":
                b.moveLineEnd();
                b.enterInsert();
                break;
            case "R": {
                if (this.register === "+" || this.register === "*") {
                    void this.clipboard("paste", this.register === "*" ? "primary" : "clipboard");
                } else {
                    const value = this.registers.read(this.register)
                        ?? { fragments: [b.register], linewise: false };
                    b.replaceRanges(
                        this.ranges().map(([start, end], i) => ({
                            start,
                            end,
                            text: value.fragments[Math.min(i, value.fragments.length - 1)] ?? "",
                        })),
                    );
                }
                break;
            }
            case "o":
            case "O":
                b.moveLineEnd(key === "O");
                b.enterInsert();
                b.insert("\n");
                if (key === "O") b.moveHorizontal(-1);
                break;
            case "D":
                b.setSelections(b.selections.map((s) => {
                    const start = b.visualHead(s), end = b.text.indexOf("\n", start);
                    return { ...s, start, end: end < 0 ? b.text.length : end, reversed: false };
                }));
                return this.dispatch("d");
            case "Y":
            case "S":
            case "X":
                b.setSelections(
                    b.selections.map((s) => ({
                        ...s,
                        start: b.visualHead(s),
                        end: b.visualHead(s),
                    })),
                );
                repeat(() => b.selectLine());
                if (key === "Y") return this.dispatch("y");
                if (key === "S") return this.dispatch("c");
                break;
            case "x":
                repeat(() => b.selectLine());
                break;
            case "d":
            case "c":
                if (this.register === "+" || this.register === "*") {
                    void this.clipboard(
                        "cut",
                        this.register === "*" ? "primary" : "clipboard",
                        undefined,
                        1,
                        key === "c",
                    );
                } else {
                    this.registers.write(this.capture(), "delete", this.register);
                    if (this.register === "_") {
                        if (key === "c") {
                            b.beginTransaction();
                            this.changeTransaction = true;
                        }
                        b.replaceSelection("");
                        if (key === "c") b.enterInsert();
                    } else b.deleteSelection(key === "c");
                }
                break;
            case "alt+d":
            case "alt+c":
                if (key === "alt+c") {
                    b.beginTransaction();
                    this.changeTransaction = true;
                }
                b.replaceSelection("");
                if (key === "alt+c") b.enterInsert();
                break;
            case "y":
                if (this.register === "+" || this.register === "*") {
                    void this.clipboard("copy", this.register === "*" ? "primary" : "clipboard");
                } else {
                    this.registers.write(this.capture(), "yank", this.register);
                    if (this.register !== "_") b.yank();
                }
                break;
            case "p":
            case "P": {
                if (this.register === "+" || this.register === "*") {
                    void this.clipboard(
                        "paste",
                        this.register === "*" ? "primary" : "clipboard",
                        key,
                        n,
                    );
                } else {this.pasteValue(
                        this.registers.read(this.register)
                            ?? { fragments: [b.register], linewise: false },
                        key === "P",
                        n,
                    );}
                break;
            }
            case "u":
                repeat(() => b.undo());
                break;
            case "ctrl+r":
            case "U":
                repeat(() => b.redo());
                break;
            case ".":
                this.replay(this.lastChange, n);
                break;
            case "~":
                this.transform((t) =>
                    [...t].map((c) => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())
                        .join("")
                );
                break;
            case "`":
                this.transform((t) => t.toLowerCase());
                break;
            case "alt+`":
                this.transform((t) => t.toUpperCase());
                break;
            case "ctrl+a":
            case "ctrl+x": {
                const numbers = [...b.text.matchAll(/-?\d+/g)];
                const edits = b.selections.flatMap((s) => {
                    const [a, z] = b.effectiveRange(s);
                    const m = numbers.find((m) => m.index < z && m.index + m[0].length > a);
                    return m
                        ? [{
                            start: m.index,
                            end: m.index + m[0].length,
                            text: String(Number(m[0]) + (key === "ctrl+a" ? n : -n)),
                        }]
                        : [];
                });
                b.replaceRanges(edits);
                break;
            }
            case ">":
            case "<":
                this.indent(key === ">" ? n : -n);
                break;
            case "J": {
                const edits = new Map<number, { start: number; end: number; text: string }>();
                for (const s of b.selections) {
                    let p = b.visualHead(s);
                    for (let i = 0; i < n; i++) {
                        const start = b.text.indexOf("\n", p);
                        if (start < 0) break;
                        const end = start + 1
                            + (b.text.slice(start + 1).match(/^[ \t]*/)?.[0].length ?? 0);
                        edits.set(start, { start, end, text: " " });
                        p = end;
                    }
                }
                b.replaceRanges([...edits.values()]);
                break;
            }
            case "C": {
                const selections = b.selections.map((s) => ({ ...s }));
                for (const s of [...selections]) {
                    const head = b.visualHead(s),
                        line = b.text.lastIndexOf("\n", head - 1) + 1,
                        column = b.utf16ToGrapheme(head) - b.utf16ToGrapheme(line);
                    let p = line;
                    for (let i = 0; i < n; i++) {
                        p = b.text.indexOf("\n", p);
                        if (p < 0) break;
                        p++;
                        const end = b.text.indexOf("\n", p);
                        const target = Math.min(
                            b.utf16ToGrapheme(end < 0 ? b.text.length : end),
                            b.utf16ToGrapheme(p) + column,
                        );
                        const start = b.graphemeToUtf16(target);
                        selections.push({
                            ...s,
                            id: `${s.id}-copy-${i}`,
                            start,
                            end: Math.min(end < 0 ? b.text.length : end, start + s.end - s.start),
                        });
                    }
                }
                b.setSelections(selections, b.primaryId);
                break;
            }
            case "%":
                b.setSelections([{
                    id: b.primaryId,
                    start: 0,
                    end: b.text.length,
                    reversed: false,
                }]);
                break;
            case ";":
                b.setSelections(
                    b.selections.map((s) => ({
                        ...s,
                        start: b.visualHead(s),
                        end: b.visualHead(s),
                    })),
                );
                break;
            case "alt+;":
                b.setSelections(b.selections.map((s) => ({ ...s, reversed: !s.reversed })));
                break;
            case ",":
                b.setSelections([{ ...b.primary }]);
                break;
            case "_":
            case "alt+x":
                this.trim();
                break;
            case "alt+s":
                this.splitLines();
                break;
            case "#":
            case "*": {
                const [a, z] = b.effectiveRange();
                this.searchPattern = b.text.slice(a, z).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                // Plain occurrence motions require whole-word matches; g motions allow substrings.
                if (key === "#") this.searchPattern = `\\b${this.searchPattern}\\b`;
                this.findSearch(this.searchPattern, key === "#");
                break;
            }
            case "s":
                this.regexPrompt = true;
                // falls through: selection regex uses the shared search prompt.
                // deno-lint-ignore no-fallthrough
            case "/":
            case "?":
                this.saved = b.selections.map((s) => ({ ...s }));
                this.savedPrimary = b.primaryId;
                this.search = { pattern: "", backward: key === "?" };
                this.status = key;
                break;
            case "n":
            case "N":
                repeat(() => this.findSearch(this.searchPattern, key === "N"));
                break;
            default:
                return false;
        }
        this.register = "\"";
        return true;
    }
    /** Select all injected-regex matches inside current selections. */
    selectRegex(pattern: string): boolean {
        const matches = this.matches(pattern);
        if (!matches) return false;
        const ranges = this.ranges(),
            found = matches.filter((m) => ranges.some(([a, z]) => m.start >= a && m.end <= z));
        if (!found.length) return false;
        this.buffer.setSelections(
            found.map((m, i) => ({ id: `regex-${i}`, ...m, reversed: false })),
        );
        this.options.requestRender?.();
        return true;
    }
    private pushJump(): void {
        this.jumps.push(this.buffer.selections.map((s) => ({ ...s })));
        this.jumpIndex = this.jumps.length;
    }
    private history(list: Selection[][], direction: number, change: boolean): void {
        if (!list.length) return;
        const index = Math.max(
            0,
            Math.min(list.length - 1, (change ? this.changeIndex : this.jumpIndex) + direction),
        );
        this.buffer.setSelections(list[index]!);
        if (change) this.changeIndex = index;
        else this.jumpIndex = index;
    }
    private rectangularize(): void {
        const b = this.buffer, anchor = this.rectangle!;
        const head = b.visualHead();
        const rows = b.text.split("\n"), offsets: number[] = [];
        let p = 0;
        for (const row of rows) {
            offsets.push(p);
            p += row.length + 1;
        }
        const ar = offsets.filter((x) => x <= anchor).length - 1,
            hr = offsets.filter((x) => x <= head).length - 1;
        const ac = b.utf16ToGrapheme(anchor) - b.utf16ToGrapheme(offsets[ar]!),
            hc = b.utf16ToGrapheme(head) - b.utf16ToGrapheme(offsets[hr]!);
        const selections: Selection[] = [];
        for (let r = Math.min(ar, hr); r <= Math.max(ar, hr); r++) {
            const base = b.utf16ToGrapheme(offsets[r]!), length = graphemes(rows[r]!).length;
            selections.push({
                id: `rectangle-${r}`,
                start: b.graphemeToUtf16(base + Math.min(length, ac, hc)),
                end: b.graphemeToUtf16(base + Math.min(length, Math.max(ac, hc) + 1)),
                reversed: hc < ac,
            });
        }
        b.setSelections(selections, `rectangle-${hr}`);
    }
    private occurrences(mode: string, replaceNewest = false): void {
        const b = this.buffer, [a, z] = b.effectiveRange(), text = b.text.slice(a, z);
        if (!text) return;
        const found: Selection[] = [];
        for (let p = 0; (p = b.text.indexOf(text, p)) >= 0; p += text.length) {
            found.push({ id: `occurrence-${p}`, start: p, end: p + text.length, reversed: false });
        }
        if (mode === "all") b.setSelections(found);
        else if (mode === "remove") {
            if (b.selections.length > 1) {
                b.setSelections(b.selections.filter((s) => s.id !== b.primaryId));
            }
        } else {
            const target = mode === "previous"
                ? [...found].reverse().find((s) => s.start < a) ?? found.at(-1)
                : found.find((s) => s.start > a) ?? found[0];
            if (target) {
                b.setSelections(
                    [
                        ...b.selections.filter((s) =>
                            s.start !== target.start && (!replaceNewest || s.id !== b.primaryId)
                        ),
                        target,
                    ],
                    target.id,
                );
            }
        }
    }
    private nextObject(key: string, forward: boolean, count: number): void {
        const b = this.buffer;
        if (key === "space") {
            const starts = [...b.text.matchAll(/^[ \t]*$/gm)].map((m) => m.index);
            for (let i = 0; i < count; i++) {
                const p = b.visualHead();
                const target = forward
                    ? starts.find((x) => x > p)
                    : starts.filter((x) => x < p).at(-1);
                if (target !== undefined) b.moveTo(b.utf16ToGrapheme(target));
            }
            return;
        }
        const pattern = key === "p"
            ? /\S[^]*?(?=\n\s*\n|$)/g
            : key === "s"
            ? /[^.!?]+[.!?]+/g
            : key === "w"
            ? /[\p{L}\p{N}_]+/gu
            : key === "W"
            ? /\S+/g
            : null;
        if (!pattern) {
            this.tell(`Unsupported directional object: ${key}`);
            return;
        }
        const matches = [...b.text.matchAll(pattern)];
        b.setSelections(b.selections.map((s) => {
            const p = b.visualHead(s);
            const candidates = forward
                ? matches.filter((m) => m.index > p)
                : matches.filter((m) => m.index < p).reverse();
            const m = candidates[count - 1];
            return m ? { ...s, start: m.index, end: m.index + m[0].length } : s;
        }));
    }
    private surround(key: string, remove: boolean, replacement?: string): void {
        const b = this.buffer,
            pairs: Record<string, string> = {
                "(": ")",
                "[": "]",
                "{": "}",
                "<": ">",
                "\"": "\"",
                "'": "'",
                "`": "`",
            };
        key = ({ ")": "(", "]": "[", "}": "{", ">": "<" } as Record<string, string>)[key] ?? key;
        if (!pairs[key]) {
            this.tell(`Unsupported surround: ${key}`);
            return;
        }
        if (!remove && replacement === undefined) {
            this.pending = `surround-new:${key}`;
            return;
        }
        const saved = b.selections.map((s) => ({ ...s }));
        this.object(key, true);
        const edits = b.selections.flatMap((s) =>
            b.text[s.start] === key && b.text[s.end - 1] === pairs[key]
                ? [{ start: s.start, end: s.start + 1, text: remove ? "" : replacement! }, {
                    start: s.end - 1,
                    end: s.end,
                    text: remove ? "" : pairs[replacement!] ?? replacement!,
                }]
                : []
        );
        b.setSelections(saved);
        b.replaceRanges(edits);
    }
    private bigWord(key: string): void {
        const b = this.buffer;
        b.setSelections(b.selections.map((s) => {
            const p = b.visualHead(s);
            let q = p;
            if (key === "B") {
                q = Math.max(0, q - 1);
                while (q > 0 && /\s/u.test(b.text[q]!)) q--;
                while (q > 0 && !/\s/u.test(b.text[q - 1]!)) q--;
            } else if (key === "W") {
                while (q < b.text.length && !/\s/u.test(b.text[q]!)) q++;
                while (q < b.text.length && /\s/u.test(b.text[q]!)) q++;
            } else {
                q++;
                while (q < b.text.length && /\s/u.test(b.text[q]!)) q++;
                while (q + 1 < b.text.length && !/\s/u.test(b.text[q + 1]!)) q++;
            }
            const a = b.mode === "select" ? (s.reversed ? s.end - 1 : s.start) : p;
            return {
                ...s,
                start: Math.min(a, q),
                end: Math.min(b.text.length, Math.max(a, q) + 1),
                reversed: q < a,
            };
        }));
    }
    private indent(amount: number): void {
        const b = this.buffer, starts = new Set<number>();
        for (const [a, z] of this.ranges()) {
            let p = b.text.lastIndexOf("\n", a - 1) + 1;
            do {
                starts.add(p);
                const next = b.text.indexOf("\n", p);
                if (next < 0) break;
                p = next + 1;
            } while (p < z);
        }
        b.replaceRanges(
            [...starts].map((start) => ({
                start,
                end: amount > 0
                    ? start
                    : start
                        + (b.text.slice(start).match(/^[ \t]*/)?.[0].slice(0, -amount * 4).length
                            ?? 0),
                text: amount > 0 ? " ".repeat(amount * 4) : "",
            })),
        );
    }
    private trim(): void {
        const b = this.buffer;
        b.setSelections(b.selections.map((s) => {
            const [a, z] = b.effectiveRange(s), t = b.text.slice(a, z);
            const start = a + (t.match(/^\s*/u)?.[0].length ?? 0);
            return { ...s, start, end: Math.max(start, z - (t.match(/\s*$/u)?.[0].length ?? 0)) };
        }));
    }
    private splitLines(): void {
        const b = this.buffer;
        const result: Selection[] = [];
        for (const [a, z] of this.ranges()) {
            let start = a;
            for (let p = a; p <= z; p++) {
                if (p === z || b.text[p] === "\n") {
                    result.push({ id: `split-${result.length}`, start, end: p, reversed: false });
                    start = p + 1;
                }
            }
        }
        if (result.length) b.setSelections(result);
    }
    private object(key: string, around: boolean): void {
        const b = this.buffer;
        if (key === "i") {
            const lines = b.text.split("\n"), offsets: number[] = [];
            let offset = 0;
            for (const line of lines) {
                offsets.push(offset);
                offset += line.length + 1;
            }
            b.setSelections(b.selections.map((s) => {
                const p = b.visualHead(s);
                let row = offsets.filter((x) => x <= p).length - 1;
                const indent = lines[row]!.match(/^[ \t]*/)![0].length;
                let a = row, z = row;
                const inside = (i: number) =>
                    !lines[i]!.trim() || lines[i]!.match(/^[ \t]*/)![0].length >= indent;
                while (a > 0 && inside(a - 1)) a--;
                while (z + 1 < lines.length && inside(z + 1)) z++;
                if (!around) {
                    while (a < z && !lines[a]!.trim()) a++;
                    while (z > a && !lines[z]!.trim()) z--;
                }
                return { ...s, start: offsets[a]!, end: offsets[z]! + lines[z]!.length };
            }));
            return;
        }
        if (key === "e") {
            b.setSelections(b.selections.map((s) => ({ ...s, start: 0, end: b.text.length })));
            return;
        }
        if (key === "p" || key === "s") {
            const ranges = key === "p"
                ? [...b.text.matchAll(/(?:[^\n]|\n(?![ \t]*\n))+/g)]
                : [...b.text.matchAll(/[^.!?]+(?:[.!?]+|$)/g)];
            b.setSelections(b.selections.map((s) => {
                const p = b.visualHead(s);
                const m = ranges.find((m) => m.index <= p && m.index + m[0].length > p);
                if (!m) return s;
                let start = m.index, end = start + m[0].length;
                if (!around) {
                    start += m[0].length - m[0].trimStart().length;
                    end -= m[0].length - m[0].trimEnd().length;
                }
                return { ...s, start, end };
            }));
            return;
        }
        if (key === "w" || key === "W") {
            b.setSelections(b.selections.map((s) => {
                let a = b.visualHead(s), z = a;
                const re = key === "w" ? /[\p{L}\p{N}_]/u : /\S/u;
                while (a > 0 && re.test(b.text[a - 1]!)) a--;
                while (z < b.text.length && re.test(b.text[z]!)) z++;
                if (around) { while (z < b.text.length && /\s/u.test(b.text[z]!)) z++; }
                return { ...s, start: a, end: z };
            }));
            return;
        }
        const pairs: Record<string, string> = {
            "(": ")",
            "[": "]",
            "{": "}",
            "<": ">",
            "\"": "\"",
            "'": "'",
            "`": "`",
        };
        key = ({ ")": "(", "]": "[", "}": "{", ">": "<", b: "(", r: "[", B: "{" } as Record<
            string,
            string
        >)[key] ?? key;
        const close = pairs[key];
        if (!close) {
            this.tell(`Unsupported object: ${key}`);
            return;
        }
        b.setSelections(b.selections.map((s) => {
            const p = b.visualHead(s);
            let a = -1, z = -1;
            if (key === close) {
                a = b.text.lastIndexOf(key, p);
                z = b.text.indexOf(close, Math.max(p, a + 1));
            } else {
                const stack: number[] = [];
                for (let i = 0; i < b.text.length; i++) {
                    if (b.text[i] === key) stack.push(i);
                    else if (b.text[i] === close) {
                        const open = stack.pop();
                        if (open !== undefined && open <= p && i >= p) {
                            a = open;
                            z = i;
                            break;
                        }
                    }
                }
            }
            return a >= 0 && z >= a
                ? { ...s, start: a + (around ? 0 : 1), end: z + (around ? 1 : 0) }
                : s;
        }));
    }
    private matchBracket(): void {
        const b = this.buffer,
            pairs: Record<string, string> = {
                "(": ")",
                "[": "]",
                "{": "}",
                ")": "(",
                "]": "[",
                "}": "{",
            };
        b.setSelections(b.selections.map((s) => {
            const p = b.visualHead(s), char = b.text[p]!, other = pairs[char];
            if (!other) return s;
            const direction = "([{".includes(char) ? 1 : -1;
            let depth = 1;
            for (let i = p + direction; i >= 0 && i < b.text.length; i += direction) {
                if (b.text[i] === char) depth++;
                if (b.text[i] === other) depth--;
                if (!depth) return { ...s, start: i, end: i, reversed: false };
            }
            return s;
        }));
    }
}
