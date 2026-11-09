import { capText, type Evidence, type RunResult } from "./state.ts";

const MAX_PROMPT_INPUT_BYTES = 64 * 1024;
const MAX_EVIDENCE_ITEM_BYTES = 12 * 1024;
const MAX_EVIDENCE_TOTAL_BYTES = 32 * 1024;
const MAX_TASK_TEXT_BYTES = 4 * 1024;
const OMITTED_EVIDENCE_TEXT =
    "[Evidence text omitted from prompt; full evidence remains in parent result details.]";

type Input = RunResult | Evidence;

interface EvidenceBudget {
    usedBytes: number;
    seen: Set<string>;
}

function isRun(input: Input): input is RunResult {
    return "status" in input;
}

function compactEvidence(evidence: Evidence, budget: EvidenceBudget) {
    if (budget.seen.has(evidence.id)) {
        return { kind: "evidence-reference", id: evidence.id, repeated: true };
    }
    budget.seen.add(evidence.id);

    const remaining = MAX_EVIDENCE_TOTAL_BYTES - budget.usedBytes;
    const text = remaining < 128
        ? OMITTED_EVIDENCE_TEXT
        : capText(evidence.text, Math.min(MAX_EVIDENCE_ITEM_BYTES, remaining)).text;
    const textBytes = Buffer.byteLength(text);
    budget.usedBytes += textBytes;

    return {
        kind: "evidence",
        id: evidence.id,
        owner: evidence.owner,
        tool: evidence.tool,
        retrievedAt: evidence.retrievedAt,
        isError: evidence.isError,
        inspection: evidence.inspection,
        text,
        textTruncated: text !== evidence.text,
        // The human-readable text already carries answers, citations, URLs and page excerpts;
        // omit the duplicated provider packet/details from child prompt context.
        structuredDetailsOmitted: true,
    };
}

function compactToolActivity(run: RunResult) {
    const groups = new Map<
        string,
        { tool: string; capability: string; succeeded: number; failed: number }
    >();
    for (const activity of run.toolActivity) {
        const key = `${activity.tool}\u0000${activity.capability}`;
        const group = groups.get(key) ?? {
            tool: activity.tool,
            capability: activity.capability,
            succeeded: 0,
            failed: 0,
        };
        if (activity.isError) group.failed++;
        else group.succeeded++;
        groups.set(key, group);
    }
    return [...groups.values()];
}

function compactRun(run: RunResult, budget: EvidenceBudget) {
    return {
        kind: "run",
        id: run.id,
        agent: run.agent,
        profile: run.profile,
        status: run.status,
        ...(run.reason ? { reason: capText(run.reason, MAX_TASK_TEXT_BYTES).text } : {}),
        task: capText(run.task, MAX_TASK_TEXT_BYTES).text,
        inputs: run.inputs,
        writePaths: run.writePaths,
        changed: run.changed,
        uncertainShell: run.uncertainShell,
        ...(run.report ? { report: run.report } : {}),
        toolActivity: compactToolActivity(run),
        evidence: run.evidence.map((evidence) => compactEvidence(evidence, budget)),
    };
}

/** Build a prompt-only projection; the ledger and parent-visible results remain complete. */
export function formatPromptInputs(inputs: Input[]) {
    const budget: EvidenceBudget = { usedBytes: 0, seen: new Set() };
    const payload = {
        inputIds: inputs.map((input) => input.id),
        records: inputs.map((input) =>
            isRun(input)
                ? compactRun(input, budget)
                : compactEvidence(input, budget)
        ),
    };
    return capText(JSON.stringify(payload), MAX_PROMPT_INPUT_BYTES);
}
