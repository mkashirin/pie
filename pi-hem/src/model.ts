// Buffer logic is independent of terminal input and rendering so motions can be tested.
export type Mode = "normal" | "insert" | "select";
type Snapshot = { text: string; cursor: number; anchor: number; mode: Mode };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export const graphemes = (text: string): string[] =>
    [...segmenter.segment(text)].map((item) => item.segment);

const normalized = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");

const kind = (
    s: string,
) => (/^\s$/u.test(s) ? "space" : /^[\p{L}\p{N}_]/u.test(s) ? "word" : "punct");

export class HelixBuffer {
    cells: string[] = [];
    cursor = 0;
    anchor = 0;
    mode: Mode = "insert";
    register = "";
    private undoStack: Snapshot[] = [];
    private insertTransaction = false;
    private preferredColumn: number | undefined;

    get text(): string {
        return this.cells.join("");
    }

    get length(): number {
        return this.cells.length;
    }

    private resegmentAt(utf16Offset: number): void {
        this.cells = graphemes(this.text);
        let units = 0;
        this.cursor = 0;
        for (const cell of this.cells) {
            if (units >= utf16Offset) break;
            units += cell.length;
            this.cursor++;
        }
        this.anchor = this.cursor;
    }

    get selection(): [number, number] {
        if (!this.length) return [0, 0];
        return [
            Math.min(this.cursor, this.anchor),
            Math.min(this.length, Math.max(this.cursor, this.anchor) + 1),
        ];
    }

    get position(): { line: number; col: number } {
        const before = this.cells.slice(0, this.cursor);
        const lastBreak = before.lastIndexOf("\n");
        return {
            line: before.filter((s) => s === "\n").length,
            col: before.slice(lastBreak + 1).join("").length,
        };
    }

    setText(value: string, recordUndo = true): void {
        const text = normalized(value);
        if (text === this.text) return;
        if (recordUndo) this.snapshot();
        this.cells = graphemes(text);
        this.cursor = this.cells.length;
        this.anchor = this.cursor;
        this.mode = "insert";
        this.insertTransaction = false;
        this.preferredColumn = undefined;
    }

    reset(): void {
        this.cells = [];
        this.cursor = this.anchor = 0;
        this.mode = "insert";
        this.undoStack = [];
        this.insertTransaction = false;
        this.preferredColumn = undefined;
    }

    private snapshot(): void {
        this.undoStack.push({
            text: this.text,
            cursor: this.cursor,
            anchor: this.anchor,
            mode: this.mode,
        });
        if (this.undoStack.length > 200) this.undoStack.shift();
    }

    undo(): boolean {
        this.insertTransaction = false;
        const old = this.undoStack.pop();
        if (!old) return false;
        this.cells = graphemes(old.text);
        this.cursor = Math.min(old.cursor, this.length);
        this.anchor = Math.min(old.anchor, this.length);
        this.mode = "normal";
        return true;
    }

    enterInsert(after = false): void {
        if (after && this.length) this.cursor = Math.min(this.length, this.cursor + 1);
        this.anchor = this.cursor;
        this.mode = "insert";
        this.insertTransaction = false;
    }

    escape(): void {
        this.mode = "normal";
        this.insertTransaction = false;
        if (this.length) this.cursor = Math.min(this.cursor, this.length - 1);
        this.anchor = this.cursor;
    }

    toggleSelect(): void {
        if (this.mode === "select") {
            this.mode = "normal";
            this.anchor = this.cursor;
        } else {
            this.mode = "select";
            this.anchor = this.cursor;
        }
    }

    moveTo(target: number, vertical = false): void {
        this.cursor = Math.max(0, Math.min(this.length, target));
        if (this.mode !== "select") this.anchor = this.cursor;
        if (this.mode === "insert") this.insertTransaction = false;
        if (!vertical) this.preferredColumn = undefined;
    }

    moveHorizontal(direction: -1 | 1): void {
        // Normal/select mode can also reach the empty position after the last
        // grapheme, so moving right does not require entering append mode.
        this.moveTo(this.cursor + direction);
    }

    lineRange(index = this.cursor): [number, number] {
        let start = Math.min(index, this.length);
        while (start > 0 && this.cells[start - 1] !== "\n") start--;
        let end = Math.min(index, this.length);
        while (end < this.length && this.cells[end] !== "\n") end++;
        return [start, end];
    }

    selectLine(): void {
        if (!this.length) return;
        const [a, b] = this.selection;
        const start = this.lineRange(a)[0];
        const last = Math.max(a, b - 1);
        const lineEnd = this.lineRange(last)[1];
        let end = lineEnd < this.length ? lineEnd + 1 : lineEnd;
        // Once the selection already covers whole lines, include the next line.
        // The newline belongs to the preceding line, not the following one.
        if (a === start && b === end && end < this.length) {
            const nextEnd = this.lineRange(end)[1];
            end = nextEnd < this.length ? nextEnd + 1 : nextEnd;
        }
        this.mode = "select";
        this.anchor = start;
        this.cursor = Math.max(start, end - 1);
        this.insertTransaction = false;
        this.preferredColumn = undefined;
    }

