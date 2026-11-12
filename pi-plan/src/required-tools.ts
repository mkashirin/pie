export const REQUIRED_PLAN_MODE_TOOL_NAMES = ["plan_mode_question", "plan_mode_complete"] as const;

export function planModeHelperToolsAvailable(toolNames: readonly string[]): boolean {
    return REQUIRED_PLAN_MODE_TOOL_NAMES.every((name) => toolNames.includes(name));
}
export function assertPlanModeHelperToolsAvailable(toolNames: readonly string[]): void {
    const missing = REQUIRED_PLAN_MODE_TOOL_NAMES.filter((name) => !toolNames.includes(name));
    if (missing.length) {
        throw new Error(`Plan Mode requires these available tools: ${missing.join(", ")}`);
    }
}
