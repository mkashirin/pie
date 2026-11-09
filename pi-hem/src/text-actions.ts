import { HelixBuffer, type Selection } from "./model.ts";

export type TextActionView = {
    scroll?: (lines: number) => void;
    align?: (position: "top" | "center" | "bottom") => void;
    /** Return a grapheme index for the visible middle row. */
    middle?: () => number;
    pageSize?: number;
};
export type TextActionOptions = { count?: number; view?: TextActionView };
export type TextActionResult = {
    handled: boolean;
    intent?: "select-previous-match";
    unsupported?: string;
};

/** Standalone normal/select dispatch, before the controller switch. No prefixes are consumed.
 * Quote objects use m i/a q or m i/a |; bare q remains macro/controller territory.
 * Columns and returned viewport indices are graphemes, selection endpoints are UTF-16.
 */
export function extraTextAction(
    buffer: HelixBuffer,
    keySequence: string[],
    options: TextActionOptions = {},
): TextActionResult {
    const b = buffer;
    if (b.mode !== "normal" && b.mode !== "select") return { handled: false };
    const key = keySequence.join(" ");
    const n = options.count ?? 1;
    if (!Number.isSafeInteger(n) || n < 1 || n > 10000) return { handled: false };
    const view = options.view;
    const yes = { handled: true };
    const unavailable = (unsupported: string): TextActionResult => ({
        handled: false,
        unsupported,
    });
    const move = (fn: (index: number) => number) => {
        const selections = b.selections.map((s) => {
            const p = Math.max(0, Math.min(b.length, fn(b.utf16ToGrapheme(b.visualHead(s)))));
            const anchor = s.reversed
                ? Math.max(0, b.utf16ToGrapheme(s.end) - 1)
                : b.utf16ToGrapheme(s.start);
            return b.mode === "select"
                ? {
                    ...s,
                    start: b.graphemeToUtf16(Math.min(anchor, p)),
                    end: b.graphemeToUtf16(Math.min(b.length, Math.max(anchor, p) + 1)),
                    reversed: p < anchor,
                    goalColumn: undefined,
                }
                : {
                    ...s,
                    start: b.graphemeToUtf16(p),
                    end: b.graphemeToUtf16(p),
                    reversed: false,
                    goalColumn: undefined,
                };
        });
        b.setSelections(selections, b.primaryId);
    };
    if (key === "g N") return { handled: true, intent: "select-previous-match" };
    if (["z l", "z h", "z L", "z H"].includes(key)) {
        return unavailable("Soft-wrapped input has no horizontal viewport to scroll");
    }
    if (key === "ctrl+e" || key === "ctrl+y") {
        if (!view?.scroll) return unavailable("Viewport scroll callback required");
        view.scroll(key === "ctrl+e" ? n : -n);
        return yes;
    }
    const alignment =
        ({ "z t": "top", "z z": "center", "z c": "center", "z b": "bottom" } as Record<
            string,
            "top" | "center" | "bottom"
        >)[key];
    if (alignment) {
        if (!view?.align) return unavailable("Viewport alignment callback required");
        view.align(alignment);
        return yes;
    }
    if (key === "M") {
        if (!view?.middle) return unavailable("Viewport middle callback required");
        const index = view.middle();
        if (!Number.isFinite(index)) return unavailable("Invalid viewport middle index");
        move(() => Math.trunc(index));
        return yes;
    }
    if (["pagedown", "pageup", "ctrl+f", "ctrl+b"].includes(key)) {
        const size = view?.pageSize;
        if (!Number.isSafeInteger(size) || size! < 1 || size! * n > 10000) {
            return unavailable("Valid viewport pageSize required");
        }
        for (let i = 0; i < size! * n; i++) {
            b.moveVertical(key === "pagedown" || key === "ctrl+f" ? 1 : -1);
        }
        return yes;
    }
    if (["+", "-", "ctrl+m"].includes(key)) {
        // The manifest deliberately maps + to PreviousLineStart, not Vim's usual +.
        move((p) => {
            for (let i = 0; i < n; i++) {
                const [a, z] = b.lineRange(p);
                if (key === "+" || key === "-") p = a > 0 ? a - 1 : p;
                else p = z < b.length ? z + 1 : p;
            }
            const [a, z] = b.lineRange(p);
            p = a;
            while (p < z && /^\s$/u.test(b.cells[p]!)) p++;
            return p;
        });
        return yes;
    }
    if (key === "tab" || key === "shift+tab") {
        // vim::Tab is a forward tab motion for both manifest aliases.
        move((p) => {
            const [a, z] = b.lineRange(p);
            let column = 0;
            for (let i = a; i < p; i++) column += b.cells[i] === "\t" ? 4 - column % 4 : 1;
            const target = column + (4 - column % 4) + (n - 1) * 4;
            while (p < z && column < target) {
                column += b.cells[p] === "\t" ? 4 - column % 4 : 1;
                p++;
            }
            return p;
        });
        return yes;
    }
    if (key === "V") {
        if (b.mode === "select") {
            b.mode = "normal";
            move((p) => p);
        } else {
            b.selectLine();
            b.mode = "select";
        }
        return yes;
    }
    if (["alt+C", "ctrl+C", "ctrl+shift+c", "alt+shift+c"].includes(key)) {
        const additions: Selection[] = [];
        const occupied = new Set(b.selections.map((s) => `${s.start}:${s.end}`));
        const ids = new Set(b.selections.map((s) => s.id));
        for (const s of b.selections) {
            const head = b.utf16ToGrapheme(b.visualHead(s));
            const [a] = b.lineRange(head);
            const col = head - a;
            let row = a;
            for (let i = 0; i < n && row > 0; i++) {
                const [x, y] = b.lineRange(row - 1);
                row = x;
                if (x + col > y) continue;
                const start = b.graphemeToUtf16(x + col);
                if (occupied.has(`${start}:${start}`)) continue;
                let id = `extra-${ids.size}`;
                while (ids.has(id)) id += "x";
                ids.add(id);
                occupied.add(`${start}:${start}`);
                additions.push({ id, start, end: start, reversed: false });
            }
        }
        b.setSelections([...b.selections, ...additions], b.primaryId);
        return yes;
    }
    if (/^m [ia] [q|]$/.test(key)) {
        const around = keySequence[1] === "a";
        const delimiters = keySequence[2] === "q" ? ["\"", "'", "`"] : ["|"];
        const text = b.text;
        const pairs: [number, number][] = [];
        for (const delimiter of delimiters) {
            let open: number | undefined;
            for (let i = 0; i < text.length; i++) {
                if (text[i] === "\n") open = undefined;
                if (text[i] !== delimiter) continue;
                let slashes = 0;
                for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) slashes++;
                if (slashes % 2) continue;
                if (open === undefined) open = i;
                else {
                    pairs.push([open, i]);
                    open = undefined;
                }
            }
        }
        b.setSelections(
            b.selections.map((s) => {
                const p = b.visualHead(s);
                const distance = ([a, z]: [number, number]) => p < a ? a - p : p > z ? p - z : 0;
                const pair = [...pairs].sort((a, z) =>
                    distance(a) - distance(z) || (a[1] - a[0]) - (z[1] - z[0])
                )[n - 1];
                return pair
                    ? {
                        ...s,
                        start: pair[0] + (around ? 0 : 1),
                        end: pair[1] + (around ? 1 : 0),
                        reversed: false,
                        goalColumn: undefined,
                    }
                    : s;
            }),
            b.primaryId,
        );
        return yes;
    }
    return { handled: false };
}
