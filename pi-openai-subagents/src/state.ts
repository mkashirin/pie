import { type Static, Type, type Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import type { ActivityPreview } from "./activity.ts";
import type { Profile, SessionSettings } from "./config.ts";
import { isSearchPacket } from "./search-packet.ts";

export const ReportSchema = Type.Object({
    summary: Type.String({ minLength: 1 }),
    changeStatus: Type.Union([
        Type.Literal("changed"),
        Type.Literal("none"),
        Type.Literal("unknown"),
    ]),
    changes: Type.Array(Type.String()),
    verification: Type.Array(Type.String()),
    findings: Type.Array(
        Type.Object({
            severity: Type.Union([
                Type.Literal("blocking"),
                Type.Literal("warning"),
                Type.Literal("info"),
            ]),
            text: Type.String({ minLength: 1 }),
        }),
    ),
    limitations: Type.Array(Type.String()),
    claims: Type.Array(
        Type.Object({
            claim: Type.String({ minLength: 1 }),
            evidence: Type.Array(Type.String()),
            urls: Type.Array(Type.String()),
            date: Type.String(),
            uncertainty: Type.String(),
        }),
    ),
    checks: Type.Array(Type.Object({
        target: Type.String(),
        verdict: Type.Union([
            Type.Literal("pass"),
            Type.Literal("blocked"),
            Type.Literal("insufficient"),
            Type.Literal("supported"),
            Type.Literal("contradicted"),
            Type.Literal("insufficient-evidence"),
        ]),
        reason: Type.String({ minLength: 1 }),
        evidence: Type.Array(Type.String()),
    })),
}, { additionalProperties: false });
export type Report = Static<typeof ReportSchema>;
export interface Evidence {
    id: string;
    owner: string;
    tool: string;
    retrievedAt: string;
    text: string;
    details: unknown;
    isError: boolean;
    inspection: "search" | "page-action";
}
export type RunStatus = "queued" | "running" | "complete" | "incomplete" | "failed" | "cancelled";
export interface RunResult {
    id: string;
    agent: string;
    profile: Profile;
    model: string;
    thinking: string;
    normalization?: string;
    status: RunStatus;
    task: string;
    inputs: string[];
    writePaths: string[];
    report?: Report;
    reason?: string;
    evidence: Evidence[];
    durationMs: number;
    usage: Usage;
    turns: number;
    lastActivity?: string;
    truncated: boolean;
    reportBytes: number;
    changed: boolean;
    uncertainShell: boolean;
    revision: number;
    reviewRevision: number;
    toolActivity: { tool: string; capability: string; isError: boolean }[];
}
// Activity exists only on live snapshot projections, never on ledger RunResult records.
export type LiveRunResult = RunResult & { activity?: ActivityPreview };
export interface Batch {
    results: LiveRunResult[];
    partial: boolean;
}
export interface ModeState {
    enabled: boolean;
    settings: SessionSettings;
    previous?: { model: string; thinking: string };
    applied?: { model: string; thinking: string };
    manualModel: boolean;
    manualThinking: boolean;
}
export const STATE_ENTRY = "pi-openai-subagents-state-v1";
export const EVIDENCE_ENTRY = "pi-openai-subagents-evidence-v1";
export const RUN_ENTRY = "pi-openai-subagents-runs-v1";

export function initialState(): ModeState {
    return { enabled: false, settings: {}, manualModel: false, manualThinking: false };
}

export function emptyUsage(): Usage {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}

export function addUsage(total: Usage, usage: Usage) {
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
        total[key] += usage[key] ?? 0;
    }
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
        total.cost[key] += usage.cost?.[key] ?? 0;
    }
}

export function capText(text: string, bytes = 50 * 1024) {
    if (Buffer.byteLength(text) <= bytes) return { text, truncated: false };
    const marker = "\n[Truncated; full report and evidence retained in tool-result details.]";
    const buffer = Buffer.from(text);
    let end = Math.max(0, bytes - Buffer.byteLength(marker));
    while ((buffer[end] & 0xc0) === 0x80) end--;
    return { text: `${buffer.subarray(0, end).toString("utf8")}${marker}`, truncated: true };
}

export function reportText(r: RunResult) {
    return JSON.stringify(
        {
            id: r.id,
            agent: r.agent,
            model: r.model,
            thinking: r.thinking,
            status: r.status,
            reason: r.reason,
            report: r.report,
            evidence: r.evidence.map((e) => ({
                id: e.id,
                tool: e.tool,
                retrievedAt: e.retrievedAt,
                isError: e.isError,
                inspection: e.inspection,
            })),
        },
        null,
        2,
    );
}

