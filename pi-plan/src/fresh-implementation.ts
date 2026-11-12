import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { isPendingImplementationModelIdentifier } from "./implementation-models.ts";
import { PLAN_HISTORY_IMPLEMENTATION_PROMPT } from "./message-transform.ts";
import {
    IMPLEMENTATION_PLAN_RETENTIONS,
    IMPLEMENTATION_THINKING_LEVELS,
    type ImplementationPlanRetention,
} from "./settings.ts";
import type {
    ImplementationRuntimeSelection,
    PlanCompletionSource,
    PlanModeState,
} from "./state.ts";

export interface FreshImplementationRequest {
    plan: string;
    source: PlanCompletionSource;
    retention: ImplementationPlanRetention;
    stateEntryType: string;
    runtime?: ImplementationRuntimeSelection;
    isCurrent(): boolean;
}
interface FreshImplementationFromStateOptions {
    getState(): PlanModeState;
    menuIsCurrent(): boolean;
    retention: ImplementationPlanRetention;
    stateEntryType: string;
    runtime?: ImplementationRuntimeSelection;
}
export type FreshImplementationResult =
    | { kind: "started" }
    | { kind: "cancelled" }
    | { kind: "partial" }
    | { kind: "rejected" }
    | { kind: "stale" };

export function formatImplementationHandoff(plan: string): string {
    return `${PLAN_HISTORY_IMPLEMENTATION_PROMPT}\n\n${plan}`;
}
export function formatHistoryImplementationPrompt(): string {
    return PLAN_HISTORY_IMPLEMENTATION_PROMPT;
}
export function formatTransferredPlanPrompt(plan: string, fresh: boolean): string {
    return fresh ? formatImplementationHandoff(plan) : formatHistoryImplementationPrompt();
}

export async function startFreshImplementationFromState(
    ctx: ExtensionContext,
    options: FreshImplementationFromStateOptions,
): Promise<FreshImplementationResult> {
    if (!options.menuIsCurrent()) return { kind: "stale" };
    if (
        !("newSession" in ctx) || typeof ctx.newSession !== "function"
        || !("waitForIdle" in ctx) || typeof ctx.waitForIdle !== "function"
    ) {
        ctx.ui.notify(
            "Fresh implementation requires a command-capable session context.",
            "warning",
        );
        return { kind: "rejected" };
    }
    const state = options.getState();
    const chosen = state.awaitingAction && state.latestPlan && state.latestPlanSource
        ? { plan: state.latestPlan, source: state.latestPlanSource }
        : state.savedPlan ?? state.activeImplementation;
    if (!chosen) return { kind: "rejected" };
    const isCurrent = () => {
        if (!options.menuIsCurrent()) return false;
        const latest = options.getState();
        const candidate = latest.awaitingAction
            ? { plan: latest.latestPlan, source: latest.latestPlanSource }
            : latest.savedPlan ?? latest.activeImplementation;
        return candidate?.plan === chosen.plan && candidate?.source === chosen.source;
    };
    return startFreshImplementationSession(ctx as ExtensionCommandContext, {
        ...chosen,
        retention: options.retention,
        stateEntryType: options.stateEntryType,
        runtime: options.runtime,
        isCurrent,
    });
}

export async function startFreshImplementationSession(
    ctx: ExtensionCommandContext,
    request: FreshImplementationRequest,
): Promise<FreshImplementationResult> {
    if (!request.isCurrent() || ctx.signal?.aborted) return { kind: "stale" };
    if (
        !request.plan.trim() || request.plan.length > 50000 || !request.stateEntryType.trim()
        || !["plan_mode_complete", "legacy_proposed_plan"].includes(request.source)
        || !(IMPLEMENTATION_PLAN_RETENTIONS as readonly string[]).includes(request.retention)
    ) {
        return { kind: "rejected" };
    }
    // Copy mutable caller data before the first await. Invalid runtime selections never create a session.
    const runtime = request.runtime && {
        ...(request.runtime.model ? { model: { ...request.runtime.model } } : {}),
        ...(request.runtime.thinkingLevel ? { thinkingLevel: request.runtime.thinkingLevel } : {}),
    };
    if (
        runtime?.model && (!isPendingImplementationModelIdentifier(runtime.model.provider)
            || !isPendingImplementationModelIdentifier(runtime.model.modelId))
    ) return { kind: "rejected" };
    if (
        runtime?.thinkingLevel
        && !(IMPLEMENTATION_THINKING_LEVELS as readonly string[]).includes(runtime.thinkingLevel)
    ) return { kind: "rejected" };
    const plan = request.plan;
    const source = request.source;
    const retention = request.retention;
    const stateEntryType = request.stateEntryType;
    let replacementEntered = false;
    let replacementPrepared = false;
    let delivered = false;
    let stale = false;
    try {
        if (ctx.hasPendingMessages()) return { kind: "rejected" };
        await ctx.waitForIdle();
        if (!request.isCurrent() || ctx.signal?.aborted) return { kind: "stale" };
        if (!ctx.isIdle() || ctx.hasPendingMessages()) return { kind: "rejected" };
        const parentSession = ctx.sessionManager.getSessionFile();
        const state: PlanModeState = {
            enabled: false,
            awaitingAction: false,
            activeImplementation: {
                id: `implementation:${randomUUID()}`,
                plan,
                source,
                startedAt: Date.now(),
                retention,
            },
            ...(runtime ? { pendingImplementationRuntime: { version: 1, ...runtime } } : {}),
        };
        const result = await ctx.newSession({
            parentSession,
            setup: async (manager) => {
                if (!request.isCurrent() || ctx.signal?.aborted) {
                    stale = true;
                    throw new DOMException(
                        "Fresh handoff owner is no longer current",
                        "AbortError",
                    );
                }
                manager.appendCustomEntry(stateEntryType, state);
                replacementPrepared = true;
            },
            withSession: async (replacement) => {
                replacementEntered = true;
                // The old workflow is intentionally invalidated by session_shutdown. Never use its
                // ownership predicate or session-bound context after this boundary.
                if (
                    !replacement.isIdle() || replacement.hasPendingMessages()
                    || replacement.signal?.aborted
                ) return;
                await replacement.sendUserMessage(formatTransferredPlanPrompt(plan, true));
                delivered = true;
            },
        });
        if (result.cancelled) return { kind: "cancelled" };
        return { kind: delivered ? "started" : "partial" };
    } catch (error) {
        // Once setup has prepared replacement state, the host may have invalidated the old
        // context even if session_start failed before withSession. Do not touch it to report errors.
        if (replacementEntered || replacementPrepared && !stale) return { kind: "partial" };
        if (stale || !request.isCurrent()) return { kind: "stale" };
        if ((error as Error).name === "AbortError") return { kind: "cancelled" };
        ctx.ui.notify(
            `Fresh implementation failed: ${
                error instanceof Error ? error.message : String(error)
            }`,
            "error",
        );
        return { kind: "rejected" };
    }
}
