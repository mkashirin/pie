export interface DeferredFreshHandoffDependencies {
    schedule(callback: () => void): unknown;
    cancel(handle: unknown): void;
}
export interface DeferredFreshHandoffCoordinator {
    schedule(
        run: (isCurrent: () => boolean) => Promise<void>,
        onError: (error: unknown) => void,
    ): void;
    cancel(): void;
}
export function createDeferredFreshHandoffCoordinator(
    dependencies: DeferredFreshHandoffDependencies = {
        schedule: (callback) => setTimeout(callback, 0),
        cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
): DeferredFreshHandoffCoordinator {
    let generation = 0;
    let scheduled: { handle?: unknown; fired: boolean } | undefined;
    const cancel = () => {
        generation++;
        const previous = scheduled;
        scheduled = undefined;
        if (previous && !previous.fired) dependencies.cancel(previous.handle);
    };
    return {
        cancel,
        schedule(run, onError) {
            cancel();
            const ticket = generation;
            const entry = { handle: undefined as unknown, fired: false };
            scheduled = entry;
            const isCurrent = () => ticket === generation;
            entry.handle = dependencies.schedule(() => {
                entry.fired = true;
                if (scheduled === entry) scheduled = undefined;
                void Promise.resolve().then(async () => {
                    if (isCurrent()) await run(isCurrent);
                }).catch((error: unknown) => {
                    if (isCurrent()) onError(error);
                }).catch(() => {
                    // Error reporting is terminal and must not produce an unhandled task rejection.
                });
            });
        },
    };
}
