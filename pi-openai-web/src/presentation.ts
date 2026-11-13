import type { Theme } from "@earendil-works/pi-coding-agent";
import {
    type Component,
    sanitizeDisplayText,
    ThemedLines,
    ThemedText,
    wrapPreservingText,
} from "@pi-extensions/pi-kit";
import { Value } from "typebox/value";
import { type Packet, PacketSchema } from "./schemas.ts";

// Sanitize display copies only; evidence and provider coordinates remain untouched.
const evidenceText = { multiline: true, tabs: "preserve" } as const;

/** Command/status messages use the evidence policy and explicitly own their padding. */
export function renderStatus(text: string, outputPad = 1): Component {
    return new ThemedText(() => sanitizeDisplayText(text, evidenceText), {
        outputPad,
        wrap: wrapPreservingText,
    });
}

/** No framing: Pi's default tool shell owns margins and backgrounds. */
export function renderCall(heading: string, location: string, theme: Theme): Component {
    return new ThemedText(
        () =>
            theme.fg("toolTitle", theme.bold(sanitizeDisplayText(heading, evidenceText)))
            + (location
                ? ` ${theme.fg("accent", sanitizeDisplayText(location, evidenceText))}`
                : ""),
        { wrap: wrapPreservingText },
    );
}

function sourceLink(url: string): string {
    const safe = sanitizeDisplayText(url, evidenceText).replace(/[\r\n\t]/gu, " ");
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

export function renderPacket(
    details: unknown,
    fallback: string,
    theme: Theme,
    expanded: boolean,
): Component {
    // Pi-generated errors use details: {}; restored or transformed results may
    // also lack our schema. Validate once, not during every TUI render.
    const packet = Value.Check(PacketSchema, details) ? details : undefined;
    return new ThemedLines(
        () =>
            packet
                ? packetLines(packet, theme, expanded)
                : fallback
                ? ["", theme.fg("toolOutput", sanitizeDisplayText(fallback, evidenceText))]
                : [],
        { wrap: wrapPreservingText },
    );
}

function packetLines(packet: Packet, theme: Theme, expanded: boolean): string[] {
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
        theme.fg(
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
            theme.fg(
                "error",
                sanitizeDisplayText(`${packet.error.kind}: ${packet.error.message}`, evidenceText),
            ),
        );
    }
    if (packet.status === "running") {
        lines.push(
            ...packet.warnings.map((warning) =>
                theme.fg("muted", sanitizeDisplayText(warning, evidenceText))
            ),
        );
    }
    if (expanded) {
        for (const result of packet.results) {
            lines.push("");
            lines.push(
                theme.fg(
                    "accent",
                    sanitizeDisplayText(
                        `[${result.id}] ${result.query}: ${result.status}`,
                        evidenceText,
                    ),
                ),
            );
            if (result.error) {
                lines.push(
                    theme.fg("error", sanitizeDisplayText(result.error.message, evidenceText)),
                );
            }
            for (const segment of result.answerSegments) {
                lines.push(theme.fg("toolOutput", sanitizeDisplayText(segment.text, evidenceText)));
            }
            lines.push(
                ...queryWarnings(result).map((warning) =>
                    theme.fg(
                        "warning",
                        sanitizeDisplayText(`[${result.id}] ${warning}`, evidenceText),
                    )
                ),
            );
        }
        if (packet.evidence.length) lines.push("");
        for (const evidence of packet.evidence) {
            lines.push(
                `[${sanitizeDisplayText(evidence.id, evidenceText)}] ${sourceLink(evidence.url)}`,
            );
        }
        if (packet.page) {
            lines.push(
                "",
                theme.fg("accent", sourceLink(packet.page.finalUrl ?? packet.page.requestedUrl)),
            );
            for (const excerpt of packet.page.excerpts) {
                lines.push(
                    "",
                    theme.fg("accent", `Lines ${excerpt.startLine}-${excerpt.endLine}:`),
                    theme.fg("toolOutput", sanitizeDisplayText(excerpt.text, evidenceText)),
                );
            }
            for (const match of packet.page.matches) {
                lines.push(
                    sanitizeDisplayText(
                        `${match.line}:${match.column} ${match.text}`,
                        evidenceText,
                    ),
                );
            }
            lines.push(
                ...pageWarnings(packet.page).map((warning) =>
                    theme.fg("warning", sanitizeDisplayText(warning, evidenceText))
                ),
            );
        }
        lines.push(
            ...packet.warnings.map((warning) =>
                theme.fg("warning", sanitizeDisplayText(warning, evidenceText))
            ),
        );
        if (packet.truncation.text || packet.truncation.structured) {
            lines.push(theme.fg("warning", "Output truncated"));
        }
        lines.push(
            ...packet.truncation.omissions.map((omission) =>
                sanitizeDisplayText(`[omitted: ${omission}]`, evidenceText)
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
                    theme.fg("warning", sanitizeDisplayText(`Warning: ${warning}`, evidenceText))
                ),
            );
        }
        if (packet.page) {
            lines.push(
                sanitizeDisplayText(
                    `${
                        packet.page.title ?? packet.page.finalUrl ?? packet.page.requestedUrl
                    }: ${packet.page.totalLines} extracted lines`,
                    evidenceText,
                ),
            );
        }
        if (packet.evidence.length) {
            lines.push(
                theme.fg(
                    "muted",
                    `${packet.evidence.length} evidence records; expand for source links`,
                ),
            );
        }
    }
    if (packet.tool === "openai_search" && packet.status !== "running") {
        lines.push(
            theme.fg(
                "muted",
                `${
                    packet.usage
                        ? "Usage reported"
                        : "Usage unknown"
                }; native search fees ${packet.nativeSearchFees}`,
            ),
        );
    }
    return lines;
}
