import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function savedPlanBlocksNewWorkflow(ctx: ExtensionContext, hasSavedPlan: boolean): boolean {
    if (!hasSavedPlan) return false;
    ctx.ui.notify(
        "A saved plan is waiting. Use /plan to implement, export or clear it first.",
        "warning",
    );
    return true;
}

export async function preflightSavedPlanImplementation(
    ctx: ExtensionContext,
    isCurrent: () => boolean,
): Promise<boolean> {
    if (!isCurrent()) return false;
    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
        ctx.ui.notify(
            "Wait for the agent and queued messages to finish before implementing the saved plan.",
            "warning",
        );
        return false;
    }
    return isCurrent();
}