export function webPacket(
    owner: string,
    tool: string,
    result: {
        content?: { type: string; text?: string }[];
        details?: unknown;
        structuredContent?: unknown;
        isError?: boolean;
    },
    isError: boolean,
): Evidence {
    return {
        id: `evidence-${randomUUID()}`,
        owner,
        tool,
        retrievedAt: new Date().toISOString(),
        text: result.content?.filter((x) => x.type === "text").map((x) => x.text).join("\n") ?? "",
        details: result.details ?? result.structuredContent,
        isError: isError || result.isError === true,
        inspection: tool === "openai_search" ? "search" : "page-action",
    };
}

/** Validate the entire v1 packet before considering any successful query. */
export function successfulSearch(e: Evidence) {
    if (e.isError || e.tool !== "openai_search" || !isSearchPacket(e.details)) return false;
    const packet = e.details;
    if (
        !["success", "partial"].includes(packet.status) || packet.error !== undefined
        || packet.request.finishedAt === undefined || packet.nativeSearchFees !== "unknown"
    ) return false;
    return packet.results.some((result) =>
        result.ok && result.status === "success"
        && result.error === undefined
        && result.actions.some((action) =>
            action.type === "search" && action.status === "completed"
        )
        && result.answerSegments.some((segment) => segment.complete && !!segment.text.trim())
    );
}

type CheckKind = "review" | "research";
interface CheckOutcome {
    run: RunResult;
    index: number;
    successful: boolean;
}

function negativeCheckKind(verdict: Report["checks"][number]["verdict"]): CheckKind | undefined {
    if (verdict === "blocked" || verdict === "insufficient") return "review";
    if (verdict === "contradicted" || verdict === "insufficient-evidence") return "research";
}

function independentReport(run: RunResult) {
    return run.status === "complete" && run.report?.changeStatus === "none"
        && !run.changed && !run.uncertainShell
        && !run.report.findings.some((f) => f.severity === "blocking");
}

export class Ledger {
    runs = new Map<string, RunResult>();
    evidence = new Map<string, Evidence>();
    revision = 0;
    reminderUsed = false;
    workflow = "";

    constructor() {
        this.newWorkflow();
    }

    newWorkflow() {
        this.workflow = `workflow-${randomUUID()}`;
        this.reminderUsed = false;
    }

    putRun(run: RunResult) {
        this.runs.set(run.id, run);
        this.revision = Math.max(this.revision, run.revision);
        for (const e of run.evidence) this.evidence.set(e.id, e);
    }

    mutation(run?: RunResult) {
        this.revision++;
        if (run) {
            run.changed = true;
            run.revision = this.revision;
        }
    }

    inputs(ids: string[]) {
        return ids.map((id) => {
            const item = this.runs.get(id) ?? this.evidence.get(id);
            if (!item) throw new Error(`Unknown input ${id}; use IDs from this session branch`);
            if ("status" in item && ["running", "queued"].includes(item.status)) {
                throw new Error(`Input ${id} has not settled`);
            }
            return item;
        });
    }

