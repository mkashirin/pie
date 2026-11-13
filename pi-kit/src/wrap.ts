import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** Evidence policy: preserve whitespace, SGR and OSC8; split long tokens, escape oversized cells. */
export function wrapPreservingText(text: string, width: number): string[] {
    width = Math.floor(width);
    if (!Number.isFinite(width) || width <= 0) return [];
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    // Extracted from Web's wrapWebText. Styling/link boundaries do not create wrap points.
    const parts = text.replace(/\t/gu, "    ").split(
        /(\x1b\[[0-9;:]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)|\r\n|\r|\n)/u,
    );
    const lines: string[] = [];
    let row = "";
    let columns = 0;
    let styles = "";
    let link = "";
    const finish = () => {
        // Selective resets leave the host's background untouched.
        lines.push(
            row + (styles ? "\x1b[22;23;24;25;27;28;29;39m" : "")
                + (link ? `\x1b]8;;${link.endsWith("\x07") ? "\x07" : "\x1b\\"}` : ""),
        );
        row = styles + link;
        columns = 0;
    };
    const append = (part: string) => {
        if (part.startsWith("\x1b")) {
            row += part;
            if (part.startsWith("\x1b]8;")) {
                link = /^\x1b\]8;[^;]*;(?:\x07|\x1b\\)$/u.test(part) ? "" : part;
            } else {
                if (/^\x1b\[(?:0)?m$/u.test(part)) styles = "";
                else styles += part;
            }
        } else {
            for (const { segment: cell } of segmenter.segment(part)) {
                const size = visibleWidth(cell);
                if (columns + size > width) finish();
                row += cell;
                columns += size;
            }
        }
    };
    let word: string[] = [];
    let wordColumns = 0;
    const flushWord = () => {
        if (columns > 0 && columns + wordColumns > width) finish();
        for (const part of word) append(part);
        word = [];
        wordColumns = 0;
    };
    for (const part of parts) {
        if (part.startsWith("\x1b")) {
            word.push(part);
        } else if (/^(?:\r\n|\r|\n)$/u.test(part)) {
            flushWord();
            finish();
        } else {
            for (const { segment } of segmenter.segment(part)) {
                const safe = visibleWidth(segment) > width
                    ? Array.from(segment, (char) => `\\u{${char.codePointAt(0)!.toString(16)}}`)
                        .join("")
                    : segment;
                if (/^\s+$/u.test(segment)) {
                    flushWord();
                    append(safe);
                } else {
                    word.push(safe);
                    wordColumns += visibleWidth(safe);
                }
            }
        }
    }
    flushWord();
    finish();
    return lines;
}

/** LSP policy: plain hard wrapping, four-space tabs, and '?' for an unrenderable grapheme. */
export function hardWrapText(text: string, width: number): string[] {
    const columns = Number.isFinite(width) ? Math.floor(width) : 0;
    if (columns < 1) return [];
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const rows: string[] = [];
    for (const line of text.replace(/\t/gu, "    ").split(/\r\n|\r|\n/u)) {
        let row = "";
        let used = 0;
        for (const { segment } of segmenter.segment(line)) {
            const cell = visibleWidth(segment) > columns ? "?" : segment;
            const size = visibleWidth(cell);
            if (used + size > columns) {
                rows.push(row);
                row = "";
                used = 0;
            }
            row += cell;
            used += size;
        }
        rows.push(row);
    }
    return rows;
}

/** Transcript prose policy: host word wrapping; never ellipsize long tokens. Trusted ANSI only. */
export function wrapProse(text: string, width: number, oversized: "?" | "." = "?"): string[] {
    const columns = Number.isFinite(width) ? Math.floor(width) : 0;
    if (columns < 1) return [];
    return wrapTextWithAnsi(text, columns).map((line) =>
        visibleWidth(line) > columns ? oversized : line
    );
}
