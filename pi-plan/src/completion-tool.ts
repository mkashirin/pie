import type { Theme } from "@earendil-works/pi-coding-agent";
import { PlanChatCard } from "./chat.ts";

export const PLAN_MODE_COMPLETE_TOOL_NAME = "plan_mode_complete";
export const PLAN_MODE_COMPLETE_VERSION = 1;
export const PLAN_MODE_MAX_CHARS = 50000;
export type PlanModeCompletionDetails = {
    version: typeof PLAN_MODE_COMPLETE_VERSION;
    source: typeof PLAN_MODE_COMPLETE_TOOL_NAME;
    plan: string;
};
export const PLAN_MODE_COMPLETE_PARAMS = {
    type: "object",
    additionalProperties: false,
    required: ["plan"],
    properties: {
        plan: {
            type: "string",
            minLength: 1,
            maxLength: PLAN_MODE_MAX_CHARS,
            description: "The complete decision-ready implementation plan in Markdown.",
        },
    },
} as const;

type NormalizePlanModeCompletionResult =
    | { ok: true; plan: string }
    | { ok: false; error: string };
export function normalizePlanModeCompletion(input: unknown): NormalizePlanModeCompletionResult {
    if (
        !input || typeof input !== "object" || Array.isArray(input)
        || !("plan" in input) || typeof input.plan !== "string"
    ) {
        return { ok: false, error: "Provide a Markdown plan as a string." };
    }
    if (input.plan.length > PLAN_MODE_MAX_CHARS) {
        return { ok: false, error: `The plan must be at most ${PLAN_MODE_MAX_CHARS} characters.` };
    }
    const plan = input.plan.trim();
    return plan
        ? { ok: true, plan }
        : { ok: false, error: "The plan must not be blank." };
}

export function planFromCompletionDetails(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const details = value as Record<string, unknown>;
    if (
        details.version !== PLAN_MODE_COMPLETE_VERSION
        || details.source !== PLAN_MODE_COMPLETE_TOOL_NAME
    ) return undefined;
    const parsed = normalizePlanModeCompletion(details);
    return parsed.ok ? parsed.plan : undefined;
}

export function planModeCompleted(plan: string) {
    const normalized = normalizePlanModeCompletion({ plan });
    if (!normalized.ok) throw new Error(normalized.error);
    return {
        content: [{ type: "text" as const, text: normalized.plan }],
        details: {
            version: PLAN_MODE_COMPLETE_VERSION,
            source: PLAN_MODE_COMPLETE_TOOL_NAME,
            plan: normalized.plan,
        },
        terminate: true,
    };
}

type PlanModeCompletionRenderResult = {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
};
export function planModeCompletionMarkdown(result: PlanModeCompletionRenderResult): string {
    return planFromCompletionDetails(result.details)
        ?? result.content.filter((part) => part.type === "text").map((part) => part.text ?? "")
            .join("\n");
}
export function renderPlanModeCompletion(
    result: PlanModeCompletionRenderResult,
    options: { isPartial: boolean },
    theme: Theme,
): PlanChatCard {
    return new PlanChatCard(
        "Plan",
        options.isPartial ? "Preparing the completed plan…" : planModeCompletionMarkdown(result),
        theme,
        options.isPartial ? "waiting" : "ready",
    );
}
