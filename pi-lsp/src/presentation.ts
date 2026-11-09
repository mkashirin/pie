import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { capText, type Packet, PacketSchema, packetText } from "./results.ts";

export function sanitizeControls(text: string): string {
    return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, "")
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
        .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu, "");
}
interface Options {
    expanded?: boolean;
    isPartial?: boolean;
    outputPad?: number;
}
class View implements Component {
    private text: string;
    private theme: Theme;
    private color: "error" | "warning" | "success" | "muted" | "toolTitle";
    private pad: number;
    constructor(
        text: string,
        theme: Theme,
        color: "error" | "warning" | "success" | "muted" | "toolTitle",
        pad = 0,
    ) {
        this.text = text;
        this.theme = theme;
        this.color = color;
        this.pad = pad;
    }
    invalidate() {}
    render(width: number): string[] {
        if (!Number.isFinite(width) || width < 1) return [];
        width = Math.floor(width);
        const pad = this.pad === 1 && width >= 3 ? " " : "";
        const budget = width - pad.length * 2;
        const rows: string[] = [];
        for (
            const line of sanitizeControls(this.text).replace(/\t/gu, "    ").split(/\r\n|\r|\n/u)
        ) {
            let row = "";
            let columns = 0;
            for (
                const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" })
                    .segment(line)
            ) {
                const cell = visibleWidth(segment) > budget ? "?" : segment;
                const size = visibleWidth(cell);
                if (columns + size > budget) {
                    rows.push(row);
                    row = "";
                    columns = 0;
                }
                row += cell;
                columns += size;
            }
            rows.push(row);
        }
        return rows.map((row) => {
            const color = /: error:/.test(row)
                ? "error"
                : /: warning:|^Warning:/.test(row)
                ? "warning"
                : /: information:|: hint:/.test(row)
                ? "muted"
                : this.color;
            return pad + this.theme.fg(color, row) + pad;
        });
    }
}
export function renderToolCall(
    tool: string,
    args: unknown,
    theme: Theme,
    _context?: unknown,
): Component {
    return new View(`${tool} ${JSON.stringify(args ?? {})}`, theme, "toolTitle");
}
export function renderResult(
    result: { details?: unknown; content?: readonly { type: string; text?: string }[] },
    options: Options,
    theme: Theme,
    _context?: unknown,
): Component {
    if (!Value.Check(PacketSchema, result.details)) {
        return new View(
            result.content?.map((c) => c.text ?? "").join("\n") ?? "",
            theme,
            "muted",
            options.outputPad,
        );
    }
    const packet = result.details;
    const color = packet.status === "failure"
        ? "error"
        : packet.warnings.length > 0 || packet.error
                || ["partial", "cancelled"].includes(packet.status) || packet.truncation.text
                || packet.truncation.structured
        ? "warning"
        : packet.status === "success"
        ? "success"
        : "muted";
    let text: string;
    if (options.expanded) {
        text = capText(packetText(packet), "[Details omitted from bounded view]").text;
    } else {
        let omitted = typeof packet.fix?.preview === "string";
        let count = 0;
        const diagnostics: string[] = [];
        const shorten = (value: string) => {
            const flat = sanitizeControls(value).replace(/\s+/gu, " ");
            if (flat.length <= 200) return flat;
            omitted = true;
            return flat.slice(0, 197) + "...";
        };
        const strip = (record: Packet["routes"][number]) => {
            for (const diagnostic of record.diagnostics ?? []) {
                if (++count > 8) {
                    omitted = true;
                    continue;
                }
                const single = {
                    ...record,
                    files: undefined,
                    complete: undefined,
                    error: undefined,
                    warnings: undefined,
                    diagnostics: [{ ...diagnostic, message: shorten(diagnostic.message) }],
                };
                const rendered = packetText({
                    ...packet,
                    summary: {},
                    error: undefined,
                    routes: [single],
                    warnings: [],
                    fix: undefined,
                    truncation: { text: false, structured: false, omissions: [] },
                });
                diagnostics.push(rendered.split("\n").slice(1).join("\n"));
            }
            return { ...record, diagnostics: undefined };
        };
        const routes = packet.routes.map((route) => ({
            ...strip(route),
            files: route.files?.map(strip),
        }));
        // Render coverage/errors/write outcomes before any diagnostic text. Never slice
        // diagnostic headers independently from their multiline message records.
        const overview = packetText({
            ...packet,
            routes,
            fix: packet.fix ? { ...packet.fix, preview: undefined } : undefined,
        });
        text = capText(overview, "[Details omitted from bounded view]").text;
        text += diagnostics.length ? "\n" + diagnostics.join("\n") : "";
        if (omitted) text += "\nExpand for more details";
    }
    const lines = [text];
    if (packet.truncation.text || packet.truncation.structured) {
        lines.push(
            packet.artifacts?.length
                ? "Output truncated; see artifacts"
                : "Output truncated; no artifact available",
        );
    }
    for (const artifact of packet.artifacts ?? []) lines.push(`Artifact: ${artifact.path}`);
    return new View(lines.join("\n"), theme, color, options.outputPad);
}
export function renderStatus(message: string, options: Options, theme: Theme): Component {
    return new View(message, theme, "muted", options.outputPad ?? 1);
}