    gaps(): string[] {
        const gaps: string[] = [];
        const runs = [...this.runs.values()];
        const positions = new Map(runs.map((r, index) => [r.id, index]));
        const reviewers = runs.filter((r) =>
            r.profile === "reviewer" && independentReport(r) && r.report?.verification.length
            && r.toolActivity.some((t) => !t.isError && ["read", "execute"].includes(t.capability))
            && r.reviewRevision >= this.revision
        );
        const validators = runs.filter((r) =>
            r.profile === "research-validator" && independentReport(r)
            && r.evidence.some((e) => e.owner === r.id && successfulSearch(e))
        );

        // Map insertion order is the branch's run chronology, not report prose or revision numbers.
        // A check may only resolve an earlier supplied run (or independently owned evidence).
        const linked = (r: RunResult, target: string) => {
            const position = positions.get(target);
            const evidence = this.evidence.get(target);
            return r.inputs.includes(target) && target !== r.id
                && (position !== undefined
                    ? position < positions.get(r.id)!
                        && !["queued", "running"].includes(this.runs.get(target)!.status)
                    : !!evidence && evidence.owner !== r.id);
        };

        const covered = (target: string, candidates: RunResult[], verdicts: string[]) =>
            candidates.some((r) =>
                linked(r, target)
                && r.report?.checks.some((c) => c.target === target && verdicts.includes(c.verdict))
            );

        const outcomes: Record<CheckKind, Map<string, CheckOutcome>> = {
            review: new Map(),
            research: new Map(),
        };
        const authorized: Record<CheckKind, Set<RunResult>> = {
            review: new Set(reviewers),
            research: new Set(validators),
        };
        runs.forEach((r, index) => {
            // Mixed/negative reports never provide a successful resolution, even for another target.
            const clean = !r.report?.checks.some((c) => negativeCheckKind(c.verdict));
            for (const c of r.report?.checks ?? []) {
                const negative = negativeCheckKind(c.verdict);
                if (negative) {
                    outcomes[negative].set(c.target, { run: r, index, successful: false });
                    continue;
                }
                if (c.verdict !== "pass" && c.verdict !== "supported") continue;
                const kind = c.verdict === "pass" ? "review" : "research";

                const knownEvidence = (id: string) =>
                    r.evidence.some((e) => e.id === id)
                    || r.inputs.some((input) =>
                        this.evidence.get(input)?.id === id
                        || this.runs.get(input)?.evidence.some((e) => e.id === id)
                    );

                const grounded = kind === "review"
                    || (c.evidence.length > 0 && c.evidence.every(knownEvidence));
                if (clean && grounded && authorized[kind].has(r) && linked(r, c.target)) {
                    outcomes[kind].set(c.target, { run: r, index, successful: true });
                }
            }
        });

        const resolved = (target: string, kind: CheckKind, after = -1) => {
            const outcome = outcomes[kind].get(target);
            return !!outcome?.successful && outcome.index > after;
        };

        const unresolved = new Set<RunResult>();
        for (const checks of Object.values(outcomes)) {
            for (const outcome of checks.values()) {
                if (!outcome.successful) unresolved.add(outcome.run);
            }
        }
        for (const r of runs) {
            if (
                r.profile === "worker"
                && (r.changed || r.uncertainShell || r.report?.changeStatus === "changed"
                    || r.report?.changeStatus === "unknown")
                && !resolved(r.id, "review", positions.get(r.id))
            ) {
                gaps.push(
                    `Review required for ${r.id} (${r.agent}); changes/side effects are unreviewed or review is stale`,
                );
            }
            if (
                r.profile === "researcher"
                && !covered(r.id, validators, [
                    "supported",
                    "contradicted",
                    "insufficient-evidence",
                ])
            ) gaps.push(`Independent research validation required for ${r.id}`);
            const kind: CheckKind = ["researcher", "research-validator"].includes(r.profile)
                ? "research"
                : "review";
            const blocking = r.report?.findings.some((f) => f.severity === "blocking")
                && !resolved(r.id, kind, positions.get(r.id));
            if (blocking || unresolved.has(r)) {
                gaps.push(
                    `Unresolved findings/limited support in ${r.id}; qualify or explain them`,
                );
            }
        }
        for (const e of this.evidence.values()) {
            if (
                e.owner.startsWith("workflow-") && !e.isError
                && !covered(e.id, validators, [
                    "supported",
                    "contradicted",
                    "insufficient-evidence",
                ])
            ) gaps.push(`Independent validation required for direct web evidence ${e.id}`);
        }
        return [...new Set(gaps)];
    }
}

export function restore(entries: SessionEntry[]): { mode: ModeState; ledger: Ledger } {
    let mode = initialState();
    const ledger = new Ledger();
    for (const entry of entries) {
        if (
            entry.type === "custom" && entry.customType === STATE_ENTRY
        ) {
            mode = structuredClone(entry.data as ModeState);
        }
        if (
            entry.type === "custom"
            && entry.customType === EVIDENCE_ENTRY
        ) {
            const e = entry.data as Evidence;
            ledger.evidence.set(e.id, e);
        }
        if (entry.type === "custom" && entry.customType === RUN_ENTRY) {
            for (const run of entry.data as RunResult[]) {
                ledger.putRun(run);
            }
        }
        if (
            entry.type === "message" && entry.message.role === "toolResult"
            && entry.message.toolName === "subagents_run"
        ) {
            const details = entry.message.details as Batch | undefined;
            if (details?.results) { for (const run of details.results) ledger.putRun(run); }
        }
    }
    return { mode, ledger };
}
