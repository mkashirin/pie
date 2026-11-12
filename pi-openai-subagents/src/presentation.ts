import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
    clipText,
    type Component,
    escapeMarkdownText,
    Markdown,
    wrapProse,
} from "@pi-extensions/tui";
import { compactText } from "./activity.ts";
import type { LiveRunResult } from "./state.ts";

export const MAX_VISIBLE_RUNS = 8;

const clean = (value: unknown) => compactText(typeof value === "string" ? value : "");

/** Shared status colors; the editor fleet returns before any transcript details. No margins. */
export function compactRunLines(run: LiveRunResult, theme: Theme, fleet = false): string[] {
    const seconds = Math.floor(Math.max(0, run.durationMs) / 1000);
    const token = run.status === "failed"
        ? "error"
        : ["incomplete", "cancelled"].includes(run.status)
        ? "warning"
        : run.status === "complete"
        ? "success"
        : "muted";
    const name = theme.fg("accent", clean(run.agent));
    const status = theme.fg(token, clean(run.status));
    if (fleet) return [`${name} · ${status} · ${seconds}s`];
    const metadata = [
        `${name} · ${status}`,
        `Role: ${clean(run.profile)} · Model: ${clean(run.model)}`,
        `Elapsed: ${seconds}s · ${run.turns ?? 0} turns`,
    ];
    const preview = run.activity;
    const stageToken = preview?.stage === "failed"
        ? "error"
        : preview?.stage === "blocked"
        ? "warning"
        : preview?.stage === "succeeded"
        ? "success"
        : "accent";
    const stageIcon = preview?.stage === "succeeded"
        ? "✓ "
        : preview?.stage === "failed"
        ? "✗ "
        : "";
    const activity = preview
        ? [
            `${theme.fg(stageToken, stageIcon + clean(preview.stage))} · ${
                clean(preview.action)
            } · ${clean(preview.tool)}`,
            ...(preview.focus
                ? [
                    preview.tool === "bash" || preview.tool === "powershell"
                        ? theme.fg(
                            "toolTitle",
                            theme.bold(
                                `${preview.tool === "bash" ? "$" : "PS>"} ${clean(preview.focus)}`,
                            ),
                        )
                        : ["read", "edit", "write"].includes(preview.tool)
                        ? `${theme.fg("toolTitle", theme.bold(clean(preview.tool)))} ${
                            preview.tool === "read"
                                ? theme.fg("accent", clean(preview.focus).replace(/:\d+-\d+$/, ""))
                                    + theme.fg(
                                        "warning",
                                        clean(preview.focus).match(/:\d+-\d+$/)?.[0] ?? "",
                                    )
                                : theme.fg("accent", clean(preview.focus))
                        }`
                        : `Focus: ${clean(preview.focus)}`,
                ]
                : []),
            ...(preview.stage === "succeeded"
                ? ["tool reported success (not diff verification)"]
                : []),
        ]
        : [`Status: ${
            clean(run.reason ?? run.lastActivity ?? run.report?.summary ?? "awaiting model")
        }`];
    const diff = preview?.snippets.slice(0, 4).map((s) =>
        theme.fg(
            s.sign === "+" ? "toolDiffAdded" : "toolDiffRemoved",
            `${s.sign} ${clean(s.text)}`,
        )
    ) ?? [];
    // Snippets are bounded proposed changes, not a complete or verified diff. Leave bottom
    // padding to the host tool shell rather than adding a redundant trailing blank row.
    return [
        ...metadata,
        ...activity,
        ...(diff.length ? ["", theme.fg("muted", "..."), ...diff, theme.fg("muted", "...")] : []),
    ];
}

/** Escaping report prose prevents tool/model data from injecting headings, links or code fences. */
export function markdownText(value: string) {
    return escapeMarkdownText(clean(value));
}

