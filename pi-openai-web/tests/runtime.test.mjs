import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { Value } from "typebox/value";
import { defaults } from "../src/config.ts";
import { readPage } from "../src/page/index.ts";
import { toolResult } from "../src/results.ts";
import { Runtime, Semaphore } from "../src/runtime.ts";
import { PacketSchema } from "../src/schemas.ts";

const model = { provider: "openai", api: "openai-responses", id: "fixture" };
const ctx = { model, modelRegistry: {} };

function result(options) {
    return {
        ok: true,
        status: "success",
        query: options.query,
        model: options.model,
        freshness: options.freshness,
        searchContextSize: options.searchContextSize,
        startedAt: 1,
        finishedAt: 2,
        answerSegments: [],
        citations: [],
        actions: [],
        sources: [],
        warnings: [],
        truncation: { answer: false, evidence: false, answerBytes: 0, answerLines: 0 },
    };
}

test("semaphore removes cancelled queued waiters and releases once", async () => {
    const semaphore = new Semaphore();
    semaphore.setLimit(1);
    const first = await semaphore.acquire(new AbortController().signal);
    const controller = new AbortController();
    const next = semaphore.acquire(controller.signal);
    controller.abort();
    await assert.rejects(next);
    assert.equal(semaphore.pending, 0);
    first();
    first();
    assert.equal(semaphore.running, 0);
});
test("ordered batch snapshots model; partial failure and global lifecycle cancellation", async () => {
    const seen = [];
    const runtime = new Runtime({
        search: async (options) => {
            seen.push(options.model.id);
            if (options.query === "bad") throw Error("fixture failure");
            return result(options);
        },
        page: async () => {
            throw Error("unused");
        },
    });
    const packet = await runtime.search({ queries: ["good", "bad"] }, defaults, ctx);
    assert.equal(packet.status, "partial");
    assert.deepEqual(packet.results.map((r) => r.query), ["good", "bad"]);
    assert.deepEqual(seen, ["fixture", "fixture"]);
    const stalled = new Runtime({
        search: async () => new Promise(() => {}),
        page: async () => new Promise(() => {}),
    });
    const pending = stalled.search(
        { queries: ["one", "two"] },
        { ...defaults, concurrency: 1 },
        ctx,
    );
    await new Promise((resolve) => setImmediate(resolve));
    stalled.stop();
    const cancelled = await pending;
    assert.equal(cancelled.status, "failure");
    assert.ok(cancelled.results.every((r) => r.error.kind === "cancelled"));
    assert.equal(stalled.busy, false);
    assert.equal(stalled.semaphore.pending, 0);
});
test("deadline includes queue; disabled does not call transport", async () => {
    let calls = 0;
    const runtime = new Runtime({
        search: async () => {
            calls++;
            return new Promise(() => {});
        },
        page: async () => new Promise(() => {}),
    });
    assert.equal(
        (await runtime.search({ queries: ["x"] }, { ...defaults, enabled: false }, ctx)).status,
        "failure",
    );
    assert.equal(calls, 0);
    const packet = await runtime.search({ queries: ["x", "y"] }, {
        ...defaults,
        concurrency: 1,
        searchTimeoutMs: 10,
    }, ctx);
    assert.ok(packet.results.every((r) => r.error.kind === "timeout"));
    assert.equal(runtime.busy, false);
    assert.equal(runtime.semaphore.running, 0);
    assert.equal(runtime.semaphore.pending, 0);
});

test("stopped lifecycle rejects new/stale calls until explicit session begin", async () => {
    let calls = 0;
    const runtime = new Runtime({
        search: async (options) => {
            calls++;
            return result(options);
        },
        page: async () => {
            calls++;
            throw Error("fixture");
        },
    });
    const stale = runtime.captureLifecycle();
    runtime.stop();
    for (
        const packet of [
            await runtime.search({ queries: ["x"] }, defaults, ctx),
            await runtime.page({ action: "open", url: "https://example.com" }, defaults),
        ]
    ) assert.equal(packet.error.kind, "cancelled");
    runtime.beginSession();
    assert.equal(
        (await runtime.search({ queries: ["x"] }, defaults, ctx, undefined, undefined, stale)).error
            .kind,
        "cancelled",
    );
    assert.equal(
        (await runtime.page(
            { action: "open", url: "https://example.com" },
            defaults,
            undefined,
            stale,
        )).error.kind,
        "cancelled",
    );
    assert.equal(calls, 0);
    assert.equal((await runtime.search({ queries: ["x"] }, defaults, ctx)).status, "success");
    await runtime.page({ action: "open", url: "https://example.com" }, defaults);
    assert.equal(calls, 2);
});

