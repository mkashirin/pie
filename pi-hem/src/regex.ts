import { RRegex } from "rregex";

/** The Node entry point loads the packaged WASM synchronously from disk, never the network. */
export async function initializeRegex(): Promise<void> {}

/** Rust regex syntax (including inline flags); ranges are half-open UTF-16 offsets. */
export function findRegex(text: string, pattern: string): { start: number; end: number }[] {
    const regex = new RRegex(pattern);
    try {
        const offsets = new Map<number, number>([[0, 0]]);
        let bytes = 0;
        let units = 0;
        for (const character of text) {
            bytes += Buffer.byteLength(character, "utf8");
            units += character.length;
            offsets.set(bytes, units);
        }
        // Rust's iterator advances by Unicode scalar after empty matches, including at EOF.
        return regex.findAll(text).map(({ start, end }) => {
            const from = offsets.get(start);
            const to = offsets.get(end);
            if (from === undefined || to === undefined) {
                throw new Error("Regex returned a non-character boundary");
            }
            return { start: from, end: to };
        });
    } finally {
        regex.free();
    }
}
