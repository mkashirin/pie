import { type ExtensionContext, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULT_PLAN_EXPORT_PATH } from "./settings.ts";
import type { PlanModeState } from "./state.ts";

export { DEFAULT_PLAN_EXPORT_PATH };
export interface PlanExportResult {
    path: string;
}
export interface PlanExportDestination {
    configuredPath: string;
    resolvedPath: string;
}
export interface PlanExportLifecycle {
    signal: AbortSignal;
    isCurrent(): boolean;
    getState?(): PlanModeState;
    finishReady?(): void;
}

export function resolvePlanExportPath(
    requestedPath: string | undefined,
    cwd: string,
    defaultPath = DEFAULT_PLAN_EXPORT_PATH,
): string {
    let path = (requestedPath ?? defaultPath).trim();
    if (path.startsWith("@")) path = path.slice(1).trim();
    if (!path || path.includes("\0")) {
        throw new Error("Export path must not be empty or contain NUL.");
    }
    if (path === "~") path = homedir();
    else if (path.startsWith("~/")) path = join(homedir(), path.slice(2));
    return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}
export function planExportDestination(defaultPath: string, cwd: string): PlanExportDestination {
    return {
        configuredPath: defaultPath,
        resolvedPath: resolvePlanExportPath(undefined, cwd, defaultPath),
    };
}
function checkCurrent(signal?: AbortSignal, isCurrent?: () => boolean): void {
    signal?.throwIfAborted();
    if (isCurrent && !isCurrent()) {
        throw new DOMException("Export owner is no longer current", "AbortError");
    }
}
export async function exportPlanToFile(
    plan: string,
    requestedPath: string | undefined,
    cwd: string,
    signal?: AbortSignal,
    isCurrent?: () => boolean,
    defaultPath = DEFAULT_PLAN_EXPORT_PATH,
): Promise<PlanExportResult> {
    checkCurrent(signal, isCurrent);
    if (!plan.trim()) throw new Error("There is no plan to export.");
    const path = resolvePlanExportPath(requestedPath, cwd, defaultPath);
    return withFileMutationQueue(path, async () => {
        checkCurrent(signal, isCurrent);
        await mkdir(dirname(path), { recursive: true });
        checkCurrent(signal, isCurrent);
        let file;
        try {
            file = await open(path, "wx");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") {
                throw new Error(`Export destination already exists: ${path}`);
            }
            throw error;
        }
        const identity = await file.stat();
        let published = false;
        try {
            checkCurrent(signal, isCurrent);
            await file.writeFile(plan.endsWith("\n") ? plan : plan + "\n", "utf8");
            await file.sync();
            checkCurrent(signal, isCurrent);
            published = true;
        } finally {
            try {
                await file.close();
            } finally {
                if (!published) {
                    // Never remove a different file installed by an outside writer during rollback.
                    const current = await lstat(path).catch((error: NodeJS.ErrnoException) => {
                        if (error.code !== "ENOENT") throw error;
                        return undefined;
                    });
                    if (current?.ino === identity.ino && current?.dev === identity.dev) {
                        await unlink(path);
                    }
                }
            }
        }
        return { path };
    });
}
export async function exportStoredPlan(
    state: PlanModeState,
    requestedPath: string | undefined,
    ctx: ExtensionContext,
    lifecycle?: PlanExportLifecycle,
    defaultPath = DEFAULT_PLAN_EXPORT_PATH,
): Promise<boolean> {
    const plan = state.awaitingAction
        ? state.latestPlan
        : state.savedPlan?.plan ?? state.activeImplementation?.plan;
    if (!plan) {
        ctx.ui.notify(
            "There is no completed, saved or active implementation plan to export.",
            "warning",
        );
        return false;
    }
    try {
        const result = await exportPlanToFile(
            plan,
            requestedPath,
            ctx.cwd,
            lifecycle?.signal ?? ctx.signal,
            lifecycle ? () => lifecycle.isCurrent() : undefined,
            defaultPath,
        );
        if (lifecycle && (!lifecycle.isCurrent() || lifecycle.signal.aborted)) return false;
        const current = lifecycle?.getState?.() ?? state;
        if (state.awaitingAction && current.awaitingAction && current.latestPlan === plan) {
            lifecycle?.finishReady?.();
        }
        ctx.ui.notify(`Plan exported to ${result.path}`, "info");
        return true;
    } catch (error) {
        if ((error as Error).name !== "AbortError" && (!lifecycle || lifecycle.isCurrent())) {
            ctx.ui.notify(
                `Plan export failed: ${error instanceof Error ? error.message : String(error)}`,
                "error",
            );
        }
        return false;
    }
}
