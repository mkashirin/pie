import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu } from "@pi-extensions/pi-kit";
import { snapshotAvailableImplementationModels } from "./implementation-models.ts";
import { type PlanExportDestinationProvider, planExportInputScreen } from "./plan-export-screen.ts";
import { IMPLEMENTATION_THINKING_LEVELS, type PlanModeFixedThinkingLevel } from "./settings.ts";
import type { ImplementationRuntimeSelection } from "./state.ts";

interface MenuLifecycle {
    signal: AbortSignal;
    isCurrent(): boolean;
}
interface ReadyPlanMenuOptions extends MenuLifecycle {
    planThinkingLevel: PlanModeFixedThinkingLevel | undefined;
    implementationDefaults?: ImplementationRuntimeSelection;
    implementationOutcome(): string;
    getExportDestination: PlanExportDestinationProvider;
    implementHere(): void | Promise<void>;
    implementFresh(
        runtime: ImplementationRuntimeSelection,
        signal: AbortSignal,
    ): void | Promise<void>;
    exportPlan(path: string, signal: AbortSignal): Promise<boolean>;
    save(): void;
    stay(): void;
    exit(): void;
}
interface PlanMenuOptions extends ReadyPlanMenuOptions {
    statusText: string;
    hasReadyPlan: boolean;
    show(): void;
    finalize(): void;
}

async function runPlanMenu(
    ctx: ExtensionContext,
    options: ReadyPlanMenuOptions,
    planning?: PlanMenuOptions,
): Promise<void> {
    const signal = options.signal ?? new AbortController().signal;
    const current = () => !signal.aborted && options.isCurrent();
    const models = snapshotAvailableImplementationModels(ctx);
    const runtime: ImplementationRuntimeSelection = { ...options.implementationDefaults };
    const ready = !planning || planning.hasReadyPlan;
    const closeAction = (action: () => void | Promise<void>) => async () => {
        if (!current()) return { kind: "rejected" as const };
        await action();
        return { kind: "close" as const };
    };
    const menu = defineMenu({
        start: "main",
        screens: {
            main: () => ({
                kind: "actions" as const,
                title: ready ? "Plan ready" : "Plan mode",
                lines: [
                    planning?.statusText ?? "Review the plan and choose what happens next.",
                    options.implementationOutcome(),
                ],
                items: [
                    ...(planning
                        ? [
                            { id: "show", label: "Show plan", action: "show", disabled: !ready },
                            {
                                id: "finalize",
                                label: "Finalize plan",
                                action: "finalize",
                                disabled: ready,
                            },
                        ]
                        : []),
                    {
                        id: "here",
                        label: "Implement in this session",
                        action: "here",
                        disabled: !ready,
                    },
                    {
                        id: "fresh",
                        label: "Start fresh and implement...",
                        to: "fresh",
                        disabled: !ready,
                    },
                    { id: "export", label: "Export plan...", to: "export", disabled: !ready },
                    { id: "save", label: "Save plan for later", action: "save", disabled: !ready },
                    { id: "stay", label: "Keep planning", action: "stay" },
                    { id: "exit", label: "Exit Plan mode", action: "exit" },
                ],
            }),
            export: () => planExportInputScreen(options.getExportDestination),
            fresh: () => ({
                kind: "actions" as const,
                title: "Fresh implementation",
                lines: [
                    "Carry the approved plan into a new session. Queued input must finish first.",
                    `Model: ${
                        runtime.model
                            ? `${runtime.model.provider}/${runtime.model.modelId}`
                            : "Current model"
                    }`,
                    `Thinking: ${runtime.thinkingLevel ?? options.planThinkingLevel ?? "inherit"}`,
                    options.implementationOutcome(),
                ],
                items: [
                    { id: "start", label: "Start fresh and implement", action: "fresh" },
                    { id: "model", label: "Choose implementation model...", to: "models" },
                    { id: "thinking", label: "Choose thinking level...", to: "thinking" },
                ],
            }),
            models: () => ({
                kind: "choice" as const,
                title: "Implementation model",
                action: "model",
                enableSearch: true,
                items: [
                    { id: "inherit", label: "Current model" },
                    ...models.map((model, index) => ({
                        id: String(index),
                        label: model.name ?? model.id,
                        description: `${model.provider}/${model.id}`,
                    })),
                ],
            }),
            thinking: () => ({
                kind: "choice" as const,
                title: "Implementation thinking",
                action: "thinking",
                items: [
                    { id: "inherit", label: "Same as current" },
                    ...IMPLEMENTATION_THINKING_LEVELS.map((level) => ({ id: level, label: level })),
                ],
            }),
        },
        actions: {
            show: () => {
                if (current()) planning?.show();
                return { kind: "rejected" as const };
            },
            finalize: closeAction(() => planning?.finalize()),
            here: closeAction(options.implementHere),
            fresh: closeAction(() => options.implementFresh({ ...runtime }, signal)),
            save: closeAction(options.save),
            stay: closeAction(options.stay),
            exit: closeAction(options.exit),
            export: async ({ value }: { value?: string }) => ({
                kind: current() && await options.exportPlan(value ?? "", signal)
                    ? "close" as const
                    : "rejected" as const,
            }),
            model: ({ itemId }: { itemId?: string }) => {
                if (!current()) return { kind: "rejected" as const };
                const model = models.find((_model, index) => String(index) === itemId);
                if (itemId !== "inherit" && !model) return { kind: "rejected" as const };
                runtime.model = model ? { provider: model.provider, modelId: model.id } : undefined;
                return { kind: "back" as const };
            },
            thinking: ({ itemId }: { itemId?: string }) => {
                if (!current()) return { kind: "rejected" as const };
                const thinking = IMPLEMENTATION_THINKING_LEVELS.find((level) => level === itemId);
                if (itemId !== "inherit" && !thinking) return { kind: "rejected" as const };
                runtime.thinkingLevel = thinking;
                return { kind: "back" as const };
            },
        },
    });
    await runMenu(ctx, menu, { getState: () => undefined, signal, isCurrent: current });
}

export function showPlanModeMenu(ctx: ExtensionContext, options: PlanMenuOptions): Promise<void> {
    return runPlanMenu(ctx, options, options);
}

export function showReadyPlanMenu(
    ctx: ExtensionContext,
    options: ReadyPlanMenuOptions,
): Promise<void> {
    return runPlanMenu(ctx, options);
}
