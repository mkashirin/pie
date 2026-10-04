/** Presentation failures are diagnostics, never run results or verification evidence. */
export function warnCallbackFailure(label: string, error: unknown) {
    try {
        console.warn(`[pi-openai-subagents] Disabled ${label} after callback failure:`, error);
    } catch {
        // Even a broken diagnostic sink must not abort work or escape a UI timer.
    }
}

/** Disable a failing consumer once, without disabling other presentation surfaces. */
export function safeCallback<Args extends unknown[]>(
    label: string,
    callback: ((...args: Args) => void) | undefined,
): (...args: Args) => void {
    return (...args) => {
        if (!callback) return;
        try {
            callback(...args);
        } catch (error) {
            callback = undefined;
            warnCallbackFailure(label, error);
        }
    };
}