function sourceLink(value: string) {
    const text = clean(value);
    try {
        const url = new URL(text);
        if (!["https:", "http:"].includes(url.protocol)) return markdownText(text);
        const href = url.href.replace(/[()<>\\"']/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
        return `[${markdownText(text)}](${href})`;
    } catch {
        return markdownText(text);
    }
}

/** Display only. reportText remains the authoritative model-facing JSON formatter. */
export function reportMarkdown(run: LiveRunResult): string {
    const md = markdownText;

    const list = (items: string[]) =>
        items.length ? items.map((x) => `- ${md(x)}`).join("\n") : "_None reported._";

    const ids = (items: string[]) => items.length ? items.map(md).join(", ") : "none";

    const report = run.report;
    const sections = [
        `## Summary\n\n${md(report?.summary ?? run.reason ?? "No final report available.")}`,
        ...(run.reason ? [`**Run limitation:** ${md(run.reason)}`] : []),
        `## Changes\n\n**Reported change status:** ${md(report?.changeStatus ?? "unknown")}\n\n${
            list(report?.changes ?? [])
        }`,
        `## Verification\n\n${list(report?.verification ?? [])}`,
        `## Findings\n\n${
            report?.findings.length
                ? report.findings.map((f) => `- **${md(f.severity)}** - ${md(f.text)}`).join("\n")
                : "_None reported; not a review certificate._"
        }`,
        ...(report?.contextRequests?.length
            ? [`## Context requests\n\n${
                report.contextRequests.map((request) =>
                    `- **${md(request.agent)}:** ${md(request.task)}\n  - ${md(request.reason)}`
                ).join("\n")
            }`]
            : []),
        `## Limitations\n\n${list(report?.limitations ?? [])}`,
        `## Claims & sources\n\n${
            report?.claims.length
                ? report.claims.map((c, i) =>
                    `### ${i + 1}. ${md(c.claim)}\n\n- **Evidence:** ${
                        ids(c.evidence)
                    }\n- **URLs:** ${
                        c.urls.length ? c.urls.map(sourceLink).join(", ") : "none"
                    }\n- **Date:** ${md(c.date) || "not reported"}\n- **Uncertainty:** ${
                        md(c.uncertainty) || "not reported"
                    }`
                ).join("\n\n")
                : "_No claims reported._"
        }`,
        `## Linked checks\n\n${
            report?.checks.length
                ? report.checks.map((c) =>
                    `- **${md(c.verdict)}** > ${md(c.target)}\n  - ${md(c.reason)}\n  - Evidence: ${
                        ids(c.evidence)
                    }`
                ).join("\n")
                : "_No linked checks reported._"
        }`,
        `## Evidence\n\n${
            run.evidence?.length
                ? run.evidence.map((e) =>
                    `- **${md(e.id)}** | ${md(e.tool)} | ${
                        e.isError ? "failed retrieval" : "retrieved (not proof)"
                    }\n  - ${md(e.inspection)} | ${md(e.retrievedAt)} | owner ${md(e.owner)}`
                ).join("\n")
                : "_No retrieval packets._"
        }`,
        `## Run metadata\n\n- **Run:** ${md(run.id)}\n- **Agent / profile:** ${md(run.agent)} / ${
            md(run.profile)
        }\n- **Model / thinking:** ${md(run.model)} / ${md(run.thinking)}\n- **Status:** ${
            md(run.status)
        } - completion does not imply independent review\n- **Task:** ${
            md(run.task)
        }\n- **Inputs:** ${ids(run.inputs ?? [])}\n- **Owned paths:** ${
            ids(run.writePaths ?? [])
        }\n- **Elapsed / turns:** ${
            Math.floor(run.durationMs / 1000)
        }s / ${run.turns}\n- **Mutation accounting:** ${
            run.changed ? "changes recorded" : "no changes recorded"
        }; shell effects ${
            run.uncertainShell ? "uncertain" : "not flagged"
        }\n- **Revision / review revision:** ${run.revision} / ${run.reviewRevision}\n- **Usage:** ${
            run.usage?.totalTokens ?? 0
        } tokens\n- **Report:** ${run.reportBytes} bytes${
            run.truncated ? "; model-facing text truncated" : ""
        }${run.normalization ? `\n- **Assignment note:** ${md(run.normalization)}` : ""}`,
    ];
    return sections.join("\n\n");
}

export class AgentCards implements Component {
    private reports: (Markdown | undefined)[] = [];

    constructor(private runs: LiveRunResult[], private theme: Theme, private expanded: boolean) {}

    invalidate() {
        this.reports = [];
    }

    render(width: number): string[] {
        width = Number.isFinite(width) ? Math.floor(width) : 0;
        if (width < 1) return [];
        const lines: string[] = [];
        const visible = this.expanded ? this.runs : this.runs.slice(0, MAX_VISIBLE_RUNS);
        visible.forEach((run, index) => {
            if (index && lines.at(-1) !== "") lines.push("");
            lines.push(
                ...compactRunLines(run, this.theme).flatMap((line) => wrapProse(line, width, ".")),
            );
            // Keep expensive settled report parsing/layout cached; the callback Markdown component
            // deliberately rebuilds each render. Acquire the active Markdown theme only when drawn.
            const report = this.expanded && run.status !== "running" && run.status !== "queued"
                ? this.reports[index] ??= new Markdown(
                    reportMarkdown(run),
                    0,
                    0,
                    getMarkdownTheme(),
                )
                : undefined;
            if (report) {
                if (lines.at(-1) !== "") lines.push("");
                lines.push(...report.render(width).map((line) => clipText(line, width)));
            }
        });
        if (visible.length < this.runs.length) {
            lines.push(clipText(`+${this.runs.length - visible.length} more runs`, width));
        }
        return lines;
    }
}
