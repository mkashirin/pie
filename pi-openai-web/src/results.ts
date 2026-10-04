import type { Usage } from "@earendil-works/pi-ai";
import type { PageReadResult } from "./page/types.ts";
import type { Packet } from "./schemas.ts";
import type { SearchQueryResult } from "./search/types.ts";

export const TEXT_BYTES = 50 * 1024;
export const TEXT_LINES = 2000;
export const STRUCTURED_BYTES = 256 * 1024;
export const OMISSION = "[omitted: output limit]";

export function capText(
    text: string,
    bytes = TEXT_BYTES,
    lines = TEXT_LINES,
): { text: string; truncated: boolean } {
    if (Buffer.byteLength(text) <= bytes && text.split("\n").length <= lines) {
        return { text, truncated: false };
    }
    const suffix = `\n${OMISSION}`;
    const budget = Math.max(0, bytes - Buffer.byteLength(suffix));
    let retained = text.split("\n").slice(0, Math.max(0, lines - 1)).join("\n");
    if (Buffer.byteLength(retained) > budget) {
        let end = Math.min(retained.length, budget);
        while (Buffer.byteLength(retained.slice(0, end)) > budget) end--;
        if (end && /[\uD800-\uDBFF]/u.test(retained[end - 1])) end--;
        retained = retained.slice(0, end);
    }
    return { text: retained + suffix, truncated: true };
}

export function aggregateUsage(results: readonly { usage?: Usage }[]): Usage | undefined {
    const reported = results.flatMap((result) => result.usage ? [result.usage] : []);
    if (!reported.length) return undefined;
    const total: Usage = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    for (const usage of reported) {
        for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
            total[key] += usage[key];
        }
        for (const key of ["reasoning", "cacheWrite1h"] as const) {
            if (usage[key] !== undefined) total[key] = (total[key] ?? 0) + usage[key];
        }
        for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
            total.cost[key] += usage.cost[key];
        }
    }
    return total;
}

export function basePacket(tool: Packet["tool"], id: string): Packet {
    return {
        version: 1,
        tool,
        status: "running",
        request: { id, startedAt: Date.now() },
        results: [],
        evidence: [],
        nativeSearchFees: tool === "openai_search" ? "unknown" : "not_applicable",
        warnings: [],
        truncation: { text: false, structured: false, omissions: [] },
    };
}

export function attachSearch(packet: Packet, results: SearchQueryResult[], final = true): Packet {
    packet.results = results.map((result, i) => ({
        ...result,
        id: `${packet.request.id}:q${i + 1}`,
    }));
    packet.evidence = packet.results.flatMap((result) => [
        ...result.citations.map((citation, i) => ({
            id: `${result.id}:c${i + 1}`,
            queryId: result.id,
            kind: "citation" as const,
            url: citation.url,
            ...(citation.title === undefined ? {} : { title: citation.title }),
        })),
        ...result.sources.map((source, i) => ({
            id: `${result.id}:s${i + 1}`,
            queryId: result.id,
            kind: "source" as const,
            url: source.url,
        })),
    ]);
    if (final) {
        packet.request.finishedAt = Date.now();
        const successes = results.filter((result) => result.ok).length;
        packet.status = successes === results.length && successes > 0
            ? "success"
            : successes
            ? "partial"
            : "failure";
        packet.usage = aggregateUsage(results);
        if (packet.status === "failure") {
            packet.error = results[0]?.error
                ?? { kind: "incomplete", message: "No search result completed" };
        }
        if (results.some((result) => !result.usage)) {
            packet.warnings.push(
                "Token/cost usage is unavailable for one or more requests; totals include only reported usage.",
            );
        }
        packet.warnings.push(
            "Native web-search fees are unknown and are not included in Pi token/cost totals.",
        );
    }
    return packet;
}

export function attachPage(packet: Packet, page: PageReadResult): Packet {
    packet.page = page;
    packet.status = page.ok ? "success" : "failure";
    packet.request.finishedAt = Date.now();
    if (!page.ok) packet.error = page.error;
    return packet;
}

export function failPacket(
    packet: Packet,
    kind: NonNullable<Packet["error"]>["kind"],
    message: string,
): Packet {
    packet.status = "failure";
    packet.error = { kind, message };
    packet.request.finishedAt = Date.now();
    return packet;
}

