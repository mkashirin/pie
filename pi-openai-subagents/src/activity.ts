import { inlineText as compactText, sanitizeDisplayText } from "@pi-extensions/pi-kit";
import type { Profile } from "./config.ts";

export type ActivityStage = "pending" | "running" | "succeeded" | "failed" | "blocked";
export interface ActivityPreview {
    readonly tool: string;
    readonly stage: ActivityStage;
    readonly action: string;
    readonly focus: string;
    readonly snippets: readonly { readonly sign: "-" | "+"; readonly text: string }[];
}

export { compactText };

// Plain presentation data only. Never extract assistant thinking, tool output or wrapper scripts.
const bounded = (value: unknown, max = 240) =>
    typeof value === "string" ? compactText(value.slice(0, 4096)).slice(0, max) : "";

const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? value as Record<string, unknown> : {};

/** Explicit schema adapters; unfamiliar tools show only their name, never arbitrary arguments. */
export function activityPreview(
    profile: Profile,
    tool: string,
    args: unknown,
    stage: ActivityStage,
    targets: readonly string[] = [],
): ActivityPreview {
    const v = object(args);
    const path = bounded(v.path ?? v.file_path ?? v.file);
    let action = "tool";
    let focus = "";
    const snippets: { sign: "-" | "+"; text: string }[] = [];

    const snippet = (sign: "-" | "+", value: unknown) => {
        if (typeof value !== "string") return;
        // Sanitize before splitting so multiline terminal-string payloads stay hidden.
        const display = sanitizeDisplayText(value.slice(0, 4096), {
            multiline: true,
            tabs: "space",
            controls: "space",
        });
        for (const line of display.split("\n").slice(0, 2)) {
            snippets.push({ sign, text: bounded(line, 160) || "(empty)" });
        }
    };

    if (profile === "worker" && ["edit", "write"].includes(tool)) {
        action = tool === "edit" ? "proposed edit" : "proposed write";
        focus = path;
        if (tool === "edit") {
            const first = object(Array.isArray(v.edits) ? v.edits[0] : v);
            snippet("-", first.oldText ?? first.old_string);
            snippet("+", first.newText ?? first.new_string);
            if (Array.isArray(v.edits) && v.edits.length > 1) {
                focus += ` | +${v.edits.length - 1} replacements`;
            }
        } else snippet("+", v.content);
    } else if (["bash", "powershell"].includes(tool) && ["worker", "reviewer"].includes(profile)) {
        action = profile === "reviewer" ? "verification command" : "command";
        focus = bounded(v.command);
    } else if (tool === "openai_search") {
        action = profile === "research-validator"
            ? "independent validation search"
            : "source search";
        const queries = Array.isArray(v.queries) ? v.queries : [];
        focus = bounded(queries[0]);
        if (queries.length > 1) focus += ` | +${queries.length - 1} queries`;
    } else if (tool === "web_action") {
        action = "source action";
        focus = [bounded(v.action ?? v.operation), bounded(v.url)].filter(Boolean).join(" | ");
    } else if (tool === "read") {
        action = profile === "reviewer" ? "inspection" : "read focus";
        // Reserve space for the complete window even when the input path is very long.
        focus = bounded(path, 200);

        const positiveInteger = (value: unknown, fallback: number) =>
            typeof value === "number" && Number.isSafeInteger(value) && value > 0
                ? value
                : fallback;

        const start = positiveInteger(v.offset, 1);
        const limit = positiveInteger(v.limit, 2000);
        const end = Math.min(Number.MAX_SAFE_INTEGER, start + limit - 1);
        focus += `:${start}-${end}`;
    } else if (["grep", "find", "symbol_search", "ast_grep_search"].includes(tool)) {
        action = "search focus";
        focus = [bounded(v.pattern ?? v.query), path].filter(Boolean).join(" | ");
    } else if (
        [
            "read_symbol",
            "read_enclosing",
            "lsp_navigation",
            "module_report",
            "lens_diagnostics",
            "ast_grep_outline",
        ].includes(tool)
    ) {
        action = profile === "reviewer" ? "inspection" : "symbol focus";
        focus = [bounded(v.operation), path, bounded(v.symbol ?? v.symbolName ?? v.name)].filter(
            Boolean,
        ).join(" | ");
        if (typeof v.line === "number") focus += `:${v.line}`;
    }
    if (profile === "research-validator") {
        action = `validate | ${action}`;
        if (targets.length) focus = `target ${bounded(targets[0], 80)} | ${focus}`;
    }
    return freezePreview({
        tool: bounded(tool, 80),
        stage,
        action,
        focus: bounded(focus),
        snippets,
    });
}

export function freezePreview(preview: ActivityPreview): ActivityPreview {
    return Object.freeze({
        ...preview,
        snippets: Object.freeze(preview.snippets.map((s) => Object.freeze({ ...s }))),
    });
}
