export const FINALIZE_PLAN_PROMPT =
    "Finalize the plan now. Call plan_mode_complete alone as your final action with the complete decision-ready Markdown plan. Do not implement it.";
export const RETRY_FINALIZE_PLAN_PROMPT =
    "The requested completion was not received. Call plan_mode_complete alone now with the complete Markdown plan; do not respond only with prose or implement changes.";
export type FinalizationRunOutcome = "normal" | "cancelled" | "error";
export type FinalizationSettlementAction = "retry" | "failed" | undefined;

export function createFinalizationRequestCoordinator() {
    let pending: { generation: number; retried: boolean; ended: boolean } | undefined;
    const reset = () => {
        pending = undefined;
    };
    return {
        request(workflowGeneration: number): void {
            pending = { generation: workflowGeneration, retried: false, ended: false };
        },
        satisfy: reset,
        observeRunEnd(workflowGeneration: number, outcome: FinalizationRunOutcome): void {
            if (pending?.generation !== workflowGeneration) return;
            if (outcome !== "normal") reset();
            else pending.ended = true;
        },
        settle(workflowGeneration: number): FinalizationSettlementAction {
            if (pending?.generation !== workflowGeneration || !pending.ended) return undefined;
            if (pending.retried) {
                reset();
                return "failed";
            }
            pending.retried = true;
            pending.ended = false;
            return "retry";
        },
        reset,
        hasPendingRequest: () => pending !== undefined,
    };
}
