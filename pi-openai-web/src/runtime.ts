import type { Api, Model, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Settings } from "./config.ts";
import { resolveModel } from "./config.ts";
import { readPage } from "./page/index.ts";
import type { PageReadResult } from "./page/types.ts";
import { attachPage, attachSearch, basePacket, failPacket } from "./results.ts";
import type { Packet, PageArguments, SearchArguments } from "./schemas.ts";
import { validateSearchArgs } from "./schemas.ts";
import { searchQuery } from "./search/index.ts";
import type { SearchQueryOptions, SearchQueryResult } from "./search/types.ts";

function cancellation(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error("Request cancelled");
}

export class Semaphore {
    private active = 0;
    private limit = 3;
    private queue: {
        signal: AbortSignal;
        resolve: (release: () => void) => void;
        reject: (error: Error) => void;
        abort: () => void;
    }[] = [];

    setLimit(limit: number) {
        this.limit = limit;
        this.drain();
    }

    get pending() {
        return this.queue.length;
    }

    get running() {
        return this.active;
    }

    acquire(signal: AbortSignal): Promise<() => void> {
        if (signal.aborted) return Promise.reject(cancellation(signal));
        return new Promise((resolve, reject) => {
            const item = {
                signal,
                resolve,
                reject,
                abort: () => {
                    const index = this.queue.indexOf(item);
                    if (index !== -1) this.queue.splice(index, 1);
                    signal.removeEventListener("abort", item.abort);
                    reject(cancellation(signal));
                },
            };
            this.queue.push(item);
            signal.addEventListener("abort", item.abort, { once: true });
            this.drain();
        });
    }

    private drain() {
        while (this.active < this.limit && this.queue.length) {
            const item = this.queue.shift()!;
            item.signal.removeEventListener("abort", item.abort);
            if (item.signal.aborted) {
                item.reject(cancellation(item.signal));
                continue;
            }
            this.active++;
            let released = false;
            item.resolve(() => {
                if (released) return;
                released = true;
                this.active--;
                this.drain();
            });
        }
    }
}

export interface RuntimeAdapters {
    search: (options: SearchQueryOptions) => Promise<SearchQueryResult>;
    /** Must settle after abort cleanup, including local worker termination. */
    page: typeof readPage;
}

export class Runtime {
    readonly semaphore = new Semaphore();
    private lifecycle = new AbortController();
    private requests = 0;
    private sequence = 0;
    private adapters: RuntimeAdapters;

    constructor(adapters: RuntimeAdapters = { search: searchQuery, page: readPage }) {
        this.adapters = adapters;
    }

    get busy() {
        return this.requests > 0;
    }

    captureLifecycle(): AbortSignal {
        return this.lifecycle.signal;
    }

    stop() {
        this.lifecycle.abort(new Error("Session ended or replaced"));
    }

    beginSession() {
        this.stop();
        this.lifecycle = new AbortController();
    }

    private async request<T>(
        timeoutMs: number,
        parent: AbortSignal | undefined,
        lifecycle: AbortSignal,
        operation: (signal: AbortSignal) => Promise<T>,
        cooperative = false,
    ): Promise<T> {
        const deadline = new AbortController();
        const signal = AbortSignal.any([
            deadline.signal,
            lifecycle,
            ...(parent ? [parent] : []),
        ]);
        const timer = setTimeout(
            () => deadline.abort(new DOMException("Request deadline exceeded", "TimeoutError")),
            timeoutMs,
        );
        let release: (() => void) | undefined;
        let abort: (() => void) | undefined;
        let interruption: NodeJS.Immediate | undefined;
        try {
            release = await this.semaphore.acquire(signal);
            if (signal.aborted) throw cancellation(signal);
            // Page cores obey the signal contract and settle only after local cleanup.
            // Keep their slot until then; a fallback race can release it before worker exit.
            if (cooperative) return await operation(signal);
            // Remote search transports may ignore abort. Allow partial usage/evidence one turn,
            // then return without claiming remote quiescence.

            const interrupted = new Promise<never>((_resolve, reject) => {
                abort = () => {
                    interruption = setImmediate(() => reject(cancellation(signal)));
                };
                signal.addEventListener("abort", abort, { once: true });
            });
            return await Promise.race([operation(signal), interrupted]);
        } finally {
            clearTimeout(timer);
            if (interruption) clearImmediate(interruption);
            if (abort) signal.removeEventListener("abort", abort);
            release?.();
        }
    }

