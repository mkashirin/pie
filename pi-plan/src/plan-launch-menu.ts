import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu } from "@pi-extensions/pi-kit";

export interface PlanLaunchTool {
    name: string;
    label?: string;
    description: string;
    searchText: string;
    disabled: boolean;
    disabledReason?: string;
}
interface PlanLaunchMenuOptions {
    statusText: string;
    toolSummary(selectedNames: ReadonlySet<string>): string;
    getSelectedNames(): ReadonlySet<string>;
    tools: readonly PlanLaunchTool[];
    signal: AbortSignal;
    isCurrent(): boolean;
    initialScreen?: "main" | "tools";
    start(signal: AbortSignal): void;
    startWithTools(toolNames: string[], signal: AbortSignal): void;
    settings(signal: AbortSignal): Promise<boolean>;
}

export async function showPlanLaunchMenu(
    ctx: ExtensionContext,
    options: PlanLaunchMenuOptions,
): Promise<void> {
    const signal = options.signal ?? new AbortController().signal;
    const selected = new Set(options.getSelectedNames());
    const current = () => !signal.aborted && options.isCurrent();
    const menu = defineMenu({
        start: options.initialScreen ?? "main",
        screens: {
            main: () => ({
                kind: "actions" as const,
                title: "Plan mode",
                lines: [options.statusText, options.toolSummary(selected)],
                items: [
                    { id: "start", label: "Start Plan mode", action: "start" },
                    { id: "tools", label: "Choose tools, then start...", to: "tools" },
                    { id: "settings", label: "Settings", action: "settings" },
                    { id: "help", label: "How Plan mode works", to: "help" },
                ],
            }),
            tools: () => ({
                kind: "multiSelect" as const,
                title: "Planning tools",
                lines: [
                    options.toolSummary(selected),
                    "Custom tools are opt-in and may have side effects. This is not a sandbox.",
                ],
                enableSearch: true,
                action: "toggle",
                items: options.tools.map((tool) => ({
                    id: tool.name,
                    label: tool.label ?? tool.name,
                    description: tool.description,
                    searchText: tool.searchText,
                    disabled: tool.disabled,
                    disabledReason: tool.disabledReason,
                    selected: selected.has(tool.name),
                })),
                actions: [{
                    id: "done",
                    label: "Done - start with this policy",
                    action: "startWithTools",
                }],
            }),
            help: () => ({
                kind: "detail" as const,
                title: "How Plan mode works",
                lines: [
                    "Explore without editing, answer focused questions, then review the completed plan.",
                    "Choose whether to implement here, start a fresh session, save or export the plan.",
                    "Tools are locked while planning. Exit to choose a different policy.",
                    "Built-in writes are blocked; selected custom tools run at your risk.",
                ],
            }),
        },
        actions: {
            start: () => {
                if (!current()) return { kind: "rejected" as const };
                options.start(signal);
                return { kind: "close" as const };
            },
            startWithTools: () => {
                if (!current()) return { kind: "rejected" as const };
                options.startWithTools([...selected], signal);
                return { kind: "close" as const };
            },
            toggle: ({ itemId, selected: checked }: { itemId?: string; selected?: boolean }) => {
                if (
                    !current() || !itemId
                    || !options.tools.some((tool) => tool.name === itemId && !tool.disabled)
                ) return { kind: "rejected" as const };
                if (checked) selected.add(itemId);
                else selected.delete(itemId);
                return { kind: "stay" as const };
            },
            settings: async () => {
                if (current()) await options.settings(signal);
                return { kind: "rejected" as const };
            },
        },
    });
    await runMenu(ctx, menu, { getState: () => undefined, signal, isCurrent: current });
}
