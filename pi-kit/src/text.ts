import { truncateToWidth } from "@earendil-works/pi-tui";

export interface DisplayTextOptions {
    multiline: boolean;
    tabs: "preserve" | "space" | "expand" | "remove";
    controls?: "space" | "remove";
}

/** Scan protocol spans without interpreting their payload as ordinary display text. */
function stripTerminalProtocol(value: string): string {
    let result = "";
    let index = 0;
    while (index < value.length) {
        const code = value.charCodeAt(index);
        const escape = code === 0x1b;
        const next = escape ? value.charCodeAt(index + 1) : code;
        const osc = escape ? next === 0x5d : code === 0x9d;
        const string = osc || (escape
            ? [0x50, 0x58, 0x5e, 0x5f].includes(next)
            : [0x90, 0x98, 0x9e, 0x9f].includes(code));
        if (string) {
            index += escape ? 2 : 1;
            // Newlines and nested introducers are payload, not a reason to expose the rest.
            while (index < value.length) {
                const char = value.charCodeAt(index++);
                if (char === 0x9c || (osc && char === 0x07)) break;
                if (char === 0x1b && value[index] === "\\") {
                    index++;
                    break;
                }
            }
        } else if ((escape && next === 0x5b) || code === 0x9b) {
            index += escape ? 2 : 1;
            // CSI parameters/intermediates may be unfinished. Never reveal their trailing bytes.
            while (index < value.length) {
                const char = value.charCodeAt(index);
                if (char >= 0x40 && char <= 0x7e) {
                    index++;
                    break;
                }
                if (char >= 0x20 && char <= 0x3f) {
                    index++;
                    continue;
                }
                if (char < 0x20 && char !== 0x1b) {
                    index++;
                    continue;
                }
                break;
            }
        } else if (escape) {
            index++;
            while (
                index < value.length && value.charCodeAt(index) >= 0x20
                && value.charCodeAt(index) <= 0x2f
            ) index++;
            const final = value.charCodeAt(index);
            if (final >= 0x30 && final <= 0x7e) index++;
        } else {
            result += value[index++];
        }
    }
    return result;
}

/** Remove terminal protocol payloads before interpreting ordinary display characters. */
export function sanitizeDisplayText(value: string, options: DisplayTextOptions): string {
    const clean = stripTerminalProtocol(value)
        .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
        .replace(/\r\n|[\r\n\u0085\u2028\u2029]/gu, options.multiline ? "\n" : " ")
        .replace(/\t/gu, { preserve: "\t", space: " ", expand: "    ", remove: "" }[options.tabs]);
    return clean.replace(
        /[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu,
        options.controls === "space" ? " " : "",
    );
}

/** A display copy only: callers retain their original IDs, editor buffers and answers. */
export function inlineText(value: string): string {
    return sanitizeDisplayText(value, { multiline: false, tabs: "space", controls: "space" })
        .replace(/\s+/gu, " ").trim();
}

export function sanitizeTerminalText(value: string): string {
    return sanitizeDisplayText(value, { multiline: true, tabs: "space" });
}

export function escapeMarkdownText(value: string): string {
    return value.replace(/[\\`*_{}\[\]()<>#+.!|~\-]/gu, "\\$&");
}

export function clipText(value: string, width: number): string {
    const columns = Number.isFinite(width) ? Math.floor(width) : 0;
    return columns > 0 ? truncateToWidth(value, columns) : "";
}
