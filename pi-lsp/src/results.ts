import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "typebox";

const nonempty = Type.String({ minLength: 1, pattern: "\\S" });
const selection = {
    root: Type.Optional(nonempty),
    server: Type.Optional(Type.Union([nonempty, Type.Array(nonempty, { minItems: 1 })])),
};
export const DiagnosticParams = Type.Object({
    ...selection,
    paths: Type.Optional(Type.Array(nonempty, { minItems: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
}, { additionalProperties: false });
export const FixParams = Type.Object({
    ...selection,
    server: Type.Optional(nonempty),
    path: nonempty,
    write: Type.Optional(Type.Boolean({ default: false })),
    kind: Type.Optional(Type.String({ minLength: 1, pattern: "\\S", default: "source.fixAll" })),
}, { additionalProperties: false });
const record = Type.Record(Type.String(), Type.Unknown());
const typedError = Type.Object({ kind: Type.String(), message: Type.String() });
const errorSchema = Type.Union([Type.String(), typedError]);
const position = Type.Object({
    line: Type.Integer({ minimum: 0 }),
    character: Type.Integer({ minimum: 0 }),
});
const range = Type.Object({ start: position, end: position });
const diagnostic = Type.Object({
    message: Type.String(),
    range: Type.Optional(range),
    severity: Type.Optional(Type.Integer()),
    code: Type.Optional(Type.Union([Type.String(), Type.Number()])),
    source: Type.Optional(Type.String()),
}, { additionalProperties: true });
const fileFields = {
    path: Type.Optional(Type.String()),
    uri: Type.Optional(Type.String()),
    complete: Type.Optional(Type.Boolean()),
    error: Type.Optional(errorSchema),
    warnings: Type.Optional(Type.Array(Type.String())),
    diagnostics: Type.Optional(Type.Array(diagnostic)),
};
const fileSchema = Type.Intersect([
    record,
    Type.Object(fileFields, { additionalProperties: true }),
]);
const editSchema = Type.Object({ range, newText: Type.String() }, { additionalProperties: true });
const fixSchema = Type.Intersect([
    record,
    Type.Object({
        error: Type.Optional(errorSchema),
        warnings: Type.Optional(Type.Array(Type.String())),
        kind: Type.Optional(Type.String()),
        changed: Type.Optional(Type.Boolean()),
        written: Type.Optional(Type.Boolean()),
        preview: Type.Optional(Type.String()),
        text: Type.Optional(Type.String()),
        edits: Type.Optional(Type.Array(editSchema)),
        actions: Type.Optional(
            Type.Array(Type.Object({ title: Type.String() }, { additionalProperties: true })),
        ),
        unsupportedActions: Type.Optional(
            Type.Array(Type.Object({ title: Type.String(), reason: Type.String() })),
        ),
    }, { additionalProperties: true }),
]);
export const PacketSchema = Type.Object({
    version: Type.Literal(1),
    tool: Type.Union([Type.Literal("lsp_diagnostics"), Type.Literal("lsp_fix")]),
    status: Type.Union([
        Type.Literal("running"),
        Type.Literal("success"),
        Type.Literal("partial"),
        Type.Literal("failure"),
        Type.Literal("cancelled"),
    ]),
    request: Type.Object({
        id: Type.String(),
        startedAt: Type.Number(),
        finishedAt: Type.Optional(Type.Number()),
        root: Type.Optional(Type.String()),
    }),
    error: Type.Optional(Type.Object({ kind: Type.String(), message: Type.String() })),
    artifactError: Type.Optional(typedError),
    routes: Type.Array(Type.Intersect([
        record,
        Type.Object({
            ...fileFields,
            server: Type.Optional(Type.String()),
            skipped: Type.Optional(Type.Boolean()),
            files: Type.Optional(Type.Array(fileSchema)),
        }, { additionalProperties: true }),
    ])),
    warnings: Type.Array(Type.String()),
    summary: Type.Record(Type.String(), Type.Number()),
    fix: Type.Optional(fixSchema),
    truncation: Type.Object({
        text: Type.Boolean(),
        structured: Type.Boolean(),
        omissions: Type.Array(Type.String()),
    }),
    artifacts: Type.Optional(Type.Array(Type.Object({
        path: Type.String(),
        kind: Type.Union([Type.Literal("report"), Type.Literal("preview")]),
        bytes: Type.Integer({ minimum: 0 }),
    }))),
}, { additionalProperties: false });
export type Packet = Static<typeof PacketSchema>;
export const TEXT_BYTES = 50 * 1024;
export const TEXT_LINES = 2000;
export const STRUCTURED_BYTES = 256 * 1024;
export function createPacket(tool: Packet["tool"], id: string, root?: string): Packet {
    return {
        version: 1,
        tool,
        status: "running",
        request: { id, startedAt: Date.now(), ...(root === undefined ? {} : { root }) },
        routes: [],
        warnings: [],
        summary: {},
        truncation: { text: false, structured: false, omissions: [] },
    };
}
export function capText(
    text: string,
    notice = "[omitted: output limit; full report in artifacts]",
): { text: string; truncated: boolean } {
    if (Buffer.byteLength(text) <= TEXT_BYTES && text.split("\n").length <= TEXT_LINES) {
        return { text, truncated: false };
    }
    const suffix = `\n${notice}`;
    let body = text.split("\n").slice(0, TEXT_LINES - 1).join("\n");
    let end = Math.min(body.length, TEXT_BYTES - Buffer.byteLength(suffix));
    while (Buffer.byteLength(body.slice(0, end)) > TEXT_BYTES - Buffer.byteLength(suffix)) end--;
    if (end && /[\uD800-\uDBFF]/u.test(body[end - 1])) end--;
    body = body.slice(0, end);
    return { text: body + suffix, truncated: true };
}
/** Human-readable view; protocol ranges remain untouched in structuredContent. */
export function packetText(packet: Packet): string {
    const lines = [
        `${packet.tool}: ${packet.status}`,
        Object.entries(packet.summary).map(([k, v]) => `${k}: ${v}`).join(", "),
    ];
    if (packet.error) lines.push(`${packet.error.kind}: ${packet.error.message}`);
    const records: Record<string, unknown>[] = packet.routes.flatMap(
        (route) => [route, ...(Array.isArray(route.files) ? route.files : [])],
    );
    for (const route of records) {
        const path = String(route.path ?? route.uri ?? route.server ?? "document");
        if (route.complete === false) {
            lines.push(`${path}: incomplete; retry diagnostics before assuming clean`);
        }
        if (route.error) {
            lines.push(
                `${path}: ${
                    typeof route.error === "string"
                        ? route.error
                        : (route.error as { message?: string }).message
                }`,
            );
        }
        if (Array.isArray(route.warnings)) {
            lines.push(...route.warnings.map((warning) => `${path}: Warning: ${String(warning)}`));
        }
        if (Array.isArray(route.diagnostics)) {
            for (const diagnostic of route.diagnostics) {
                const d = diagnostic as {
                    range?: { start?: { line?: number; character?: number } };
                    severity?: number;
                    message?: string;
                    path?: string;
                };
                const start = d.range?.start;
                const severity =
                    ({ 1: "error", 2: "warning", 3: "information", 4: "hint" } as Record<
                        number,
                        string
                    >)[d.severity ?? 0] ?? "diagnostic";
                lines.push(
                    `${d.path ?? path}:${(start?.line ?? 0) + 1}:${
                        (start?.character ?? 0) + 1
                    }: ${severity}: ${d.message ?? ""}`,
                );
            }
        }
    }
    if (packet.fix) {
        lines.push(
            `Fix: changed=${String(packet.fix.changed ?? "unknown")}, written=${
                String(packet.fix.written ?? "unknown")
            }; review the diff and rerun diagnostics`,
        );
    }
    if (packet.fix?.error) {
        lines.push(
            `Fix error: ${
                typeof packet.fix.error === "string" ? packet.fix.error : packet.fix.error.message
            }`,
        );
    }
    if (packet.fix?.warnings) {
        lines.push(...packet.fix.warnings.map((warning) => `Warning: ${warning}`));
    }
    if (typeof packet.fix?.preview === "string") lines.push(`Preview:\n${packet.fix.preview}`);
    lines.push(...packet.warnings.map((w) => `Warning: ${w}`));
    lines.push(...packet.truncation.omissions.map((omission) => `Omitted: ${omission}`));
    // Keep the committed outcome ahead of potentially enormous diagnostics/preview text.
    const outcome = lines.findIndex((line) => line.startsWith("Fix: changed="));
    if (outcome >= 0) lines.splice(1, 0, ...lines.splice(outcome, 1));
    return lines.filter(Boolean).join("\n");
}

// Bound bulky metadata without dropping semantic outcome keys. Full values stay in the artifact.
function compact(value: unknown, depth = 0, budget = { remaining: 180 }): unknown {
    if (typeof value === "string") {
        return value.length > 512
            ? value.slice(0, 512) + " [omitted]"
            : value;
    }
    if (!value || typeof value !== "object") return value;
    if (--budget.remaining < 0 || depth > 8) {
        const error = value as { kind?: unknown; message?: unknown };
        return typeof error.kind === "string" && typeof error.message === "string"
            ? { kind: error.kind.slice(0, 128), message: error.message.slice(0, 512) }
            : {};
    }
    if (Array.isArray(value)) {
        const kept = value.slice(0, Math.min(32, Math.max(0, budget.remaining)));
        return kept.map((v) => compact(v, depth + 1, budget));
    }
    // Typed errors have an order-independent canonical bounded representation.
    const error = value as { kind?: unknown; message?: unknown };
    if (typeof error.kind === "string" && typeof error.message === "string") {
        return { kind: error.kind.slice(0, 128), message: error.message.slice(0, 512) };
    }
    const entries: [string, unknown][] = [];
    for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        entries.push([key, (value as Record<string, unknown>)[key]]);
        if (entries.length >= 256) break;
    }
    const essential =
        /^(complete|completeness|error|errors|kind|message|changed|written|applied|status|path|server|cancelled|success)$/;
    const chosen: [string, unknown][] = [
        "complete",
        "completeness",
        "error",
        "errors",
        "kind",
        "message",
        "changed",
        "written",
        "applied",
        "status",
        "path",
        "server",
        "cancelled",
        "success",
    ].filter((key) => Object.hasOwn(value, key)).map((key) => [
        key,
        (value as Record<string, unknown>)[key],
    ]);
    if (depth < 2) chosen.push(...entries.filter(([k]) => !essential.test(k)).slice(0, 8));
    return Object.fromEntries(chosen.map(([k, v]) => [
        k.slice(0, 128),
        compact(v, depth + 1, budget),
    ]));
}

/** Retain the original report before constructing bounded views. Never rewrite an outcome. */
export async function finalizeResult(input: Packet): Promise<AgentToolResult<Packet>> {
    // Reconstruct the root: callers cannot smuggle undeclared fields into structuredContent.
    const clean = Object.fromEntries(
        [
            "version",
            "tool",
            "status",
            "request",
            "error",
            "artifactError",
            "routes",
            "warnings",
            "summary",
            "fix",
            "truncation",
            "artifacts",
        ].filter((key) => Object.hasOwn(input, key)).map((
            key,
        ) => [key, (input as unknown as Record<string, unknown>)[key]]),
    ) as Packet;
    let full = "";
    let serializationFailed = false;
    try {
        full = JSON.stringify(input, null, 2);
    } catch {
        serializationFailed = true;
    }
    let packet: Packet;
    try {
        packet = JSON.parse(JSON.stringify(clean)) as Packet;
    } catch {
        packet = {
            ...clean,
            request: {
                id: clean.request.id,
                startedAt: clean.request.startedAt,
                root: clean.request.root,
                finishedAt: clean.request.finishedAt,
            },
            routes: compact(clean.routes) as Packet["routes"],
            fix: clean.fix ? compact(clean.fix) as Packet["fix"] : undefined,
            error: clean.error
                ? { kind: clean.error.kind, message: clean.error.message }
                : undefined,
            artifactError: clean.artifactError
                ? { kind: clean.artifactError.kind, message: clean.artifactError.message }
                : undefined,
            truncation: { text: false, structured: true, omissions: [] },
            artifacts: undefined,
        };
        if (packet.fix) {
            packet.fix.changed = input.fix?.changed;
            packet.fix.written = input.fix?.written;
        }
    }
    let human = "";
    try {
        human = packetText(packet);
    } catch {
        serializationFailed = true;
        human = `${packet.tool}: ${packet.status}`;
    }
    const structuredTruncated = serializationFailed
        || Object.keys(input).some((key) => !Object.hasOwn(clean, key))
        || Buffer.byteLength(JSON.stringify(packet)) > STRUCTURED_BYTES;
    const textTruncated = capText(human).truncated;
    let notice = "";
    if (structuredTruncated || textTruncated) {
        let path: string | undefined;
        delete packet.artifacts;
        try {
            if (serializationFailed) throw new Error("Report metadata could not be serialized");
            const dir = await mkdtemp(join(tmpdir(), "pi-lsp-"));
            const candidate = join(dir, "report.json");
            await writeFile(candidate, full, { mode: 0o600 });
            path = candidate;
            packet.artifacts = [{ path, kind: "report", bytes: Buffer.byteLength(full) }];
        } catch (error) {
            packet.warnings.push(
                `ArtifactError: ${
                    String(error).slice(0, 512)
                }; omitted details unavailable (no artifact)`,
            );
            // Artifact reporting must not replace the operation's original status/error/write outcome.
            packet.artifactError = { kind: "ArtifactError", message: String(error).slice(0, 512) };
        }
        packet.truncation = {
            text: textTruncated,
            structured: structuredTruncated,
            omissions: [
                path
                    ? "Full details retained in private report artifact"
                    : "Details omitted; artifact creation failed; no artifact available",
            ],
        };
        notice = path
            ? `[Output truncated; full report: ${path}]`
            : "[Output truncated; ArtifactError: no artifact available; details omitted]";
        if (structuredTruncated || Buffer.byteLength(JSON.stringify(packet)) > STRUCTURED_BYTES) {
            packet.truncation.structured = true;
            packet.request = { ...packet.request, id: packet.request.id.slice(0, 256) };
            // Request metadata also has a closed shape in the bounded view.
            packet.request = {
                id: packet.request.id,
                startedAt: packet.request.startedAt,
                ...(packet.request.finishedAt === undefined
                    ? {}
                    : { finishedAt: packet.request.finishedAt }),
                ...(packet.request.root === undefined ? {} : { root: packet.request.root }),
            };
            if (packet.request.root) packet.request.root = packet.request.root.slice(0, 2048);
            const importantCounts =
                /^(routes|completeRoutes|files|completeFiles|diagnostics|errors|warnings|information|hints|changed|written)$/;
            const allCounts = Object.entries(packet.summary);
            const summaryEntries = [
                ...allCounts.filter(([key]) => importantCounts.test(key)),
                ...allCounts.filter(([key]) => !importantCounts.test(key)),
            ];
            packet.summary = Object.fromEntries(
                summaryEntries.slice(0, 64).map(([key, count], index) => [
                    key.length > 128
                        ? `${key.slice(0, 112)}[omitted:${index}]`
                        : key,
                    count,
                ]),
            );
            packet.truncation.omissions.push(
                `Metadata, keys, diagnostics and coverage may be abbreviated; routes=${input.routes.length}, summary entries=${summaryEntries.length}; ${
                    path
                        ? "full per-file completeness/errors and counts are in the report"
                        : "omitted details unavailable: no artifact"
                }`,
            );
            packet.warnings = compact(packet.warnings) as string[];
            packet.warnings.push(
                "Coverage omitted or abbreviated; retained files do not establish complete coverage",
            );
            packet.routes = (compact(packet.routes) as Packet["routes"]).map((route) => {
                delete route.files;
                delete route.diagnostics;
                return route;
            });
            if (packet.fix) {
                packet.fix = compact(packet.fix) as NonNullable<Packet["fix"]>;
                delete packet.fix.actions;
                delete packet.fix.edits;
                delete packet.fix.unsupportedActions;
                packet.fix.changed = input.fix?.changed;
                packet.fix.written = input.fix?.written;
            }
            if (packet.error) packet.error = compact(packet.error) as Packet["error"];
            if (packet.artifactError) {
                packet.artifactError = {
                    kind: "ArtifactError",
                    message: packet.artifactError.message.slice(0, 512),
                };
            }
            // Further reduce detail, keeping every retained route's outcome fields.
            if (Buffer.byteLength(JSON.stringify(packet)) > STRUCTURED_BYTES) {
                packet.routes = packet.routes.map((route) =>
                    Object.fromEntries(
                        Object.entries(route).filter(([k]) =>
                            /^(complete|completeness|error|errors|changed|written|status|path|server)$/
                                .test(k)
                        ),
                    )
                );
            }
        }
        if (Buffer.byteLength(JSON.stringify(packet)) > STRUCTURED_BYTES) {
            packet.truncation.structured = true;
            packet.routes = [];
            packet.warnings = [
                "Route/file coverage and detailed errors omitted; consult full report",
            ];
            if (packet.fix) {
                packet.fix = Object.fromEntries(
                    ["changed", "written", "status", "error"].filter((key) => key in packet.fix!)
                        .map((key) => {
                            const value = input.fix![key];
                            return [
                                key,
                                typeof value === "boolean" || typeof value === "number"
                                    ? value
                                    : JSON.stringify(compact(value))?.slice(0, 512) ?? "[omitted]",
                            ];
                        }),
                );
            }
            packet.truncation.omissions.push(
                `All ${input.routes.length} route records omitted from bounded view; no clean-file inference is valid`,
            );
        }
    }
    const text = capText(notice ? `${human}\n${notice}` : human, notice || undefined);
    packet.truncation.text ||= text.truncated;
    return {
        content: [{ type: "text", text: text.text }],
        details: packet,
        structuredContent: packet as unknown as JsonValue,
        isError: ["partial", "failure", "cancelled"].includes(packet.status),
    };
}
