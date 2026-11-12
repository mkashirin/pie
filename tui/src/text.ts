import { truncateToWidth } from "@earendil-works/pi-tui";

export interface DisplayTextOptions {
    multiline: boolean;
    tabs: "preserve" | "space" | "expand" | "remove";
    controls?: "space" | "remove";
}

/** Display only: never use sanitized text as an ID, answer, evidence or persisted payload. */
export function sanitizeDisplayText(value: string, options: DisplayTextOptions): string {
    let output = "";
    // Sequence scanning follows Kit 0.59.0 terminal-text.js (MIT; see ../LICENSE).
    // Scan before whitespace conversion, so newlines/tabs inside an OSC/DCS are not exposed.
    for (let index = 0; index < value.length;) {
        const code = value.codePointAt(index)!;
        const length = code > 0xffff ? 2 : 1;
        if (code === 0x1b) {
            const next = value.charCodeAt(index + 1);
            if (next === 0x5b) index = skipCsi(value, index + 2);
            else if ([0x5d, 0x50, 0x5e, 0x5f].includes(next)) {
                index = skipString(value, index + 2, next === 0x5d);
            } else {
                index++;
                while (index < value.length && /[\x20-\x2f]/u.test(value[index]!)) index++;
                if (/[\x30-\x7e]/u.test(value[index] ?? "")) index++;
            }
            continue;
        }
        if (code === 0x9b) {
            index = skipCsi(value, index + length);
            continue;
        }
        if ([0x90, 0x9d, 0x9e, 0x9f].includes(code)) {
            index = skipString(value, index + length, code === 0x9d);
            continue;
        }
        const character = String.fromCodePoint(code);
        if (character === "\t") {
            output += options.tabs === "preserve"
                ? "\t"
                : options.tabs === "expand"
                ? "    "
                : options.tabs === "space"
                ? " "
                : "";
        } else if (/[\r\n\u0085\u2028\u2029]/u.test(character)) {
            output += options.multiline ? "\n" : " ";
            if (character === "\r" && value[index + 1] === "\n") index++;
        } else if (/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(character)) {
            // Direction controls can visually spoof identifiers even without terminal escapes.
        } else if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
            output += options.controls === "space" ? " " : "";
        } else output += character;
        index += length;
    }
    return output;
}

function skipCsi(value: string, index: number): number {
    while (index < value.length) {
        const code = value.charCodeAt(index++);
        if (code >= 0x40 && code <= 0x7e) return index;
    }
    return index;
}

function skipString(value: string, index: number, bellTerminates: boolean): number {
    while (index < value.length) {
        const code = value.charCodeAt(index++);
        if (code === 0x9c || (bellTerminates && code === 0x07)) return index;
        if (code === 0x1b && value.charCodeAt(index) === 0x5c) return index + 1;
    }
    return index;
}

/** Sanitized, collapsed and trimmed single-line display text. */
export function inlineText(value: string): string {
    return sanitizeDisplayText(value, { multiline: false, tabs: "space", controls: "space" })
        .replace(/\s+/gu, " ").trim();
}

/** Escape already-sanitized prose before interpolating it into Markdown structure. */
export function escapeMarkdownText(value: string): string {
    return value.replace(/[\\`*_{}\[\]()<>#+.!|~$-]/gu, "\\$&");
}

/** Cell/grapheme-safe clipping with the host's default overflow marker. */
export function clipText(value: string, width: number): string {
    const columns = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    return columns ? truncateToWidth(value, columns) : "";
}