function packetText(packet: Packet): string {
    const lines = [`${packet.tool} ${packet.status} [${packet.request.id}]`];
    if (packet.error) lines.push(`${packet.error.kind}: ${packet.error.message}`);
    // Put IDs and URLs before potentially large answer/excerpt bodies.
    for (const result of packet.results) {
        lines.push(
            `[${result.id}] ${result.status}: ${result.query} (${result.model.provider}/${result.model.id}, response=${
                result.responseId ?? "unavailable"
            }, retrieved=${new Date(result.finishedAt).toISOString()})`,
        );
    }
    for (const evidence of packet.evidence) {
        lines.push(
            `[${evidence.id}] ${evidence.url}${evidence.title ? ` — ${evidence.title}` : ""}`,
        );
    }
    for (const result of packet.results) {
        for (const action of result.actions) {
            lines.push(
                `Action ${action.id}: ${action.type ?? "unknown"} ${
                    action.url ?? action.queries?.join("; ") ?? ""
                } (${action.status})`,
            );
        }
    }
    if (packet.page) {
        const page = packet.page;
        lines.push(
            `Requested: ${page.requestedUrl}`,
            `Final: ${page.finalUrl ?? "unavailable"}`,
            `Retrieved: ${page.timestamp}`,
            `Title: ${page.title ?? "unavailable"}`,
            `Extracted lines: ${page.totalLines}; completeness: ${page.completeness}`,
        );
        if (page.no_match) lines.push("No match in retained extracted text.");
    }
    for (const warning of packet.warnings) lines.push(`Warning: ${warning}`);
    for (const result of packet.results) {
        lines.push(`\n[${result.id}] Answer (search synthesis, not a full-page read):`);
        lines.push(...result.answerSegments.map((segment) => segment.text));
        if (result.error) lines.push(`${result.error.kind}: ${result.error.message}`);
        lines.push(...result.warnings.map((warning) => `Warning: ${warning}`));
        if (result.truncation.answer || result.truncation.evidence) {
            lines.push("[omitted: native answer/evidence limit]");
        }
    }
    if (packet.page) {
        lines.push(
            ...packet.page.excerpts.map((excerpt) =>
                `Lines ${excerpt.startLine}-${excerpt.endLine}:\n${excerpt.text}`
            ),
        );
        lines.push(
            ...packet.page.matches.map((match) =>
                `Match ${match.line}:${match.column}: ${match.text}`
            ),
        );
        lines.push(...packet.page.warnings.map((warning) => `Warning: ${warning}`));
        if (packet.page.truncated) lines.push("[omitted: page extraction/match limit]");
    }
    lines.push(...packet.truncation.omissions.map((value) => `[omitted: ${value}]`));
    return lines.join("\n");
}

