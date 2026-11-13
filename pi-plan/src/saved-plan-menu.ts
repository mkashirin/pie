import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu } from "@pi-extensions/pi-kit";
import { type PlanExportDestinationProvider, planExportInputScreen } from "./plan-export-screen.ts";

interface SavedPlanMenuOptions {
    statusText: string;
    implementationOutcome(): string;
    getExportDestination: PlanExportDestinationProvider;
    signal: AbortSignal;
    isCurrent(): boolean;
    show(): void;
    implementHere(): void | Promise<void>;
    implementFresh(signal: AbortSignal): void | Promise<void>;
    exportPlan(path: string, signal: AbortSignal): Promise<boolean>;
    settings(signal: AbortSignal): Promise<boolean>;
    clear(): void;
}

export async function showSavedPlanMenu(
    ctx: ExtensionContext,
    options: SavedPlanMenuOptions,
): Promise<void> {
    const signal = options.signal ?? new AbortController().signal;
    const current = () => !signal.aborted && options.isCurrent();
    const close = (run: () => void | Promise<void>) => async () => {
        if (!current()) return { kind: "rejected" as const };
        await run();
        return { kind: "close" as const };
    };
    await runMenu(
        ctx,
        defineMenu({
            start: "main",
            screens: {
                main: () => ({
                    kind: "actions" as const,
                    title: "Saved plan",
                    lines: [options.statusText, options.implementationOutcome()],
                    items: [
                        { id: "show", label: "Show saved plan", action: "show" },
                        { id: "here", label: "Implement in this session", action: "here" },
                        { id: "fresh", label: "Start fresh and implement", action: "fresh" },
                        { id: "export", label: "Export plan...", to: "export" },
                        { id: "settings", label: "Settings", action: "settings" },
                        { id: "clear", label: "Clear saved plan", action: "clear" },
                    ],
                }),
                export: () => planExportInputScreen(options.getExportDestination),
            },
            actions: {
                show: () => {
                    if (current()) options.show();
                    return { kind: "rejected" as const };
                },
                here: close(options.implementHere),
                fresh: close(() => options.implementFresh(signal)),
                clear: close(options.clear),
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
