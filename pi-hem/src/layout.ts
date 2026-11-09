import { visibleWidth } from "@earendil-works/pi-tui";
import type { HelixBuffer } from "./model.ts";
export type Row = {
    cells: { text: string; index: number; width: number }[];
    start: number;
    cursor: boolean;
};
/** One coordinate map for drawing, mouse hit testing and visual motion. */
export function layout(buffer: HelixBuffer, columns: number): Row[] {
    columns = Math.max(1, columns);
    const rows: Row[] = [];
    const cells = buffer.cells;
    let start = 0;
    for (let end = 0; end <= cells.length; end++) {
        if (end < cells.length && cells[end] !== "\n") continue;
        let p = start;
        if (p === end) rows.push({ cells: [], start: p, cursor: buffer.cursor === p });
        while (p < end) {
            const items: Row["cells"] = [];
            let used = 0, space = -1;
            for (let i = p; i < end; i++) {
                const raw = cells[i]!;
                let text = raw === "\t"
                    ? " ".repeat(4 - used % 4)
                    : raw.replace(/[\x00-\x1f\x7f-\x9f]/g, "�");
                if (visibleWidth(text) > columns) text = raw === "\t" ? " ".repeat(columns) : "?";
                const width = Math.max(1, visibleWidth(text));
                if (items.length && used + width > columns) break;
                items.push({ text, index: i, width });
                used += width;
                if (/^\s+$/u.test(raw) && i + 1 < end && !/^\s+$/u.test(cells[i + 1]!)) {
                    space = items.length;
                }
            }
            if (p + items.length < end && space > 0) items.splice(space);
            const next = p + items.length;
            rows.push({
                cells: items,
                start: p,
                cursor: buffer.cursor >= p && buffer.cursor < next,
            });
            p = next;
        }
        if (
            start < end
            && buffer.selections.some((s) => buffer.utf16ToGrapheme(buffer.visualHead(s)) === end)
        ) {
            const last = rows[rows.length - 1]!;
            if (last.cells.reduce((n, c) => n + c.width, 0) >= columns) {
                rows.push({ cells: [], start: end, cursor: buffer.cursor === end });
            } else if (buffer.cursor === end) last.cursor = true;
        }
        start = end + 1;
    }
    return rows;
}
