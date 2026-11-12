import {
    CURSOR_MARKER,
    parseKey,
    renderFakeCursor,
    sliceByColumn,
    visibleWidth,
} from "@earendil-works/pi-tui";
import { sanitizeDisplayText } from "../text.ts";
import type { InteractionKeybindings } from "../hints.ts";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const display = (text: string) => sanitizeDisplayText(text, { multiline: false, tabs: "space" });

/** Raw editor storage is separate from its sanitized, horizontally scrolled display projection. */
export class AnswerEditor {
    focused = false;
    private value = "";
    private cursor = 0;
    private paste: string | undefined;

    constructor(private keys: InteractionKeybindings) {}

    getValue() {
        return this.value;
    }
    setValue(value: string) {
        this.value = value;
        this.cursor = value.length;
        this.paste = undefined;
    }
    invalidate() {}

    private insert(text: string) {
        this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
        this.cursor += text.length;
    }

    handleInput(data: string) {
        // Paste delimiters can cross input events. Keep their payload byte-for-byte, including tabs.
        if (this.paste !== undefined || data.includes("\x1b[200~")) {
            const start = data.indexOf("\x1b[200~");
            this.paste = (this.paste ?? "") + (start >= 0 ? data.slice(start + 6) : data);
            const end = this.paste.indexOf("\x1b[201~");
            if (end >= 0) {
                const trailing = this.paste.slice(end + 6);
                this.insert(this.paste.slice(0, end));
                this.paste = undefined;
                if (trailing) this.handleInput(trailing);
            }
            return;
        }
        const is = (action: Parameters<InteractionKeybindings["matches"]>[1]) =>
            this.keys.matches(data, action);
        const before = [...graphemes.segment(this.value.slice(0, this.cursor))];
        const after = [...graphemes.segment(this.value.slice(this.cursor))];
        const previous = before.at(-1)?.segment.length ?? 0;
        const next = after[0]?.segment.length ?? 0;
        if (is("tui.editor.cursorLeft")) this.cursor -= previous;
        else if (is("tui.editor.cursorRight")) this.cursor += next;
        else if (is("tui.editor.cursorLineStart")) this.cursor = 0;
        else if (is("tui.editor.cursorLineEnd")) this.cursor = this.value.length;
        else if (is("tui.editor.deleteCharBackward")) {
            this.value = this.value.slice(0, this.cursor - previous)
                + this.value.slice(this.cursor);
            this.cursor -= previous;
        } else if (is("tui.editor.deleteCharForward")) {
            this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + next);
        } else if (is("tui.editor.deleteToLineStart")) {
            this.value = this.value.slice(this.cursor);
            this.cursor = 0;
        } else if (is("tui.editor.deleteToLineEnd")) this.value = this.value.slice(0, this.cursor);
        else if (is("tui.editor.deleteWordBackward")) {
            const prefix = this.value.slice(0, this.cursor).replace(/\s*\S+\s*$/u, "");
            this.value = prefix + this.value.slice(this.cursor);
            this.cursor = prefix.length;
        } else if (is("tui.input.newLine")) this.insert("\n");
        else if (!/[\x00-\x1f\x7f-\x9f]/u.test(data)) this.insert(data);
        else {
            const key = parseKey(data);
            if (key === "space") this.insert(" ");
            else if (
                key && [...graphemes.segment(key)].length === 1
                && !/[\x00-\x1f\x7f-\x9f]/u.test(key)
            ) this.insert(key);
        }
    }

    render(width: number, prompt = "> "): string[] {
        if (width < 1) return [];
        const prefix = sliceByColumn(prompt, 0, Math.max(0, width - 1), true);
        const room = width - visibleWidth(prefix);
        const left = display(this.value.slice(0, this.cursor));
        // Sanitize the complete buffer: a cursor inside a terminal string must not expose its tail.
        const right = display(this.value).slice(left.length);
        const offset = Math.max(0, visibleWidth(left) - room + 1);
        const visibleLeft = sliceByColumn(left, offset, room - 1, true);
        const cursor = [...graphemes.segment(right)][0]?.segment ?? " ";
        const cell = visibleWidth(cursor) <= room - visibleWidth(visibleLeft) ? cursor : " ";
        const tail = sliceByColumn(
            right.slice(cursor === " " && !right ? 0 : cursor.length),
            0,
            Math.max(0, room - visibleWidth(visibleLeft) - visibleWidth(cell)),
            true,
        );
        return [
            prefix + visibleLeft + (this.focused ? CURSOR_MARKER + renderFakeCursor(cell) : cell)
            + tail,
        ];
    }
}