    async search(
        args: SearchArguments,
        settings: Settings,
        ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
        signal?: AbortSignal,
        progress?: (packet: Packet) => void,
        lifecycle = this.captureLifecycle(),
    ): Promise<Packet> {
        const packet = basePacket("openai_search", `web-${++this.sequence}`);
        if (lifecycle.aborted || signal?.aborted) {
            return failPacket(packet, "cancelled", "Request cancelled before dispatch");
        }
        packet.request.queries = args.queries;
        try {
            validateSearchArgs(args);
        } catch (error) {
            return failPacket(packet, "capability", (error as Error).message);
        }
        if (!settings.enabled) return failPacket(packet, "capability", "pi-openai-web is disabled");
        let model: Model<Api>;
        try {
            model = resolveModel(settings, ctx);
        } catch (error) {
            return failPacket(packet, "capability", (error as Error).message);
        }
        const freshness = args.freshness ?? settings.freshness;
        const searchContextSize = args.search_context_size ?? settings.searchContextSize;
        packet.request.model = { provider: model.provider, id: model.id, api: model.api };
        packet.request.freshness = freshness;
        packet.request.searchContextSize = searchContextSize;
        this.requests++;
        this.semaphore.setLimit(settings.concurrency);
        const results: (SearchQueryResult | undefined)[] = new Array(args.queries.length);

        const publish = () => {
            try {
                // Progress is metadata only; do not move evidence IDs as queries finish out of order.
                progress?.({
                    ...packet,
                    status: "running",
                    warnings: [
                        `${
                            results.filter(Boolean).length
                        }/${args.queries.length} queries completed`,
                    ],
                    results: [],
                    evidence: [],
                });
            } catch { /* UI callbacks never fail network requests. */ }
        };

        publish();
        try {
            await Promise.all(args.queries.map(async (query, index) => {
                const startedAt = Date.now();
                let observedUsage: Usage | undefined;
                try {
                    results[index] = await this.request(
                        settings.searchTimeoutMs,
                        signal,
                        lifecycle,
                        (requestSignal) =>
                            this.adapters.search({
                                registry: ctx.modelRegistry,
                                model,
                                query,
                                freshness,
                                searchContextSize,
                                signal: requestSignal,
                                onProgress: (update) => {
                                    observedUsage = update.usage ?? observedUsage;
                                },
                            }),
                    );
                } catch (error) {
                    results[index] = {
                        ok: false,
                        status: "failure",
                        query,
                        model: { provider: model.provider, id: model.id, api: model.api },
                        freshness,
                        searchContextSize,
                        startedAt,
                        finishedAt: Date.now(),
                        answerSegments: [],
                        citations: [],
                        actions: [],
                        sources: [],
                        warnings: [],
                        truncation: {
                            answer: false,
                            evidence: false,
                            answerBytes: 0,
                            answerLines: 0,
                        },
                        error: {
                            kind: (error as Error).name === "TimeoutError"
                                ? "timeout"
                                : signal?.aborted
                                        || (error as Error).message === "Session ended or replaced"
                                ? "cancelled"
                                : "transport",
                            message: (error as Error).message,
                        },
                        ...(observedUsage ? { usage: observedUsage } : {}),
                    };
                }
                publish();
            }));
            return attachSearch(packet, results as SearchQueryResult[]);
        } finally {
            this.requests--;
        }
    }

    async page(
        args: PageArguments,
        settings: Settings,
        signal?: AbortSignal,
        lifecycle = this.captureLifecycle(),
    ): Promise<Packet> {
        const packet = basePacket("web_action", `web-${++this.sequence}`);
        packet.request.action = args.action;
        if (lifecycle.aborted || signal?.aborted) {
            return failPacket(packet, "cancelled", "Request cancelled before dispatch");
        }
        if (typeof args.url !== "string" || !args.url.length || args.url.length > 2048) {
            packet.warnings.push("Invalid URL omitted: URL must contain 1..2048 characters.");
            packet.truncation.structured = true;
            packet.truncation.omissions.push("request.url: invalid URL omitted");
            return failPacket(packet, "unsafe_url", "URL must contain 1..2048 characters");
        }
        packet.request.url = args.url;
        if (!settings.enabled) return failPacket(packet, "capability", "pi-openai-web is disabled");
        this.requests++;
        this.semaphore.setLimit(settings.concurrency);
        try {
            let page: PageReadResult;
            try {
                page = await this.request(
                    settings.pageTimeoutMs,
                    signal,
                    lifecycle,
                    (requestSignal) => this.adapters.page(args, { signal: requestSignal }),
                    true,
                );
            } catch (error) {
                page = {
                    ok: false,
                    requestedUrl: args.url,
                    finalUrl: null,
                    timestamp: new Date().toISOString(),
                    title: null,
                    totalLines: 0,
                    excerpts: [],
                    matches: [],
                    no_match: false,
                    warnings: [],
                    completeness: "none",
                    truncated: false,
                    truncation: { wire: false, decoded: false, extracted: false, matches: false },
                    error: {
                        kind: (error as Error).name === "TimeoutError"
                            ? "timeout"
                            : signal?.aborted
                                    || (error as Error).message === "Session ended or replaced"
                            ? "cancelled"
                            : "transport",
                        message: (error as Error).message,
                    },
                };
            }
            return attachPage(packet, page);
        } finally {
            this.requests--;
        }
    }
}
