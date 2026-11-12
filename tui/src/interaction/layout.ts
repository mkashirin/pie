import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { clipText, inlineText } from "../text.ts";
import type { InteractionTui } from "./types.ts";

/** Picker prose: whitespace is a break opportunity; an oversized word is clipped, never split. */
export function wrapWords(text: string, width: number, firstWidth = width): string[] {
    width = columns(width);
    firstWidth = columns(firstWidth);
    if (width < 1 || firstWidth < 1) return [];
    const words = inlineText(text).split(/\s+/u).filter(Boolean);
    const rows: string[] = [];
    let row = "";
    for (const word of words) {
        const room = () => rows.length ? width : firstWidth;
        if (row && visibleWidth(`${row} ${word}`) > room()) {
            rows.push(row);
            row = "";
        }
        const clipped = clipText(word, room());
        row = row ? `${row} ${clipped}` : clipped;
    }
    if (row) rows.push(row);
    return rows;
}

export function columns(width: number): number {
    return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}
export function rowBudget(tui: InteractionTui): number {
    const rows = tui.terminal.rows;
    return Number.isFinite(rows) ? Math.max(1, Math.floor(rows) - 3) : 20;
}
export function inset(text: string, width: number, first: string, rest = first): string[] {
    const prefix = sliceByColumn(first, 0, width, true);
    const indent = sliceByColumn(rest, 0, width, true);
    const rows = wrapWords(
        text,
        Math.max(1, width - visibleWidth(indent)),
        Math.max(1, width - visibleWidth(prefix)),
    );
    return (rows.length ? rows : [""])
        .map((row, index) => sliceByColumn((index === 0 ? prefix : indent) + row, 0, width, true));
}

/** Keep the active physical row visible, even when chrome alone exceeds the terminal height. */
export function windowRows(rows: string[], active: number, budget: number): string[] {
    if (rows.length <= budget) return rows;
    const start = Math.max(0, Math.min(active, rows.length - budget));
    return rows.slice(start, start + budget);
}
