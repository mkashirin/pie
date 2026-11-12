import { PLAN_MODE_COMPLETE_TOOL_NAME, planFromCompletionDetails } from "./completion-tool.ts";
import {
    type ImplementationModelOverride,
    isPendingImplementationModelIdentifier,
} from "./implementation-models.ts";
import { messageTextContent, parseProposedPlan } from "./message-transform.ts";
import {
    IMPLEMENTATION_PLAN_RETENTIONS,
    IMPLEMENTATION_THINKING_LEVELS,
    type ImplementationPlanRetention,
    type PlanModeFixedThinkingLevel,
} from "./settings.ts";

export type { ImplementationModelOverride } from "./implementation-models.ts";
export {
    isPendingImplementationModelIdentifier,
    MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH,
} from "./implementation-models.ts";
export type PlanCompletionSource = typeof PLAN_MODE_COMPLETE_TOOL_NAME | "legacy_proposed_plan";
export interface ActiveImplementationPlan {
    id: string;
    plan: string;
    source: PlanCompletionSource;
    startedAt: number;
    retention?: ImplementationPlanRetention;
}
export interface SavedPlan {
    plan: string;
    source: PlanCompletionSource;
}
export interface ImplementationRuntimeSelection {
    model?: ImplementationModelOverride;
    thinkingLevel?: PlanModeFixedThinkingLevel;
}
export interface PendingImplementationRuntime extends ImplementationRuntimeSelection {
    version: 1;
}
export interface PlanModeWorkflowToolPolicy {
    kind: "automatic" | "explicit";
    desiredNames?: string[];
    allowedNames: string[];
    resolved: boolean;
}
export interface PlanModeState {
    enabled: boolean;
    latestPlan?: string;
    latestPlanSource?: PlanCompletionSource;
    awaitingAction: boolean;
    savedPlan?: SavedPlan;
    activeImplementation?: ActiveImplementationPlan;
    pendingImplementationRuntime?: PendingImplementationRuntime;
    selectedToolNames?: string[];
    selectedToolKeys?: string[];
    workflowToolPolicy?: PlanModeWorkflowToolPolicy;
    previousThinkingLevel?: PlanModeFixedThinkingLevel;
    appliedThinkingLevel?: PlanModeFixedThinkingLevel;
    manualThinkingLevel?: PlanModeFixedThinkingLevel;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
const source = (value: unknown): value is PlanCompletionSource =>
    value === PLAN_MODE_COMPLETE_TOOL_NAME || value === "legacy_proposed_plan";
const text = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0 && value.length <= 50000;
function names(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return [
        ...new Set(
            value.filter((name): name is string =>
                typeof name === "string" && !!name.trim() && name.length <= 4096
                && !/[\x00-\x1f\x7f]/u.test(name)
            ),
        ),
    ];
}
function level(value: unknown): PlanModeFixedThinkingLevel | undefined {
    return (IMPLEMENTATION_THINKING_LEVELS as readonly unknown[]).includes(value)
        ? value as PlanModeFixedThinkingLevel
        : undefined;
}
function saved(value: unknown): SavedPlan | undefined {
    const entry = object(value);
    return entry && text(entry.plan) && source(entry.source)
        ? { plan: entry.plan, source: entry.source }
        : undefined;
}
function active(value: unknown): ActiveImplementationPlan | undefined {
    const entry = object(value);
    const plan = saved(value);
    if (
        !entry || !plan || typeof entry.id !== "string" || !entry.id.trim()
        || entry.id.length > 4096 || typeof entry.startedAt !== "number"
        || !Number.isFinite(entry.startedAt) || entry.startedAt < 0
    ) return undefined;
    if (
        entry.retention !== undefined
        && !(IMPLEMENTATION_PLAN_RETENTIONS as readonly unknown[]).includes(entry.retention)
    ) return undefined;
    return {
        id: entry.id,
        ...plan,
        startedAt: entry.startedAt,
        ...(entry.retention === undefined
            ? {}
            : { retention: entry.retention as ImplementationPlanRetention }),
    };
}
function pending(value: unknown): PendingImplementationRuntime | undefined {
    const entry = object(value);
    if (!entry || entry.version !== 1) return undefined;
    const result: PendingImplementationRuntime = { version: 1 };
    if (entry.model !== undefined) {
        const model = object(entry.model);
        if (
            !model || !isPendingImplementationModelIdentifier(model.provider)
            || !isPendingImplementationModelIdentifier(model.modelId)
        ) return undefined;
        result.model = { provider: model.provider, modelId: model.modelId };
    }
    if (entry.thinkingLevel !== undefined) {
        const thinkingLevel = level(entry.thinkingLevel);
        if (!thinkingLevel) return undefined;
        result.thinkingLevel = thinkingLevel;
    }
    return result;
}
function policy(value: unknown): PlanModeWorkflowToolPolicy {
    const entry = object(value);
    const denied: PlanModeWorkflowToolPolicy = {
        kind: "automatic",
        allowedNames: [],
        resolved: true,
    };
    if (
        !entry || entry.kind !== "automatic" && entry.kind !== "explicit"
        || typeof entry.resolved !== "boolean"
    ) return denied;
    const allowedNames = names(entry.allowedNames);
    const desiredNames = names(entry.desiredNames);
    if (
        !allowedNames || !Array.isArray(entry.allowedNames)
        || allowedNames.length !== new Set(entry.allowedNames).size
        || entry.desiredNames !== undefined && !desiredNames
    ) return denied;
    return {
        kind: entry.kind,
        allowedNames,
        resolved: entry.resolved,
        ...(desiredNames === undefined ? {} : { desiredNames }),
    };
}
function snapshot(data: Record<string, unknown>): PlanModeState {
    const state: PlanModeState = { enabled: data.enabled === true, awaitingAction: false };
    for (const key of ["selectedToolNames", "selectedToolKeys"] as const) {
        const value = names(data[key]);
        if (value) state[key] = value;
    }
    if (data.workflowToolPolicy !== undefined) {
        state.workflowToolPolicy = policy(data.workflowToolPolicy);
    }
    for (
        const key of [
            "previousThinkingLevel",
            "appliedThinkingLevel",
            "manualThinkingLevel",
        ] as const
    ) {
        const value = level(data[key]);
        if (value) state[key] = value;
    }
    const latest = text(data.latestPlan) ? data.latestPlan : undefined;
    if (
        state.enabled && latest
        && (data.latestPlanSource === undefined || source(data.latestPlanSource))
    ) {
        state.latestPlan = latest;
        state.latestPlanSource = source(data.latestPlanSource)
            ? data.latestPlanSource
            : "legacy_proposed_plan";
        state.awaitingAction = data.awaitingAction === true;
    }
    if (!state.enabled) {
        const implementation = active(data.activeImplementation);
        if (implementation) {
            state.activeImplementation = implementation;
            const runtime = pending(data.pendingImplementationRuntime);
            if (runtime) state.pendingImplementationRuntime = runtime;
        } else {
            const savedPlan = saved(data.savedPlan);
            if (savedPlan) state.savedPlan = savedPlan;
        }
    }
    return state;
}

export function restorePlanModeState(entries: unknown[], stateEntryType: string): PlanModeState {
    let state: PlanModeState = { enabled: false, awaitingAction: false };
    for (const rawEntry of entries) {
        const entry = object(rawEntry);
        if (!entry) continue;
        if (entry.type === "custom" && entry.customType === stateEntryType) {
            const data = object(entry.data);
            // A malformed latest state must not leave an older workflow enabled.
            state = data ? snapshot(data) : { enabled: false, awaitingAction: false };
            continue;
        }
        if (!state.enabled || entry.type !== "message") continue;
        const message = object(entry.message);
        if (
            !message || message.isError || ["aborted", "error"].includes(String(message.stopReason))
        ) continue;
        let plan: string | undefined;
        let completionSource: PlanCompletionSource = PLAN_MODE_COMPLETE_TOOL_NAME;
        if (message.role === "toolResult" && message.toolName === PLAN_MODE_COMPLETE_TOOL_NAME) {
            plan = planFromCompletionDetails(message.details);
        } else if (message.role === "assistant") {
            const parsed = parseProposedPlan(messageTextContent(message));
            if (parsed.kind === "valid" && text(parsed.plan)) {
                plan = parsed.plan;
                completionSource = "legacy_proposed_plan";
            }
        }
        if (plan) {
            state.latestPlan = plan;
            state.latestPlanSource = completionSource;
            state.awaitingAction = true;
        }
    }
    return state;
}
