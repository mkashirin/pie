/** Canonical terminal keys shared with the compatibility manifest. */
export type InputEvent = { type: "key"; key: string } | { type: "paste"; text: string };
const ESC = "\x1b";
const named: Record<number, string> = {
    9: "tab",
    10: "ctrl+j",
    13: "enter",
    27: "escape",
    32: "space",
    127: "backspace",
    57348: "insert",
    57349: "delete",
    57350: "left",
    57351: "right",
    57352: "up",
    57353: "down",
    57354: "pageup",
    57355: "pagedown",
    57356: "home",
    57357: "end",
};
function canonical(code: number, modifier = 1): string {
    const bits = modifier - 1;
    let key = named[code] ?? String.fromCodePoint(code);
    let shift = Boolean(bits & 1);
    if (shift && /^[a-z]$/i.test(key)) {
        key = key.toUpperCase();
        shift = false;
    }
    return [(bits & 4) ? "ctrl" : "", (bits & 2) ? "alt" : "", shift ? "shift" : "", key].filter(
        Boolean,
    ).join("+");
}
function ordinary(char: string): string {
    const n = char.codePointAt(0)!;
    if (named[n]) return named[n];
    if (n > 0 && n < 27) return `ctrl+${String.fromCharCode(n + 96)}`;
    if (n === 0) return "ctrl+space";
    if (n >= 28 && n <= 31) return `ctrl+${String.fromCharCode(n + 64)}`;
    return char === " " ? "space" : char;
}
/** Streaming strings preserve split CSI sequences, surrogate pairs and bracketed paste.
 * After feed(), callers should schedule flushEscape() after a short idle delay and cancel
 * that timer on new input. Never flush between chunks of a known transport fragment.
 */
export class InputDecoder {
    private pending = "";
    private paste = false;
    private pasteText = "";
    private discardCsi = false;
    /** Finalize only a pending lone ESC; incomplete CSI and paste remain buffered. */
    flushEscape(): InputEvent[] {
        if (this.pending !== ESC || this.paste || this.discardCsi) return [];
        this.pending = "";
        return [{ type: "key", key: "escape" }];
    }
    feed(data: string): InputEvent[] {
        this.pending += data;
        const events: InputEvent[] = [];
        const emit = (key: string) => events.push({ type: "key", key });
        while (this.pending) {
            if (this.discardCsi) {
                const end = this.pending.search(/[\x40-\x7e]/);
                this.pending = end < 0 ? "" : this.pending.slice(end + 1);
                if (end < 0) break;
                this.discardCsi = false;
                continue;
            }
            if (this.paste) {
                const end = this.pending.indexOf("\x1b[201~");
                if (end < 0) {
                    // Retain only a possible split terminator; all other bytes are literal text.
                    let keep = 0;
                    for (let n = 1; n < 6; n++) {
                        if (this.pending.endsWith("\x1b[201~".slice(0, n))) keep = n;
                    }
                    this.pasteText += this.pending.slice(0, this.pending.length - keep);
                    this.pending = keep ? this.pending.slice(-keep) : "";
                    break;
                }
                events.push({ type: "paste", text: this.pasteText + this.pending.slice(0, end) });
                this.pasteText = "";
                this.paste = false;
                this.pending = this.pending.slice(end + 6);
                continue;
            }
            if (this.pending.startsWith("\x1b[200~")) {
                this.pending = this.pending.slice(6);
                this.paste = true;
                continue;
            }
            if (this.pending.startsWith(ESC + "[") || this.pending.startsWith(ESC + "O")) {
                const match = /^\x1b(?:\[|O)([\x20-\x3f]*)([\x40-\x7e])/.exec(this.pending);
                if (!match) {
                    // Bound incomplete/invalid control strings without turning their tail into keys.
                    if (this.pending.length > 256 || /[^\x20-\x3f]/.test(this.pending.slice(2))) {
                        this.pending = this.pending.slice(2);
                        this.discardCsi = true;
                        continue;
                    }
                    break;
                }
                this.pending = this.pending.slice(match[0].length);
                if (!/^[0-9:;]*$/.test(match[1])) continue; // Unsupported private/intermediate CSI.
                const params = match[1].split(";");
                const value = Number(params[0].split(":")[0]);
                const modifier = Number((params[1] ?? "1").split(":")[0]);
                const final = match[2];
                if (params[1]?.split(":")[1] === "3") continue; // Kitty release
                if (final === "u") {
                    if (value <= 0x10ffff) emit(canonical(value, modifier));
                    continue;
                }
                if (final === "~" && value === 27 && params[2]) {
                    emit(canonical(Number(params[2]), modifier));
                    continue;
                }
                const arrows: Record<string, string> = {
                    A: "up",
                    B: "down",
                    C: "right",
                    D: "left",
                    H: "home",
                    F: "end",
                    Z: "shift+tab",
                };
                const tilde: Record<number, string> = {
                    1: "home",
                    2: "insert",
                    3: "delete",
                    4: "end",
                    5: "pageup",
                    6: "pagedown",
                    7: "home",
                    8: "end",
                };
                const key = final === "~" ? tilde[value] : arrows[final];
                if (key) {
                    const bits = modifier - 1;
                    emit(
                        [
                            bits & 4 ? "ctrl" : "",
                            bits & 2 ? "alt" : "",
                            bits & 1 ? "shift" : "",
                            key,
                        ].filter(Boolean).join("+"),
                    );
                }
                continue;
            }
            if (this.pending === ESC) break;
            const alt = this.pending.startsWith(ESC) && this.pending.length > 1;
            const start = alt ? 1 : 0;
            const cp = this.pending.codePointAt(start)!;
            if (cp >= 0xd800 && cp <= 0xdbff && this.pending.length === start + 1) break;
            const char = String.fromCodePoint(cp);
            this.pending = this.pending.slice(start + char.length);
            emit((alt ? "alt+" : "") + ordinary(char));
        }
        return events;
    }
}
/** Stateless convenience API; use InputDecoder for paste and fragmented transport input. */
export function decodeInput(data: string): string[] {
    const decoder = new InputDecoder();
    return [...decoder.feed(data), ...decoder.flushEscape()].flatMap((event) =>
        event.type === "key" ? [event.key] : Array.from(event.text, ordinary)
    );
}
