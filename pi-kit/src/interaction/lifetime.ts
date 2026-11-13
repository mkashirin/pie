import type { InteractionOwner } from "./types.ts";

/** One invocation owns one abort scope. Late promises may settle but cannot update the UI. */
export class InteractionLifetime {
    private controller = new AbortController();
    private stopped = false;
    private onAbort = () => {
        const cancel = this.cancel;
        this.dispose();
        cancel?.();
    };
    cancel?: () => void;

    constructor(private owner: InteractionOwner) {
        owner.signal?.addEventListener("abort", this.onAbort, { once: true });
    }
    get signal() {
        return this.controller.signal;
    }
    get current() {
        return !this.stopped && !this.owner.signal?.aborted && (this.owner.isCurrent?.() ?? true);
    }
    dispose() {
        if (this.stopped) return;
        this.stopped = true;
        this.owner.signal?.removeEventListener("abort", this.onAbort);
        this.controller.abort();
        this.cancel = undefined;
    }
    wait<T>(pending: Promise<T>): Promise<T | undefined> {
        if (!this.current) {
            // The host may already have started work before synchronously aborting its owner.
            pending.catch(() => {});
            return Promise.resolve(undefined);
        }
        return new Promise<T | undefined>((resolve, reject) => {
            const abort = () => {
                this.signal.removeEventListener("abort", abort);
                resolve(undefined);
            };
            this.signal.addEventListener("abort", abort, { once: true });
            pending.then((value) => {
                this.signal.removeEventListener("abort", abort);
                resolve(this.current ? value : undefined);
            }, (error: unknown) => {
                this.signal.removeEventListener("abort", abort);
                if (this.current) reject(error);
                else resolve(undefined);
            });
        });
    }
}
