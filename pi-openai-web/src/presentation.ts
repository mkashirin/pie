import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { type Packet, PacketSchema } from "./schemas.ts";

/** Only terminal rendering sanitizes controls; returned evidence retains provider coordinates/text. */
export function sanitizeControls(text: string): string {
    return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu, "").replace(
        /[\u202a-\u202e\u2066-\u2069]/gu,
        "",
    );
}

/** Word-wrap without discarding evidence whitespace; hard-wrap overlong tokens. */
export function wrapWebText(text: string, width: number): string[] {
    width = Math.floor(width);
    if (!Number.isFinite(width) || width <= 0) return [];
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    // Unlike the host's wrapTextWithAnsi, preserve indentation, separator and
    // trailing spaces, and close/reopen OSC8 links on EVERY output row. Use host
    // visibleWidth for columns; prefer whitespace boundaries across ANSI runs.
    const parts = text.replace(/\t/gu, "    ").split(
        /(\x1b\[[0-9;:]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)|\r\n|\r|\n)/u,
    );
    const lines: string[] = [];
    let row = "";
    let columns = 0;
    let styles = "";
    let link = "";

    const finish = () => {
        // Specific attribute resets leave the host's background untouched.
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
                // Replay SGR in order, including selective resets and RGB codes.
                // A full reset makes older state redundant.
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
            // Styling/link boundaries inside a word must not create wrap points.
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

/** Command/status messages share the tool widgets' wrapping and sanitization policy. */
export class WebStatus implements Component {
    private text: string;
    private outputPad: number;

    constructor(text: string, outputPad = 1) {
        this.text = text;
        this.outputPad = outputPad;
    }

    invalidate() {}

    render(width: number): string[] {
        width = Math.floor(width);
        if (!Number.isFinite(width) || width <= 0) return [];
        // Pi supplies transcript padding; drop margins only when content would not fit.
        const pad = this.outputPad === 1 && width >= 3 ? " " : "";
        return wrapWebText(sanitizeControls(this.text), width - pad.length * 2)
            .map((line) => pad + line + pad);
    }
}

/** No framing: Pi's default tool shell owns margins and backgrounds. */
export class WebCall implements Component {
    private heading: string;
    private location: string;
    private theme: Theme;

    constructor(heading: string, location: string, theme: Theme) {
        this.heading = heading;
        this.location = location;
        this.theme = theme;
    }

    invalidate() {}

    render(width: number): string[] {
        return wrapWebText(
            this.theme.fg("toolTitle", this.theme.bold(sanitizeControls(this.heading)))
                + (this.location
                    ? ` ${this.theme.fg("accent", sanitizeControls(this.location))}`
                    : ""),
            width,
        );
    }
}

function sourceLink(url: string): string {
    const safe = sanitizeControls(url).replace(/[\r\n\t]/gu, " ");
    try {
        const parsed = new URL(url);
        if (["http:", "https:"].includes(parsed.protocol) && !/[\x00-\x20\x7f-\x9f]/u.test(url)) {
            return `\x1b]8;;${parsed.href}\x1b\\${safe}\x1b]8;;\x1b\\`;
        }
    } catch { /* Render malformed URLs as inert text. */ }
    return safe;
}

function collapsedWarnings(warnings: string[]): string[] {
    // Older packets and query results use different wording for the same fee
    // warning. Normalize only for display; keep structured evidence untouched.
    return [
        ...new Set(warnings.map((warning) =>
            warning
                    === "Native web-search fees are unknown and are not included in Pi token/cost totals."
                ? "Native web-search tool fees are unknown; reported usage covers Pi token costs only."
                : warning
        )),
    ];
}

function queryWarnings(result: Packet["results"][number]): string[] {
    return [
        ...new Set([
            ...result.warnings,
            ...(result.truncation.answer
                    || result.answerSegments.some((segment) => segment.truncated)
                ? ["Answer truncated"]
                : []),
            ...(result.answerSegments.some((segment) => !segment.complete)
                ? ["Answer incomplete"]
                : []),
            ...(result.truncation.evidence ? ["Evidence truncated"] : []),
            ...(result.ok && !result.citations.length ? ["No URL citations were returned"] : []),
            ...(!result.usage ? ["Usage unknown"] : []),
        ]),
    ];
}

function pageWarnings(page: NonNullable<Packet["page"]>): string[] {
    return [
        ...new Set([
            ...page.warnings,
            ...(page.truncated || Object.values(page.truncation).some(Boolean)
                ? ["Page evidence truncated"]
                : []),
            ...(page.completeness !== "complete" ? ["Page incomplete"] : []),
            ...(page.no_match
                ? [
                    page.completeness === "complete" && !page.truncated
                        && !Object.values(page.truncation).some(Boolean)
                        ? "No literal match in extracted text"
                        : "No literal match in incomplete text; absence is not conclusive",
                ]
                : []),
        ]),
    ];
}

export class WebView implements Component {
    private packet: Packet | undefined;
    private fallback: string;
    private theme: Theme;
    private expanded: boolean;

    constructor(packet: unknown, fallback: string, theme: Theme, expanded: boolean) {
        // Pi-generated errors use details: {}; restored or transformed results may
        // also lack our schema. Validate once, not during every TUI render, and
        // preserve their text rather than treating arbitrary details as a Packet.
        this.packet = Value.Check(PacketSchema, packet) ? packet : undefined;
        this.fallback = fallback;
        this.theme = theme;
        this.expanded = expanded;
    }

    invalidate() {}

    render(width: number): string[] {
        if (width <= 0) return [];
        if (!this.packet) {
            const wrapped = wrapWebText(
                this.theme.fg("toolOutput", sanitizeControls(this.fallback)),
                width,
            );
            return wrapped.length && this.fallback ? ["", ...wrapped] : [];
        }
        const packet = this.packet;
        const partial = packet.truncation.text || packet.truncation.structured
            || packet.results.some((result) =>
                result.truncation.answer || result.truncation.evidence
                || result.answerSegments.some((segment) => segment.truncated || !segment.complete)
            )
            || !!(packet.page && (packet.page.truncated
                || Object.values(packet.page.truncation).some(Boolean)
                || packet.page.completeness !== "complete"));
        const color = packet.status === "failure"
            ? "error"
            : packet.status === "partial" || partial
            ? "warning"
            : packet.status === "running"
            ? "muted"
            : "success";
        const lines = [
            "",
            this.theme.fg(
                color,
                `${packet.tool}: ${packet.status} (${
                    packet.page
                        ? Number(packet.page.ok)
                        : packet.results.filter((result) => result.ok).length
                }/${packet.request.queries?.length ?? (packet.page ? 1 : 0)})`,
            ),
        ];
        if (packet.error) {
            lines.push(
                this.theme.fg(
                    "error",
                    sanitizeControls(`${packet.error.kind}: ${packet.error.message}`),
                ),
            );
        }
        if (packet.status === "running") {
            lines.push(
                ...packet.warnings.map((warning) =>
                    this.theme.fg("muted", sanitizeControls(warning))
                ),
            );
        }
        if (this.expanded) {
            for (const result of packet.results) {
                lines.push("");
                lines.push(
                    this.theme.fg(
                        "accent",
                        sanitizeControls(`[${result.id}] ${result.query}: ${result.status}`),
                    ),
                );
                if (result.error) {
                    lines.push(this.theme.fg("error", sanitizeControls(result.error.message)));
                }
                for (const segment of result.answerSegments) {
                    lines.push(this.theme.fg("toolOutput", sanitizeControls(segment.text)));
                }
                lines.push(
                    ...queryWarnings(result).map((warning) =>
                        this.theme.fg("warning", sanitizeControls(`[${result.id}] ${warning}`))
                    ),
                );
            }
            if (packet.evidence.length) lines.push("");
            for (const evidence of packet.evidence) {
                lines.push(`[${sanitizeControls(evidence.id)}] ${sourceLink(evidence.url)}`);
            }
            if (packet.page) {
                lines.push(
                    "",
                    this.theme.fg(
                        "accent",
                        sourceLink(packet.page.finalUrl ?? packet.page.requestedUrl),
                    ),
                );
                for (const excerpt of packet.page.excerpts) {
                    lines.push(
                        "",
                        this.theme.fg("accent", `Lines ${excerpt.startLine}-${excerpt.endLine}:`),
                        this.theme.fg("toolOutput", sanitizeControls(excerpt.text)),
                    );
                }
                for (const match of packet.page.matches) {
                    lines.push(sanitizeControls(`${match.line}:${match.column} ${match.text}`));
                }
                lines.push(
                    ...pageWarnings(packet.page).map((warning) =>
                        this.theme.fg("warning", sanitizeControls(warning))
                    ),
                );
            }
            lines.push(
                ...packet.warnings.map((warning) =>
                    this.theme.fg("warning", sanitizeControls(warning))
                ),
            );
            if (packet.truncation.text || packet.truncation.structured) {
                lines.push(this.theme.fg("warning", "Output truncated"));
            }
            lines.push(
                ...packet.truncation.omissions.map((omission) =>
                    sanitizeControls(`[omitted: ${omission}]`)
                ),
            );
        } else {
            const warnings = [
                ...packet.warnings,
                ...packet.results.flatMap(queryWarnings),
                ...(packet.page ? pageWarnings(packet.page) : []),
                ...(partial ? ["Partial/truncated output"] : []),
                ...(packet.truncation.omissions.length ? ["Evidence omitted"] : []),
            ];
            if (warnings.length && packet.status !== "running") {
                lines.push(
                    ...collapsedWarnings(warnings).map((warning) =>
                        this.theme.fg("warning", sanitizeControls(`Warning: ${warning}`))
                    ),
                );
            }
            if (packet.page) {
                lines.push(
                    sanitizeControls(
                        `${
                            packet.page.title ?? packet.page.finalUrl ?? packet.page.requestedUrl
                        }: ${packet.page.totalLines} extracted lines`,
                    ),
                );
            }
            if (packet.evidence.length) {
                lines.push(
                    this.theme.fg(
                        "muted",
                        `${packet.evidence.length} evidence records; expand for source links`,
                    ),
                );
            }
        }
        if (packet.tool === "openai_search" && packet.status !== "running") {
            lines.push(
                this.theme.fg(
                    "muted",
                    `${
                        packet.usage
                            ? "Usage reported"
                            : "Usage unknown"
                    }; native search fees ${packet.nativeSearchFees}`,
                ),
            );
        }
        // Preserve whitespace within returned evidence text.
        return lines.flatMap((line) => wrapWebText(line, width));
    }
}
