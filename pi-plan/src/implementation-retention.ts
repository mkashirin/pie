import { PLAN_MODE_COMPLETE_TOOL_NAME } from "./completion-tool.ts";
import {
    injectActiveImplementationContext,
    isEmptyAssistantMessage,
    messageContainsInactivePlanModeArtifact,
    messageContainsPlanModeImplementationContextArtifact,
    messageContainsPlanModeImplementationHandoff,
    PLAN_HISTORY_IMPLEMENTATION_PROMPT,
    stripPlanModeCompletionCallsFromMessage,
    stripProposedPlanBlocksFromMessage,
} from "./message-transform.ts";
import type { ImplementationPlanRetention } from "./settings.ts";
import type { ActiveImplementationPlan, PlanModeState } from "./state.ts";

export function retentionLabel(retention: ImplementationPlanRetention): string {
    switch (retention) {
        case "clear-on-start":
            return "Clear on start";
        case "clear-after-first-run":
            return "Clear after first run";
        case "keep":
            return "Keep";
    }
}
export function implementationRetentionPreview(retention: ImplementationPlanRetention): string {
    switch (retention) {
        case "clear-on-start":
            return "Supply the approved plan to the first implementation request, then clear its retained context.";
        case "clear-after-first-run":
            return "Retain the approved plan through the first implementation run, then clear it.";
        case "keep":
            return "Keep the approved plan in implementation context until explicitly cleared.";
    }
}
export interface ImplementationContextResult {
    messages: unknown[];
    clearActiveImplementationId?: string;
}
export interface ImplementationRetentionCoordinator {
    restore(activeImplementation: ActiveImplementationPlan | undefined): void;
    transformContext(messages: unknown[], state: PlanModeState): ImplementationContextResult;
    implementationSettled(
        activeImplementation: ActiveImplementationPlan | undefined,
    ): string | undefined;
    reset(): void;
}

function withoutPlanningArtifacts(messages: unknown[]): unknown[] {
    const result: unknown[] = [];
    for (const message of messages) {
        if (
            messageContainsInactivePlanModeArtifact(message)
            || messageContainsPlanModeImplementationContextArtifact(message)
        ) continue;
        const value = message as Record<string, unknown> | null;
        if (value?.role === "toolResult" && value.toolName === PLAN_MODE_COMPLETE_TOOL_NAME) {
            continue;
        }
        let cleaned = stripProposedPlanBlocksFromMessage(
            stripPlanModeCompletionCallsFromMessage(message),
        );
        if (messageContainsPlanModeImplementationHandoff(message)) {
            cleaned = { ...value, content: PLAN_HISTORY_IMPLEMENTATION_PROMPT };
        }
        if (!isEmptyAssistantMessage(cleaned)) result.push(cleaned);
    }
    return result;
}

export function createImplementationRetentionCoordinator(): ImplementationRetentionCoordinator {
    let currentId: string | undefined;
    let consumed = false;
    let settled = false;
    const reset = () => {
        currentId = undefined;
        consumed = false;
        settled = false;
    };
    const restore = (active: ActiveImplementationPlan | undefined) => {
        reset();
        currentId = active?.id;
    };
    return {
        restore,
        transformContext(messages, state) {
            if (state.enabled || state.awaitingAction) return { messages };
            const active = state.activeImplementation;
            if (active && active.id !== currentId) restore(active);
            const cleaned = withoutPlanningArtifacts(messages);
            if (!active || consumed) return { messages: cleaned };
            const transformed = injectActiveImplementationContext(cleaned, active);
            if (active.retention === "clear-on-start") {
                consumed = true;
                return { messages: transformed, clearActiveImplementationId: active.id };
            }
            return { messages: transformed };
        },
        implementationSettled(active) {
            // A run may settle after another implementation has restored its lifecycle.
            // Never let that stale completion reset or consume the replacement's retention.
            if (!active || active.id !== currentId || settled) return undefined;
            settled = true;
            if ((active.retention ?? "clear-after-first-run") !== "clear-after-first-run") {
                return undefined;
            }
            consumed = true;
            return active.id;
        },
        reset,
    };
}
