import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { sanitizeDisplayText, wrapProse } from "@pi-extensions/tui";
import type { PlanModeState } from "./state.ts";

export function sanitizePlanModeWidgetLine(value: string): string {
    return sanitizeDisplayText(value, { multiline: false, tabs: "space" });
}

export function renderPlanModeWidget(
    lines: readonly string[],
    theme: Theme,
    width: number,
): string[] {
    const columns = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    return [
        theme.fg("dim", "─".repeat(columns)),
        ...lines.flatMap((line) =>
            columns
                ? wrapProse(theme.fg("muted", sanitizePlanModeWidgetLine(line)), columns)
                : [""]
        ),
    ];
}

export function planModeStatusText(state: PlanModeState, toolSummary: () => string): string {
    if (state.enabled) {
        return state.awaitingAction
            ? "Plan ready · /plan to review and choose the next action"
            : `Plan mode · ${toolSummary()} · /plan for actions`;
    }
    if (state.activeImplementation) return "Implementing plan · /plan for actions";
    if (state.savedPlan) return "Plan saved · /plan to implement, export or clear";
    return "Ready to plan";
}

export function updatePlanModeUi(
    ctx: ExtensionContext,
    state: PlanModeState,
    toolSummary: () => string,
): void {
    if (!ctx.hasUI) return;
    if (!state.enabled && !state.savedPlan && !state.activeImplementation) {
        clearPlanModeUi(ctx);
        return;
    }
    const lines = [planModeStatusText(state, toolSummary)];
    ctx.ui.setStatus(
        "plan-mode",
        state.enabled ? "Plan" : state.savedPlan ? "Plan saved" : "Implement",
    );
    if (ctx.mode === "tui") {
        ctx.ui.setWidget("plan-mode", (_tui, theme) => ({
            invalidate() {},
            render: (width) => renderPlanModeWidget(lines, theme, width),
        }));
    } else ctx.ui.setWidget("plan-mode", lines);
}

export function clearPlanModeUi(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("plan-mode", undefined);
    ctx.ui.setWidget("plan-mode", undefined);
}

export function showPlanModePlan(
    pi: ExtensionAPI,
    _ctx: ExtensionContext,
    title: string,
    plan: string,
): void {
    pi.sendMessage({
        customType: "plan-mode-plan",
        content: plan,
        display: true,
        details: { title, plan },
    }, { triggerTurn: false });
}

export function showStoredPlan(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    state: PlanModeState,
): void {
    const plan = state.enabled
        ? state.latestPlan
        : state.savedPlan?.plan ?? state.activeImplementation?.plan;
    if (plan) showPlanModePlan(pi, ctx, state.savedPlan ? "Saved plan" : "Plan", plan);
    else ctx.ui.notify("No completed plan is available yet.", "info");
}
