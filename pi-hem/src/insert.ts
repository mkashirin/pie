import { graphemes, HelixBuffer, type Selection } from "./model.ts";

export type InsertCommandResult = {
    handled: boolean;
    pending?: "register" | "literal" | "digraph";
    temporaryNormal?: boolean;
    showCompletions?: boolean;
};
export type InsertCommandOptions = { readRegister?: (name: string) => string | undefined };
type Frame = { text: string; selections: Selection[]; primaryId: string };
type History = { signature: string; frames: Frame[] };
const histories = new WeakMap<HelixBuffer, History>();
const signature = (b: HelixBuffer) =>
    JSON.stringify([b.revision, b.mode, b.primaryId, b.selections]);
const frame = (b: HelixBuffer): Frame => ({
    text: b.text,
    selections: b.selections.map((s) => ({ ...s })),
    primaryId: b.primaryId,
});
const category = (s: string) => /^\s+$/u.test(s) ? 0 : /^[\p{L}\p{N}_]/u.test(s) ? 1 : 2;

/** Route typed text (including resolved literal/digraph/register text) here for replace-backspace.
 * Each grapheme is one atomic multi-cursor edit. External edits/motions invalidate replace history.
 */
export function insertText(buffer: HelixBuffer, text: string): boolean {
    if (buffer.mode !== "insert" && buffer.mode !== "replace") return false;
    if (buffer.mode === "insert") return buffer.insert(text);
    let h = histories.get(buffer);
    if (!h || h.signature !== signature(buffer)) h = { signature: signature(buffer), frames: [] };
    let changed = false;
    for (const cell of graphemes(text.replace(/\r\n?/g, "\n"))) {
        const before = frame(buffer);
        // Explicit transactions avoid coupling replacement restoration to model insert grouping.
        const edits = buffer.selections.map((s) => {
            const i = buffer.utf16ToGrapheme(s.start);
            return {
                start: s.start,
                end: cell !== "\n" && buffer.cells[i] !== "\n"
                    ? buffer.graphemeToUtf16(Math.min(buffer.length, i + 1))
                    : s.start,
                text: cell,
            };
        });
        if (buffer.replaceRanges(edits)) {
            for (const s of buffer.selections) s.end = s.start;
            h.frames.push(before);
            changed = true;
        }
    }
    h.signature = signature(buffer);
    histories.set(buffer, h);
    return changed;
}

/** No host actions: caller resolves pending input and temporary-normal restoration.
 * Call only after Pi shortcut precedence. Unrecognized keys are left to the caller.
 * `ctrl+x ctrl+o` is accepted as an already-resolved completion sequence.
 */
export function handleInsertCommand(
    buffer: HelixBuffer,
    key: string,
    _options: InsertCommandOptions = {},
): InsertCommandResult {
    if (buffer.mode !== "insert" && buffer.mode !== "replace") return { handled: false };
    const result: InsertCommandResult = { handled: true };
    if (key === "ctrl+r") return { ...result, pending: "register" };
    if (["ctrl+v", "ctrl+q", "ctrl+Q"].includes(key)) return { ...result, pending: "literal" };
    if (key === "ctrl+k") return { ...result, pending: "digraph" };
    if (key === "ctrl+x ctrl+o") return { ...result, showCompletions: true };
    if (key === "ctrl+o") {
        histories.delete(buffer);
        buffer.mode = "normal";
        return { ...result, temporaryNormal: true };
    }
    if (["escape", "ctrl+c", "ctrl+["].includes(key)) {
        histories.delete(buffer);
        buffer.escape();
        return result;
    }
    if (key === "insert") {
        histories.delete(buffer);
        buffer.setSelections(buffer.selections, buffer.primaryId);
        buffer.mode = buffer.mode === "replace" ? "insert" : "replace";
        return result;
    }
    if (key === "backspace" && buffer.mode === "replace") {
        const h = histories.get(buffer);
        const previous = h?.signature === signature(buffer) ? h.frames.pop() : undefined;
        if (previous) {
            buffer.replaceRanges([{ start: 0, end: buffer.text.length, text: previous.text }]);
            buffer.setSelections(previous.selections, previous.primaryId);
            h!.signature = signature(buffer);
        } else histories.delete(buffer);
        return result;
    }
    const heads = buffer.selections.map((s) => buffer.utf16ToGrapheme(buffer.visualHead(s)));
    if (key === "delete-line-end") {
        buffer.replaceRanges(heads.map((start) => ({
            start: buffer.graphemeToUtf16(start),
            end: buffer.graphemeToUtf16(buffer.lineRange(start)[1]),
            text: "",
        })));
    } else if (key === "ctrl+w" || key === "ctrl+u") {
        buffer.replaceRanges(heads.map((end) => {
            let start = end;
            if (key === "ctrl+u") start = buffer.lineRange(end)[0];
            else {
                while (start > 0 && category(buffer.cells[start - 1]!) === 0) start--;
                const kind = category(buffer.cells[start - 1] ?? " ");
                while (start > 0 && category(buffer.cells[start - 1]!) === kind) start--;
            }
            return {
                start: buffer.graphemeToUtf16(start),
                end: buffer.graphemeToUtf16(end),
                text: "",
            };
        }));
    } else if (key === "ctrl+t" || key === "ctrl+d") {
        const lines = new Set(heads.map((i) => buffer.lineRange(i)[0]));
        buffer.replaceRanges([...lines].map((i) => {
            const start = buffer.graphemeToUtf16(i);
            const prefix = buffer.text.slice(start).match(/^(?:\t| {1,4})/)?.[0] ?? "";
            return {
                start,
                end: start + (key === "ctrl+d" ? prefix.length : 0),
                text: key === "ctrl+t" ? "    " : "",
            };
        }));
    } else if (key === "ctrl+y" || key === "ctrl+e") {
        const edits = heads.flatMap((i) => {
            const [a, b] = buffer.lineRange(i);
            let col = 0;
            for (let j = a; j < i; j++) col += buffer.cells[j] === "\t" ? 4 - col % 4 : 1;
            const next = key === "ctrl+y" ? a - 1 : b + 1;
            if (next < 0 || next > buffer.length) return [];
            const [x, y] = buffer.lineRange(next);
            let column = 0;
            for (let j = x; j < y; j++) {
                const width = buffer.cells[j] === "\t" ? 4 - column % 4 : 1;
                if (column + width > col) {
                    return [{
                        start: buffer.graphemeToUtf16(i),
                        end: buffer.graphemeToUtf16(i),
                        text: buffer.cells[j]!,
                    }];
                }
                column += width;
            }
            return [];
        });
        buffer.replaceRanges(edits);
    } else if (key === "left" || key === "right") buffer.moveHorizontal(key === "left" ? -1 : 1);
    else if (key === "up" || key === "down") buffer.moveVertical(key === "up" ? -1 : 1);
    else if (key === "home" || key === "end") buffer.moveLineEnd(key === "home");
    else if (key === "ctrl+left" || key === "ctrl+right") {
        buffer.moveWord(key === "ctrl+left" ? "back" : "next");
        buffer.setSelections(
            buffer.selections.map((s) => ({
                ...s,
                start: buffer.visualHead(s),
                end: buffer.visualHead(s),
                reversed: false,
            })),
            buffer.primaryId,
        );
    } else if (key === "backspace" || key === "delete") buffer.deleteAt(key === "backspace");
    else if (key === "tab" || key === "enter") insertText(buffer, key === "tab" ? "\t" : "\n");
    else return { handled: false };
    if (key !== "tab" && key !== "enter") histories.delete(buffer);
    return result;
}