/** Trim content before identity/URL records. Every reduction has a retained omission marker. */
export function boundPacket(input: Packet): Packet {
    const packet = JSON.parse(JSON.stringify(input)) as Packet;

    const size = () => Buffer.byteLength(JSON.stringify(packet));

    const mark = (path: string) => {
        packet.truncation.structured = true;
        if (packet.truncation.omissions.length < 80) packet.truncation.omissions.push(path);
        else if (
            !packet.truncation.omissions.includes("additional fields (omission list capped)")
        ) packet.truncation.omissions.push("additional fields (omission list capped)");
    };

    if (size() <= STRUCTURED_BYTES) return packet;
    for (const result of packet.results) {
        for (const segment of result.answerSegments) {
            if (size() <= STRUCTURED_BYTES) return packet;
            segment.text = OMISSION;
            segment.truncated = true;
            result.truncation.answer = true;
            mark(`results[${packet.results.indexOf(result)}].answerSegments text`);
        }
    }
    if (packet.page) {
        for (const excerpt of packet.page.excerpts) {
            if (size() <= STRUCTURED_BYTES) return packet;
            excerpt.text = OMISSION;
            packet.page.truncated = true;
            packet.page.truncation.extracted = true;
            mark(`page.excerpts ${excerpt.startLine}-${excerpt.endLine} text`);
        }
        for (const match of packet.page.matches) {
            if (size() <= STRUCTURED_BYTES) return packet;
            match.text = OMISSION;
            packet.page.truncated = true;
            packet.page.truncation.matches = true;
            mark(`page.matches ${match.line}:${match.column} text`);
        }
    }

    // Prefer valid identities/URLs over descriptive text, but never exempt them from the cap.
    const shrinkStrings = (value: unknown, path: string) => {
        if (!value || typeof value !== "object") return;
        for (const [key, item] of Object.entries(value)) {
            if (size() <= STRUCTURED_BYTES) return;
            if (
                typeof item === "string" && item.length > 256
                && ![
                    "url",
                    "requestedUrl",
                    "finalUrl",
                    "id",
                    "responseId",
                    "queryId",
                    "actionId",
                    "itemId",
                ].includes(key)
            ) {
                (value as Record<string, unknown>)[key] = OMISSION;
                mark(`${path}.${key}`);
            } else if (typeof item === "object") shrinkStrings(item, `${path}.${key}`);
        }
    };

    shrinkStrings(packet, "packet");
    // If evidence identity alone exceeds the hard limit, retain a prefix with explicit counts.
    for (const result of [...packet.results].reverse()) {
        for (const field of ["answerSegments", "sources", "citations", "actions"] as const) {
            let omitted = 0;
            while (size() > STRUCTURED_BYTES && result[field].length) {
                result[field].pop();
                omitted++;
            }
            if (omitted) {
                result.truncation.evidence = true;
                mark(`results[${packet.results.indexOf(result)}].${field}: ${omitted} records`);
            }
        }
    }
    let omitted = 0;
    while (size() > STRUCTURED_BYTES - 256 && packet.evidence.length) {
        packet.evidence.pop();
        omitted++;
    }
    if (omitted) mark(`evidence: ${omitted} identity/URL records (identity alone exceeded limit)`);
    // Entire identity-bearing records are omitted, never silently rewritten into fake citations.
    omitted = 0;
    while (size() > STRUCTURED_BYTES && packet.results.length) {
        packet.results.pop();
        omitted++;
    }
    if (omitted) mark(`results: ${omitted} query identity/URL records`);
    if (packet.page) {
        for (const field of ["excerpts", "matches"] as const) {
            let count = 0;
            while (size() > STRUCTURED_BYTES && packet.page[field].length) {
                packet.page[field].pop();
                count++;
            }
            if (count) {
                packet.page.truncated = true;
                packet.page.truncation[field === "matches" ? "matches" : "extracted"] = true;
                mark(`page.${field}: ${count} records`);
            }
        }
    }
    // Root/page metadata has no enclosing record to discard. No special string key is unlimited.
    if (size() > STRUCTURED_BYTES) {
        const shrinkMetadata = (value: unknown, path: string) => {
            if (!value || typeof value !== "object") return;
            for (const [key, item] of Object.entries(value)) {
                if (path === "packet" && key === "truncation") continue;
                if (typeof item === "string" && Buffer.byteLength(JSON.stringify(item)) > 1024) {
                    (value as Record<string, unknown>)[key] = OMISSION;
                    mark(`${path}.${key}: oversized string omitted`);
                } else if (typeof item === "object") shrinkMetadata(item, `${path}.${key}`);
            }
        };

        shrinkMetadata(packet, "packet");
    }
    if (size() <= STRUCTURED_BYTES) return packet;
    // Pathological metadata/arrays (including escaped JSON controls and omission lists) still
    // must fit. This deliberately tiny, schema-valid fallback discloses the whole omission.
    const fallback = failPacket(
        basePacket(packet.tool, OMISSION),
        "incomplete",
        "Packet omitted because metadata alone exceeded the structured output limit",
    );
    fallback.truncation = {
        text: packet.truncation.text,
        structured: true,
        omissions: [
            ...packet.truncation.omissions.slice(0, 80).map((value) => capText(value, 512, 4).text),
            `Remaining packet omitted: ${packet.results.length} results, ${packet.evidence.length} evidence records, ${
                packet.page?.excerpts.length ?? 0
            } excerpts, ${
                packet.page?.matches.length ?? 0
            } matches; all request/page metadata, warnings and other fields omitted`,
        ],
    };
    return fallback;
}

export function toolResult(input: Packet, final = true) {
    let packet = boundPacket(input);
    let text = capText(packetText(packet));
    if (text.truncated) {
        packet.truncation.text = true;
        packet.truncation.omissions.push(
            "model-facing text: 50 KiB/2000 line limit; structured content may retain more",
        );
        // Appended markers count against the same hard cap as the original packet.
        packet = boundPacket(packet);
        text = capText(packetText(packet));
    }
    return {
        content: [{ type: "text" as const, text: text.text }],
        details: packet,
        structuredContent: packet,
        ...(final && packet.usage ? { usage: packet.usage } : {}),
        isError: packet.status === "failure",
    };
}
