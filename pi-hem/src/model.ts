// Canonical coordinates are half-open UTF-16 offsets; legacy cursor APIs use graphemes.
export type Mode = "normal" | "insert" | "select" | "replace";
export type Selection = {
    id: string;
    start: number;
    end: number;
    reversed: boolean;
    goalColumn?: number;
};
export type RangeEdit = { start: number; end: number; text: string };
type Snapshot = { text: string; selections: Selection[]; primaryId: string; mode: Mode };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const graphemes = (text: string): string[] =>
    [...segmenter.segment(text)].map((x) => x.segment);
const normalized = (s: string) => s.replace(/\r\n?/g, "\n");
const kind = (s: string) =>
    /^\s+$/u.test(s) ? "space" : /^[\p{L}\p{N}_]/u.test(s) ? "word" : "punct";

export class HelixBuffer {
    cells: string[] = [];
    selections: Selection[] = [{ id: "0", start: 0, end: 0, reversed: false }];
    primaryId = "0";
    revision = 0;
    mode: Mode = "insert";
    private undoStack: Snapshot[] = [];
    private redoStack: Snapshot[] = [];
    private insertTransaction = false;
    private fragments: string[] = [];
    private linewise = false;
    get text(): string {
        return this.cells.join("");
    }
    get length(): number {
        return this.cells.length;
    }
    get primary(): Selection {
        return this.selections.find((s) => s.id === this.primaryId)!;
    }
    getRegisterFragments(): string[] {
        return [...this.fragments];
    }
    get register(): string {
        return this.fragments.join("\n");
    }
    set register(value: string) {
        this.fragments = [value];
        this.linewise = false;
    }
    graphemeToUtf16(index: number): number {
        return this.cells.slice(0, Math.max(0, index)).join("").length;
    }
    utf16ToGrapheme(offset: number): number {
        let units = 0, i = 0;
        while (i < this.length && units < offset) units += this.cells[i++]!.length;
        return i;
    }
    // Canonical ranges are scalar-aligned, not grapheme-aligned: regex matches may
    // legitimately select only the combining mark within a displayed grapheme.
    private boundary(offset: number): number {
        if (!Number.isFinite(offset)) throw new Error("Invalid range offset");
        const text = this.text;
        const p = Math.max(0, Math.min(text.length, Math.trunc(offset)));
        return p > 0 && p < text.length && /[\uD800-\uDBFF]/.test(text[p - 1]!)
                && /[\uDC00-\uDFFF]/.test(text[p]!)
            ? p - 1
            : p;
    }
    private floorGrapheme(offset: number): number {
        const i = this.utf16ToGrapheme(offset);
        return this.graphemeToUtf16(i) > offset ? Math.max(0, i - 1) : i;
    }
    setSelections(values: Selection[], primaryId = values[0]?.id): void {
        if (
            !values.length || new Set(values.map((s) => s.id)).size !== values.length
            || !values.some((s) => s.id === primaryId)
        ) throw new Error("Selections require unique IDs and a primary");
        this.selections = values.map((s) => {
            if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) {
                throw new Error("Invalid selection offset");
            }
            const a = this.boundary(s.start), b = this.boundary(s.end);
            return { ...s, start: Math.min(a, b), end: Math.max(a, b) };
        });
        this.primaryId = primaryId!;
        this.insertTransaction = false;
    }
    effectiveRange(s = this.primary): [number, number] {
        if (s.start !== s.end) return [s.start, s.end];
        const i = this.floorGrapheme(s.start);
        return [this.graphemeToUtf16(i), this.graphemeToUtf16(Math.min(this.length, i + 1))];
    }
    visualHead(s = this.primary): number {
        return s.reversed || s.start === s.end
            ? this.graphemeToUtf16(this.floorGrapheme(s.start))
            : this.graphemeToUtf16(Math.max(0, this.utf16ToGrapheme(s.end) - 1));
    }
    get cursor(): number {
        return this.utf16ToGrapheme(this.visualHead());
    }
    set cursor(i: number) {
        this.moveTo(i);
    }
    get anchor(): number {
        return this.primary.start === this.primary.end
            ? this.cursor
            : this.primary.reversed
            ? this.utf16ToGrapheme(this.primary.end) - 1
            : this.floorGrapheme(this.primary.start);
    }
    set anchor(i: number) {
        this.extend(this.primary, this.cursor, i);
    }
    get selection(): [number, number] {
        return this.effectiveRange().map((x) => this.utf16ToGrapheme(x)) as [number, number];
    }
    get position(): { line: number; col: number } {
        const before = this.text.slice(0, this.visualHead());
        return {
            line: before.split("\n").length - 1,
            col: before.length - before.lastIndexOf("\n") - 1,
        };
    }
    private state(): Snapshot {
        return {
            text: this.text,
            selections: this.selections.map((s) => ({ ...s })),
            primaryId: this.primaryId,
            mode: this.mode,
        };
    }
    private transactionDepth = 0;
    private transactionRecorded = false;
    beginTransaction(): void {
        if (this.transactionDepth++ === 0) this.transactionRecorded = false;
    }
    endTransaction(): void {
        if (this.transactionDepth > 0) this.transactionDepth--;
        if (!this.transactionDepth) this.transactionRecorded = false;
    }
    private snapshot(): void {
        if (this.transactionDepth && this.transactionRecorded) return;
        if (this.transactionDepth) this.transactionRecorded = true;
        this.undoStack.push(this.state());
        if (this.undoStack.length > 200) this.undoStack.shift();
        this.redoStack = [];
    }
    private restore(s: Snapshot): void {
        this.cells = graphemes(s.text);
        this.setSelections(s.selections, s.primaryId);
        this.mode = s.mode;
        this.insertTransaction = false;
        this.revision++;
    }
    undo(): boolean {
        const s = this.undoStack.pop();
        if (!s) return false;
        this.redoStack.push(this.state());
        this.restore(s);
        return true;
    }
    redo(): boolean {
        const s = this.redoStack.pop();
        if (!s) return false;
        this.undoStack.push(this.state());
        this.restore(s);
        return true;
    }
    setText(value: string, recordUndo = true): void {
        const text = normalized(value);
        if (text === this.text && recordUndo) {
            this.insertTransaction = false;
            return;
        }
        if (recordUndo) this.snapshot();
        else {
            this.undoStack = [];
            this.redoStack = [];
        }
        this.cells = graphemes(text);
        this.selections = [{ id: "0", start: text.length, end: text.length, reversed: false }];
        this.primaryId = "0";
        this.mode = "insert";
        this.insertTransaction = false;
        this.revision++;
    }
    reset(): void {
        this.cells = [];
        this.selections = [{ id: "0", start: 0, end: 0, reversed: false }];
        this.primaryId = "0";
        this.mode = "insert";
        this.undoStack = [];
        this.redoStack = [];
        this.insertTransaction = false;
        this.revision++;
    }
    // Overlapping identical replacements coalesce. Conflicting overlaps reject before mutation.
    replaceRanges(ranges: RangeEdit[], recordUndo = true): boolean {
        const edits = ranges.map((e) => ({
            start: this.boundary(e.start),
            end: this.boundary(e.end),
            text: normalized(e.text),
        })).sort((a, b) => a.start - b.start || a.end - b.end);
        const merged: RangeEdit[] = [];
        for (const e of edits) {
            if (e.start > e.end) throw new Error("Reversed edit range");
            const p = merged.at(-1);
            if (p && (e.start < p.end || e.start === p.start)) {
                if (p.text !== e.text) throw new Error("Conflicting overlapping edits");
                p.end = Math.max(p.end, e.end);
            } else merged.push({ ...e });
        }
        if (!merged.some((e) => this.text.slice(e.start, e.end) !== e.text)) return false;
        if (recordUndo) {
            this.snapshot();
            this.insertTransaction = false;
        }
        // Map the pre-edit endpoints with half-open affinity. A head at an
        // edit's start belongs to that edit, not the preceding adjacent edit.
        // A nonempty selection's trailing endpoint instead stays on the left
        // of edits starting there. Never remap an already mapped coordinate.
        const map = (p: number, side: "left" | "right") => {
            let delta = 0;
            for (const e of merged) {
                if (p < e.start || (p === e.start && side === "left")) break;
                if (p < e.end || (p === e.end && side === "left")) {
                    return e.start + delta + e.text.length;
                }
                delta += e.text.length - (e.end - e.start);
            }
            return p + delta;
        };
        let text = this.text;
        for (const e of [...merged].reverse()) {
            text = text.slice(0, e.start) + e.text + text.slice(e.end);
        }
        const selections = this.selections.map((s) => ({
            ...s,
            start: map(s.start, "right"),
            end: map(s.end, s.start === s.end ? "right" : "left"),
            goalColumn: undefined,
        }));
        this.cells = graphemes(text);
        this.setSelections(selections, this.primaryId);
        this.revision++;
        return true;
    }
    private extend(s: Selection, head: number, anchor: number): void {
        s.start = this.graphemeToUtf16(Math.min(head, anchor));
        s.end = this.graphemeToUtf16(Math.min(this.length, Math.max(head, anchor) + 1));
        s.reversed = head < anchor;
    }
    private motion(fn: (i: number, s: Selection) => number, vertical = false): void {
        for (const s of this.selections) {
            const i = this.utf16ToGrapheme(this.visualHead(s)),
                target = Math.max(0, Math.min(this.length, fn(i, s)));
            if (this.mode === "select") {
                this.extend(
                    s,
                    target,
                    s.reversed ? this.utf16ToGrapheme(s.end) - 1 : this.utf16ToGrapheme(s.start),
                );
            } else {
                s.start = s.end = this.graphemeToUtf16(target);
                s.reversed = false;
            }
            if (!vertical) s.goalColumn = undefined;
        }
        this.insertTransaction = false;
    }
    moveTo(target: number, vertical = false): void {
        this.motion(() => target, vertical);
    }
    moveHorizontal(direction: -1 | 1): void {
        this.motion((i) => i + direction);
    }
    lineRange(index = this.cursor): [number, number] {
        let a = Math.max(0, Math.min(index, this.length)), b = a;
        while (a > 0 && this.cells[a - 1] !== "\n") a--;
        while (b < this.length && this.cells[b] !== "\n") b++;
        return [a, b];
    }
    moveLineEnd(start = false): void {
        this.motion((i) => this.lineRange(i)[start ? 0 : 1]);
    }
    moveVertical(direction: -1 | 1): void {
        this.motion((i, s) => {
            const [a, b] = this.lineRange(i);
            const width = (start: number, end: number) => {
                let col = 0;
                for (let j = start; j < end; j++) col += this.cells[j] === "\t" ? 4 - col % 4 : 1;
                return col;
            };
            const col = s.goalColumn ?? width(a, i);
            s.goalColumn = col;
            const next = direction < 0 ? a - 1 : b + 1;
            if (next < 0 || next > this.length) return i;
            const [x, y] = this.lineRange(next);
            let target = x;
            while (target < y && width(x, target + 1) <= col) target++;
            return target;
        }, true);
    }
    moveWord(direction: "next" | "back" | "end"): void {
        for (const s of this.selections) {
            const original = this.utf16ToGrapheme(this.visualHead(s));
            let p = original;
            if (direction === "back") {
                p = Math.max(0, p - 1);
                while (p > 0 && kind(this.cells[p] ?? " ") === "space") p--;
                const k = kind(this.cells[p] ?? " ");
                while (p > 0 && kind(this.cells[p - 1]!) === k) p--;
            } else if (direction === "next") {
                const k = kind(this.cells[p] ?? " ");
                while (p < this.length && kind(this.cells[p]!) === k) p++;
                while (p < this.length && kind(this.cells[p]!) === "space") p++;
            } else {if (p + 1 < this.length && kind(this.cells[p]!) === kind(this.cells[p + 1]!)) {
                    const k = kind(this.cells[p]!);
                    while (p + 1 < this.length && kind(this.cells[p + 1]!) === k) p++;
                } else {
                    p++;
                    while (p < this.length && kind(this.cells[p]!) === "space") p++;
                    const k = kind(this.cells[p] ?? " ");
                    while (p + 1 < this.length && kind(this.cells[p + 1]!) === k) p++;
                }}
            p = Math.min(p, this.length);
            const anchor = this.mode === "select"
                ? (s.reversed ? this.utf16ToGrapheme(s.end) - 1 : this.utf16ToGrapheme(s.start))
                : original;
            this.extend(s, p, anchor);
            s.goalColumn = undefined;
        }
        this.insertTransaction = false;
    }
    selectLine(): void {
        for (const s of this.selections) {
            const [a, b] = this.effectiveRange(s).map((x) => this.utf16ToGrapheme(x));
            const start = this.lineRange(a)[0];
            let end = this.lineRange(Math.max(a, b - 1))[1];
            if (end < this.length) end++;
            if (a === start && b === end && end < this.length) {
                end = this.lineRange(end)[1];
                if (end < this.length) end++;
            }
            s.start = this.graphemeToUtf16(start);
            s.end = this.graphemeToUtf16(end);
            s.reversed = false;
        }
        this.insertTransaction = false;
    }
    enterInsert(after = false): void {
        for (const s of this.selections) {
            const p = after ? this.effectiveRange(s)[1] : s.start;
            s.start = s.end = p;
            s.reversed = false;
        }
        this.mode = "insert";
        this.insertTransaction = false;
    }
    escape(): void {
        if (this.mode === "insert" || this.mode === "replace") {
            for (const s of this.selections) {
                const i = Math.min(this.utf16ToGrapheme(s.start), Math.max(0, this.length - 1));
                s.start = s.end = this.graphemeToUtf16(i);
                s.reversed = false;
            }
        }
        this.mode = "normal";
        this.insertTransaction = false;
    }
    toggleSelect(): void {
        if (this.mode === "select") {
            this.mode = "normal";
            for (const s of this.selections) s.start = s.end = this.visualHead(s);
        } else {
            for (const s of this.selections) {
                const p = this.visualHead(s);
                s.start = s.end = p;
                s.reversed = false;
            }
            this.mode = "select";
        }
        this.insertTransaction = false;
    }
    private replaceEnd(start: number, text: string): number {
        let i = this.floorGrapheme(start);
        for (const cell of graphemes(normalized(text))) {
            if (cell === "\n" || this.cells[i] === "\n" || i >= this.length) break;
            i++;
        }
        return i;
    }
    insert(text: string): boolean {
        if (!text) return false;
        const changed = this.replaceRanges(
            this.selections.map((s) => ({
                start: s.start,
                end: this.mode === "replace"
                    ? this.graphemeToUtf16(this.replaceEnd(s.start, text))
                    : s.start,
                text,
            })),
            !this.insertTransaction,
        );
        if (changed) {
            for (const s of this.selections) s.end = s.start;
            this.insertTransaction = true;
        }
        return changed;
    }
    replaceSelection(text: string): boolean {
        const changed = this.replaceRanges(this.selections.map((s) => {
            const [start, end] = this.effectiveRange(s);
            return { start, end, text };
        }));
        for (const s of this.selections) {
            s.end = s.start;
            s.reversed = false;
        }
        this.mode = "normal";
        this.insertTransaction = false;
        return changed;
    }
    yank(): void {
        this.fragments = this.selections.map((s) => {
            const [a, b] = this.effectiveRange(s);
            return this.text.slice(a, b);
        });
        this.linewise = this.selections.every((s) => {
            const [a, b] = this.effectiveRange(s);
            return (a === 0 || this.text[a - 1] === "\n")
                && (b === this.text.length || this.text[b - 1] === "\n");
        });
    }
    deleteSelection(change = false): boolean {
        if (!this.selections.some((s) => this.effectiveRange(s)[0] !== this.effectiveRange(s)[1])) {
            if (change) this.enterInsert();
            return false;
        }
        this.yank();
        const changed = this.replaceSelection("");
        if (change) {
            this.enterInsert();
            this.insertTransaction = changed;
        }
        return changed;
    }
    paste(): boolean {
        if (!this.fragments.some(Boolean)) return false;
        const changed = this.replaceRanges(this.selections.map((s, i) => {
            let p = this.effectiveRange(s)[1];
            if (this.linewise) {
                const end = this.lineRange(this.utf16ToGrapheme(this.visualHead(s)))[1];
                p = this.graphemeToUtf16(Math.min(this.length, end + 1));
            }
            let text = this.fragments[Math.min(i, this.fragments.length - 1)]!;
            if (this.linewise) {
                if (p === this.text.length && p > 0 && this.text[p - 1] !== "\n") {
                    text = "\n" + text;
                } else if (!text.endsWith("\n")) text += "\n";
            }
            return { start: p, end: p, text };
        }));
        this.mode = "normal";
        this.insertTransaction = false;
        return changed;
    }
    deleteAt(backward: boolean): boolean {
        const edits = this.selections.flatMap((s) => {
            const i = this.utf16ToGrapheme(this.visualHead(s)) - (backward ? 1 : 0);
            return i < 0 || i >= this.length
                ? []
                : [{ start: this.graphemeToUtf16(i), end: this.graphemeToUtf16(i + 1), text: "" }];
        });
        const changed = this.replaceRanges(edits, !this.insertTransaction);
        if (changed) this.insertTransaction = true;
        return changed;
    }
    deleteRange(start: number, end: number): boolean {
        const changed = this.replaceRanges([{
            start: this.graphemeToUtf16(start),
            end: this.graphemeToUtf16(end),
            text: "",
        }]);
        this.insertTransaction = false;
        return changed;
    }
}
