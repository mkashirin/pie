import type { Theme } from "@earendil-works/pi-coding-agent";
import {
    type Component,
    hardWrapText,
    sanitizeDisplayText,
    ThemedText,
} from "@pi-extensions/pi-kit";
import { Value } from "typebox/value";
import { capText, type Packet, PacketSchema, packetText } from "./results.ts";

const diagnosticTextOptions = { multiline: true, tabs: "preserve" } as const;

interface Options {
    expanded?: boolean;
    isPartial?: boolean;
    outputPad?: number;
}
function diagnosticText(
    text: string,
    theme: Theme,
    color: "error" | "warning" | "success" | "muted" | "toolTitle",
    outputPad = 0,
): Component {
    return new ThemedText(() => sanitizeDisplayText(text, diagnosticTextOptions), {
        outputPad,
        // Severity is a display-row policy, independent of the packet outcome color.
        wrap: (text, width) =>
            hardWrapText(text, width).map((row) => {
                const severity = /: error:/.test(row)
                    ? "error"
                    : /: warning:|^Warning:/.test(row)
                    ? "warning"
                    : /: information:|: hint:/.test(row)
                    ? "muted"
                    : color;
                return theme.fg(severity, row);
            }),
    });
}
export function renderToolCall(
    tool: string,
    args: unknown,
    theme: Theme,
    _context?: unknown,
): Component {
    return diagnosticText(`${tool} ${JSON.stringify(args ?? {})}`, theme, "toolTitle");
}
export function renderResult(
    result: { details?: unknown; content?: readonly { type: string; text?: string }[] },
    options: Options,
    theme: Theme,
    _context?: unknown,
): Component {
    if (!Value.Check(PacketSchema, result.details)) {
        return diagnosticText(
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
            const flat = sanitizeDisplayText(value, diagnosticTextOptions).replace(/\s+/gu, " ");
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
    return diagnosticText(lines.join("\n"), theme, color, options.outputPad);
}
export function renderStatus(message: string, options: Options, theme: Theme): Component {
    return diagnosticText(message, theme, "muted", options.outputPad ?? 1);
}
