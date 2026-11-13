import {
    type Component,
    type DefaultTextStyle,
    Markdown,
    type MarkdownTheme,
} from "@earendil-works/pi-tui";
import { sanitizeDisplayText } from "./text.ts";
import { wrapProse } from "./wrap.ts";

export interface PresentationOptions {
    /** Pi's horizontal outputPad setting (0 or 1). Widgets/tool-shell children default to 0. */
    outputPad?: number;
    wrap?: (text: string, width: number) => string[];
}

/** Unframed lines. Evaluate text/styles using the active callback theme on every render. */
export class ThemedLines implements Component {
    constructor(
        private lines: () => readonly string[],
        private options: PresentationOptions = {},
    ) {}

    invalidate() {}

    render(width: number): string[] {
        const columns = Number.isFinite(width) ? Math.floor(width) : 0;
        if (columns < 1) return [];
        const pad = this.options.outputPad === 1 && columns >= 3 ? " " : "";
        const wrap = this.options.wrap ?? wrapProse;
        return this.lines().flatMap((line) => wrap(line, columns - pad.length * 2))
            .map((line) => pad + line + pad);
    }
}

/** Same layout contract for a single (possibly multiline) styled string. */
export class ThemedText extends ThemedLines {
    constructor(text: () => string, options: PresentationOptions = {}) {
        super(() => [text()], options);
    }
}

/** Display-only Markdown; retain host caches until invalidated, with no shell/padding. */
export class ThemedMarkdown implements Component {
    private source?: string;
    private markdown?: Markdown;
    private cachedWidth?: number;
    private cachedRows?: string[];

    constructor(
        private text: () => string,
        private theme: () => MarkdownTheme,
        private style?: () => DefaultTextStyle,
    ) {}

    invalidate() {
        // A fresh host component acquires active theme/style callbacks on the next valid render.
        this.markdown = undefined;
        this.cachedRows = undefined;
    }

    render(width: number): string[] {
        const source = this.text();
        const columns = Number.isFinite(width) ? Math.floor(width) : 0;
        if (columns < 1) return [];
        if (!this.markdown || source !== this.source) {
            const text = sanitizeDisplayText(source, {
                multiline: true,
                tabs: "space",
                controls: "space",
            });
            if (this.markdown) this.markdown.setText(text);
            else this.markdown = new Markdown(text, 0, 0, this.theme(), this.style?.());
            this.source = source;
            this.cachedRows = undefined;
        }
        if (this.cachedRows && this.cachedWidth === columns) return this.cachedRows;
        this.cachedRows = this.markdown.render(columns)
            .flatMap((line) => wrapProse(line, columns));
        this.cachedWidth = columns;
        return this.cachedRows;
    }
}