test("real page runtime omits invalid giant URLs before transport, including disabled", async () => {
    const runtime = new Runtime({
        search: async () => {
            throw Error("network forbidden");
        },
        page: async () => {
            throw Error("network forbidden");
        },
    });
    const url = "https://example.com/" + "a".repeat(300000);
    for (const enabled of [true, false]) {
        const output = toolResult(
            await runtime.page({ action: "open", url }, { ...defaults, enabled }),
        );
        assert.equal(output.details.error.kind, "unsafe_url");
        assert.equal(Value.Check(PacketSchema, output.details), true);
        assert.equal(output.details, output.structuredContent);
        assert.ok(Buffer.byteLength(JSON.stringify(output.details)) <= 256 * 1024);
        assert.equal(output.details.request.url, undefined);
        assert.match(output.details.warnings.join(" "), /Invalid URL omitted/);
        assert.equal(output.details.truncation.structured, true);
        assert.match(output.details.truncation.omissions.join(" "), /invalid URL omitted/);
    }
});

test("cooperative cancellation keeps partial evidence and usage exactly once; cleans deadlines", async (t) => {
    const timers = new Set();
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    t.mock.method(globalThis, "setTimeout", (...args) => {
        const timer = originalSetTimeout(...args);
        timers.add(timer);
        return timer;
    });
    t.mock.method(globalThis, "clearTimeout", (timer) => {
        timers.delete(timer);
        return originalClearTimeout(timer);
    });
    const usage = {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const runtime = new Runtime({
        search: async (options) => {
            if (options.query === "good") return { ...result(options), usage };
            await new Promise((resolve) =>
                options.signal.addEventListener("abort", resolve, { once: true })
            );
            return {
                ...result(options),
                ok: false,
                status: "failure",
                error: { kind: "cancelled", message: "partial fixture" },
                usage,
                citations: [{
                    type: "url_citation",
                    url: "https://example.com",
                    origin: { outputIndex: 0, contentIndex: 0 },
                    startIndex: 0,
                    endIndex: 1,
                }],
            };
        },
        page: async () => {
            throw Error("unused");
        },
    });
    const progress = [];
    const pending = runtime.search(
        { queries: ["good", "partial"] },
        defaults,
        ctx,
        undefined,
        (packet) => progress.push(toolResult(packet, false)),
    );
    await new Promise((resolve) => setImmediate(resolve));
    runtime.stop();
    const packet = await pending;
    assert.equal(packet.status, "partial");
    assert.equal(packet.evidence.length, 1);
    assert.equal(packet.results[1].error.kind, "cancelled");
    assert.equal(packet.usage.totalTokens, 6);
    assert.ok(progress.every((update) => update.usage === undefined));
    assert.equal(toolResult(packet).usage.totalTokens, 6);
    assert.equal(timers.size, 0);
    assert.equal(runtime.busy, false);
    assert.equal(runtime.semaphore.running, 0);
    assert.equal(runtime.semaphore.pending, 0);
});

function offlinePageRuntime(body, responses, resolve) {
    return new Runtime({
        search: async () => {
            throw Error("network forbidden");
        },
        page: (args, options) =>
            readPage(args, {
                ...options,
                adapters: {
                    resolve: resolve ?? (async () => [{ address: "93.184.216.34", family: 4 }]),
                    request(_url, _options, callback) {
                        const request = new EventEmitter();
                        let response;
                        request.end = () =>
                            queueMicrotask(() => {
                                response = Readable.from([Buffer.from(body)]);
                                response.statusCode = 200;
                                response.headers = { "content-type": "text/html; charset=utf-8" };
                                response.complete = true;
                                responses.push(response);
                                callback(response);
                            });
                        request.destroy = (error) => {
                            response?.destroy();
                            if (error) request.emit("error", error);
                            return request;
                        };
                        return request;
                    },
                },
            }),
    });
}

const nested = `<html><body>${"<div>".repeat(30000)}hi${"</div>".repeat(30000)}</body></html>`;
const pageArgs = { action: "open", url: "https://public.site/page" };

test("actual Runtime.page waits for worker exit before returning/reusing concurrency 1", async (t) => {
    const responses = [];
    const runtime = offlinePageRuntime(nested, responses);
    const original = Worker.prototype.terminate;
    const workers = [];
    let controller;
    let spawned = 0;
    let pendingCleanup = 0;
    let peak = 0;
    let abortTimer;
    t.mock.method(Worker.prototype, "terminate", function(...args) {
        workers.push(this);
        pendingCleanup++;
        return original.apply(this, args).then(async (value) => {
            // Cleanup is asynchronous; make the former setImmediate race deterministic.
            await new Promise((resolve) => setTimeout(resolve, 30));
            pendingCleanup--;
            return value;
        });
    });
    const hook = createHook({
        init(_id, type) {
            if (type !== "WORKER") return;
            spawned++;
            peak = Math.max(peak, pendingCleanup + 1);
            abortTimer = setTimeout(() => controller.abort(), 50);
        },
    }).enable();
    try {
        assert.equal(Buffer.byteLength(nested), 330028);
        for (let i = 0; i < 4; i++) {
            controller = new AbortController();
            const packet = await runtime.page(
                pageArgs,
                { ...defaults, concurrency: 1 },
                controller.signal,
            );
            assert.equal(packet.page.error.kind, "cancelled");
            assert.equal(pendingCleanup, 0, "return waits for cooperative cleanup");
            assert.ok(
                workers.every((worker) => worker.threadId === -1),
                "all actual workers exited",
            );
            assert.equal(runtime.semaphore.running, 0);
            assert.equal(runtime.busy, false);
        }
        assert.equal(spawned, 4);
        assert.equal(peak, 1, "successive calls never start during previous worker cleanup");
        assert.ok(responses.every((response) => response.destroyed));
    } finally {
        hook.disable();
        clearTimeout(abortTimer);
    }
});

test("actual Runtime.page hostile-body timeout remains responsive and cleans worker and signal", async (t) => {
    const responses = [];
    const workers = [];
    const original = Worker.prototype.terminate;
    t.mock.method(Worker.prototype, "terminate", function(...args) {
        workers.push(this);
        return original.apply(this, args);
    });
    const runtime = offlinePageRuntime(nested, responses);
    let ticks = 0;
    const tick = setInterval(() => ticks++, 10);
    const started = performance.now();
    try {
        const packet = await runtime.page(pageArgs, {
            ...defaults,
            concurrency: 1,
            pageTimeoutMs: 1000,
        });
        assert.equal(packet.page.error.kind, "timeout");
        assert.ok(performance.now() - started < 2000);
        assert.ok(ticks >= 5);
        assert.equal(workers.length, 1);
        assert.equal(workers[0].threadId, -1);
        assert.equal(runtime.semaphore.running, 0);
        assert.ok(responses.every((response) => response.destroyed));
    } finally {
        clearInterval(tick);
    }
    let cleaned = false;
    let captured;
    const dns = offlinePageRuntime("", [], (_host, signal) => {
        captured = signal;
        return new Promise((_resolve, reject) => {
            const abort = () => {
                signal.removeEventListener("abort", abort);
                cleaned = true;
                reject(signal.reason);
            };

            signal.addEventListener("abort", abort, { once: true });
        });
    });
    const packet = await dns.page(pageArgs, { ...defaults, pageTimeoutMs: 20 });
    assert.equal(packet.page.error.kind, "timeout");
    assert.equal(captured.aborted, true);
    assert.equal(cleaned, true);
    assert.equal(dns.busy, false);
    assert.equal(dns.semaphore.running, 0);
});
