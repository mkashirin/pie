export const MODE_CONTRACT_MESSAGE_TYPE = "plan-mode-transition";
export const MODE_CONTRACT_VERSION = 1;
export type PlanModeContract = "plan" | "normal";

export function modeContractContent(mode: PlanModeContract): string {
    return mode === "plan"
        ? "[PI PLAN MODE CONTRACT v1: PLAN]\n"
            + "Plan Mode is active because the user explicitly enabled /plan. Explore read-only, "
            + "respect the selected tool policy, and prepare a decision-ready implementation plan. "
            + "Use plan_mode_question only for focused clarification and plan_mode_complete alone "
            + "as the final action. Do not implement, mutate files, or treat tool visibility as authority."
        : "[PI PLAN MODE CONTRACT v1: NORMAL]\n"
            + "Plan Mode is no longer active. Follow the current user request normally. "
            + "Do not call plan_mode_question or plan_mode_complete. Their visible schemas do not "
            + "activate Plan Mode; ordinary planning requests, skills and plan files do not activate it.";
}

export function createModeContractMessage(mode: PlanModeContract, timestamp = Date.now()) {
    return {
        role: "custom" as const,
        customType: MODE_CONTRACT_MESSAGE_TYPE,
        content: modeContractContent(mode),
        display: false,
        details: { version: MODE_CONTRACT_VERSION, mode },
        timestamp,
    };
}

export function modeContractFromMessage(message: unknown): PlanModeContract | undefined {
    if (!message || typeof message !== "object") return undefined;
    const value = message as Record<string, unknown>;
    if (
        value.role !== "custom" || value.customType !== MODE_CONTRACT_MESSAGE_TYPE
        || !value.details || typeof value.details !== "object"
    ) return undefined;
    const details = value.details as Record<string, unknown>;
    const mode = details.mode;
    if (details.version !== MODE_CONTRACT_VERSION || mode !== "plan" && mode !== "normal") {
        return undefined;
    }
    // Version-one session records may use earlier explanatory prose. The structured version,
    // mode and exact header define the persisted protocol; wording below it is not an identifier.
    const header = modeContractContent(mode).split("\n", 1)[0];
    return typeof value.content === "string" && value.content.startsWith(`${header}\n`)
        ? mode
        : undefined;
}

export function hasModeContractArtifact(messages: readonly unknown[]): boolean {
    return messages.some((message) =>
        message !== null && typeof message === "object"
        && (message as Record<string, unknown>).customType === MODE_CONTRACT_MESSAGE_TYPE
    );
}

export function latestModeContract(messages: readonly unknown[]): {
    index: number;
    mode: PlanModeContract;
} | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (!message || typeof message !== "object") continue;
        const value = message as Record<string, unknown>;
        if (value.role !== "custom" || value.customType !== MODE_CONTRACT_MESSAGE_TYPE) continue;
        const mode = modeContractFromMessage(message);
        // An unknown newer contract must never resurrect an older activation.
        return mode ? { index, mode } : undefined;
    }
    return undefined;
}

export function reconcileModeContract(messages: unknown[], expected: PlanModeContract): unknown[] {
    if (latestModeContract(messages)?.mode === expected) return messages;
    let insertion = 0;
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index] as Record<string, unknown> | null;
        if (message?.customType === MODE_CONTRACT_MESSAGE_TYPE) insertion = index + 1;
        else if (
            index === insertion
            && ["system", "compactionSummary", "branchSummary"].includes(String(message?.role))
        ) {
            insertion = index + 1;
        }
    }
    return [
        ...messages.slice(0, insertion),
        createModeContractMessage(expected),
        ...messages.slice(insertion),
    ];
}