    moveLineEnd(start = false): void {
        const [a, b] = this.lineRange();
        this.moveTo(
            start ? a : Math.max(a, this.mode === "insert" ? b : Math.min(b, this.length - 1)),
        );
    }

    moveVertical(direction: -1 | 1): void {
        const [start] = this.lineRange();
        const column = this.preferredColumn ?? this.cursor - start;
        this.preferredColumn = column;
        const next = direction < 0 ? start - 1 : this.lineRange()[1] + 1;
        if (next < 0 || next > this.length) return;
        const [a, b] = this.lineRange(next);
        this.moveTo(Math.min(b, a + column), true);
    }

    moveWord(direction: "next" | "back" | "end"): void {
        let p = this.cursor;
        if (direction === "back") {
            p = Math.max(0, p - 1);
            while (p > 0 && kind(this.cells[p] ?? " ") === "space") p--;
            const type = kind(this.cells[p] ?? " ");
            while (p > 0 && kind(this.cells[p - 1]!) === type) p--;
        } else if (direction === "next") {
            if (p < this.length && kind(this.cells[p]!) !== "space") {
                const type = kind(this.cells[p]!);
                while (p < this.length && kind(this.cells[p]!) === type) p++;
            }
            while (p < this.length && kind(this.cells[p]!) === "space") p++;
        } else {
            // `e` finishes the current word; at its end, continue through spaces
            // to the end of the next word instead of getting stuck on the boundary.
            if (p < this.length && kind(this.cells[p]!) !== "space") {
                const type = kind(this.cells[p]!);
                while (p + 1 < this.length && kind(this.cells[p + 1]!) === type) p++;
                if (p === this.cursor && p + 1 < this.length) p++;
            }
            while (p < this.length && kind(this.cells[p]!) === "space") p++;
            if (p < this.length) {
                const type = kind(this.cells[p]!);
                while (p + 1 < this.length && kind(this.cells[p + 1]!) === type) p++;
            }
        }
        this.moveTo(
            Math.min(p, this.mode === "insert" ? this.length : Math.max(0, this.length - 1)),
        );
    }

    insert(text: string): boolean {
        const parts = graphemes(normalized(text));
        if (!parts.length) return false;
        if (!this.insertTransaction) {
            this.snapshot();
            this.insertTransaction = true;
        }
        const units = this.cells.slice(0, this.cursor).join("").length + parts.join("").length;
        this.cells.splice(this.cursor, 0, ...parts);
        this.resegmentAt(units);
        return true;
    }

    replaceSelection(text: string): boolean {
        const [a, b] = this.selection;
        if (a === b && !text) return false;
        this.snapshot();
        const parts = graphemes(normalized(text));
        const units = this.cells.slice(0, a).join("").length + parts.join("").length;
        this.cells.splice(a, b - a, ...parts);
        this.resegmentAt(units);
        this.insertTransaction = false;
        this.mode = "normal";
        return true;
    }

    deleteSelection(change = false): boolean {
        if (!this.length) {
            if (change) this.enterInsert();
            return false;
        }
        const [a, b] = this.selection;
        if (a === b) {
            if (change) this.enterInsert();
            return false;
        }
        this.register = this.cells.slice(a, b).join("");
        this.replaceSelection("");
        this.cursor = Math.min(a, Math.max(0, this.length - 1));
        this.anchor = this.cursor;
        if (change) {
            this.enterInsert();
            // Changing the selection and typing its replacement are one undo step.
            this.insertTransaction = true;
        }
        return true;
    }

    yank(): void {
        const [a, b] = this.selection;
        this.register = this.cells.slice(a, b).join("");
    }

    paste(): boolean {
        if (!this.register) return false;
        const [, b] = this.selection;
        this.snapshot();
        const parts = graphemes(this.register);
        const units = this.cells.slice(0, b).join("").length;
        this.cells.splice(b, 0, ...parts);
        this.resegmentAt(units);
        this.mode = "normal";
        this.insertTransaction = false;
        return true;
    }

    deleteAt(backward: boolean): boolean {
        const a = backward ? this.cursor - 1 : this.cursor;
        if (a < 0 || a >= this.length) return false;
        if (!this.insertTransaction) {
            this.snapshot();
            this.insertTransaction = true;
        }
        const units = this.cells.slice(0, a).join("").length;
        this.cells.splice(a, 1);
        this.resegmentAt(units);
        return true;
    }

    deleteRange(start: number, end: number): boolean {
        if (start === end) return false;
        this.snapshot();
        const units = this.cells.slice(0, start).join("").length;
        this.cells.splice(start, end - start);
        this.resegmentAt(units);
        this.insertTransaction = false;
        return true;
    }
}
