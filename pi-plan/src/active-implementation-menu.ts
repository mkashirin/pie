import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu } from "@pi-extensions/tui";
import { type PlanExportDestinationProvider, planExportInputScreen } from "./plan-export-screen.ts";

interface ActiveImplementationMenuOptions {
    statusText: string;
    getExportDestination: PlanExportDestinationProvider;
    signal: AbortSignal;
    isCurrent(): boolean;
    show(): void;
    exportPlan(path: string, signal: AbortSignal): Promise<boolean>;
    settings(signal: AbortSignal): Promise<boolean>;
    startNew(): void;
    clear(): void;
}

export async function showActiveImplementationMenu(
    ctx: ExtensionContext,
    options: ActiveImplementationMenuOptions,
): Promise<void> {
    const signal = options.signal ?? new AbortController().signal;
    const current = () => !signal.aborted && options.isCurrent();
    const close = (run: () => void) => () => {
        if (!current()) return { kind: "rejected" as const };
        run();
        return { kind: "close" as const };
    };
    await runMenu(
        ctx,
        defineMenu({
            start: "main",
            screens: {
                main: () => ({
                    kind: "actions" as const,
                    title: "Active implementation",
                    lines: [options.statusText],
                    items: [
                        { id: "show", label: "Show implementation plan", action: "show" },
                        { id: "export", label: "Export plan...", to: "export" },
                        { id: "settings", label: "Settings", action: "settings" },
                        { id: "new", label: "Start a new plan", action: "startNew" },
                        { id: "clear", label: "Clear implementation plan", action: "clear" },
                    ],
                }),
                export: () => planExportInputScreen(options.getExportDestination),
            },
            actions: {
                show: () => {
                    if (current()) options.show();
                    return { kind: "rejected" as const };
                },
                clear: close(options.clear),
                startNew: close(options.startNew),
                settings: async () => {
                    if (current()) await options.settings(signal);
                    return { kind: "rejected" as const };
                },
                export: async ({ value }: { value?: string }) => ({
                    kind: current() && await options.exportPlan(value ?? "", signal)
                        ? "close" as const
                        : "rejected" as const,
                }),
            },
        }),
        { getState: () => undefined, signal, isCurrent: current },
    );
}
