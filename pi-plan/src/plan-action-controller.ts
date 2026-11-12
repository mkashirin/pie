import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanExportDestination } from "./plan-export.ts";
import {
    configuredImplementationModel,
    configuredImplementationThinkingLevel,
    type PlanModeFixedThinkingLevel,
    type PlanModeSettings,
} from "./settings.ts";
import type { ImplementationRuntimeSelection, PlanModeState } from "./state.ts";

type InteractiveUi = typeof import("./interactive-ui.ts");
interface MenuLifecycle {
    signal: AbortSignal;
    isCurrent(): boolean;
}
export type FreshImplementationTiming = "immediate" | "after-settled";
interface PlanActionControllerOptions {
    loadInteractiveUi(): Promise<InteractiveUi>;
    getState(): PlanModeState;
    captureLifecycle(): MenuLifecycle;
    statusText(): string;
    getThinkingLevel(): PlanModeFixedThinkingLevel | undefined;
    getSettings(): PlanModeSettings;
    implementationOutcome(): string;
    getExportDestination(ctx: ExtensionContext): PlanExportDestination;
    show(ctx: ExtensionContext): void;
    finalize(ctx: ExtensionContext): void;
    implementHere(ctx: ExtensionContext): void | Promise<void>;
    implementFresh(
        ctx: ExtensionContext,
        isCurrent: () => boolean,
        runtime: ImplementationRuntimeSelection | undefined,
        timing: FreshImplementationTiming,
    ): void | Promise<void>;
    exportPlan(
        ctx: ExtensionContext,
        path: string,
        signal: AbortSignal,
        isCurrent: () => boolean,
    ): Promise<boolean>;
    settings(
        ctx: ExtensionContext,
        signal: AbortSignal,
        isCurrent: () => boolean,
    ): Promise<boolean>;
    save(ctx: ExtensionContext): void;
    stay(ctx: ExtensionContext): void;
    exitReady(ctx: ExtensionContext): void;
    clearSaved(ctx: ExtensionContext): void;
}

export function createPlanActionController(options: PlanActionControllerOptions) {
    async function show(ctx: ExtensionContext, kind: "saved" | "current" | "ready"): Promise<void> {
        const lifecycle = options.captureLifecycle();
        const initial = options.getState();
        // A menu is tied to the displayed plan as well as the session/workflow generation.
        const current = () =>
            !lifecycle.signal.aborted && lifecycle.isCurrent()
            && options.getState() === initial;
        const ui = await options.loadInteractiveUi();
        if (!current()) return;
        const guarded = (run: () => void) => () => {
            if (current()) run();
        };
        const settings = options.getSettings();
        const common = {
            signal: lifecycle.signal,
            isCurrent: current,
            statusText: options.statusText(),
            implementationOutcome: options.implementationOutcome,
            getExportDestination: () => options.getExportDestination(ctx),
            show: guarded(() => options.show(ctx)),
            implementHere: async () => {
                if (current()) await options.implementHere(ctx);
            },
            exportPlan: (path: string, signal: AbortSignal) =>
                current() ? options.exportPlan(ctx, path, signal, current) : Promise.resolve(false),
            settings: (signal: AbortSignal) =>
                current() ? options.settings(ctx, signal, current) : Promise.resolve(false),
        };
        if (kind === "saved") {
            await ui.showSavedPlanMenu(ctx, {
                ...common,
                implementFresh: async () => {
                    if (current()) {
                        await options.implementFresh(ctx, current, undefined, "immediate");
                    }
                },
                clear: guarded(() => options.clearSaved(ctx)),
            });
            return;
        }
        const ready = {
            ...common,
            planThinkingLevel: options.getThinkingLevel(),
            implementationDefaults: {
                model: configuredImplementationModel(settings),
                thinkingLevel: configuredImplementationThinkingLevel(settings),
            },
            implementFresh: async (runtime: ImplementationRuntimeSelection) => {
                if (current()) {
                    await options.implementFresh(
                        ctx,
                        current,
                        runtime,
                        kind === "ready" ? "after-settled" : "immediate",
                    );
                }
            },
            save: guarded(() => options.save(ctx)),
            stay: guarded(() => options.stay(ctx)),
            exit: guarded(() => options.exitReady(ctx)),
        };
        if (kind === "ready") await ui.showReadyPlanMenu(ctx, ready);
        else {await ui.showPlanModeMenu(ctx, {
                ...ready,
                hasReadyPlan: initial.awaitingAction && !!initial.latestPlan,
                finalize: guarded(() => options.finalize(ctx)),
            });}
    }
    return {
        showSaved: (ctx: ExtensionContext) => show(ctx, "saved"),
        showCurrent: (ctx: ExtensionContext) => show(ctx, "current"),
        showReady: (ctx: ExtensionContext) => show(ctx, "ready"),
    };
}
