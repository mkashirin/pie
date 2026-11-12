// Package-local presentation only. Never use rendered text to recover an item ID.
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@narumitw/pi-tui-kit";

export function wrapWords(text, width, style = (line) => line) {
    width = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    if (width === 0) return [];
    const words = sanitizeTerminalText(String(text)).trim().split(/\s+/u).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
        // A token is indivisible: a cell/grapheme-safe ellipsis replaces its overflow,
        // never a second fragment on the next row (including URLs, CJK and emoji).
        const token = visibleWidth(word) > width ? truncateToWidth(word, width) : word;
        const next = line ? `${line} ${token}` : token;
        if (line && visibleWidth(next) > width) {
            lines.push(style(line));
            line = token;
        } else line = next;
    }
    lines.push(style(line));
    return lines;
}

export function renderPickerItem(label, description, width, selected, theme, disabled = false) {
    width = Math.max(0, Math.floor(width));
    if (!width) return [];
    const inset = width >= 3 ? 2 : 1;

    const style = (text) =>
        selected ? theme.fg("accent", text) : disabled ? theme.fg("dim", text) : text;

    if (width <= inset) return [style(selected ? "→" : " ")];
    const text = description ? `${label} · ${description}` : label;
    return wrapWords(text, width - inset).map((line, index) => {
        const prefix = selected ? index === 0 ? "→" : "│" : " ";
        return style(`${prefix}${inset === 2 ? " " : ""}${line}`);
    });
}

// Menu components own selection, keybindings, search and activation. This is deliberately
// not an interactive SelectList subclass (whose mouse mapping assumes one row).
export class WrappedPickerList {
    constructor(items, maxVisible, theme) {
        this.items = items;
        this.maxVisible = maxVisible;
        this.theme = theme;
        this.selectedIndex = 0;
    }

    setSelectedIndex(index) {
        this.selectedIndex = index;
    }

    invalidate() {}

    render(width) {
        if (!this.items.length) return wrapWords("No matching items", width, this.theme.noMatch);
        const count = Math.max(1, Math.min(this.items.length, this.maxVisible));
        const start = Math.max(
            0,
            Math.min(this.selectedIndex - Math.floor(count / 2), this.items.length - count),
        );
        const theme = {
            fg: (color, text) =>
                color === "accent" ? this.theme.selectedText(text) : this.theme.description(text),
        };
        const lines = this.items.slice(start, start + count).flatMap((item, offset) =>
            renderPickerItem(
                item.label,
                item.description,
                width,
                start + offset === this.selectedIndex,
                theme,
            )
        );
        if (count < this.items.length) {
            lines.push(
                ...wrapWords(
                    `(${this.selectedIndex + 1}/${this.items.length})`,
                    width,
                    this.theme.scrollInfo,
                ),
            );
        }
        return lines;
    }
}
