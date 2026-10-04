import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { call, harness, report, runtime, state, ui } from "./helpers.mjs";

const plainTheme = { fg: (_token, text) => text };

const row = (id, status = "queued", extra = {}) => ({
    id,
    agent: "scout",
    profile: "scout",
    model: "openai/gpt-6.1-sol",
    status,
    durationMs: 0,
    ...extra,
});

const batch = (...results) => ({ results, partial: false });

function fixture() {
    let now = 0;
    const ticks = new Set();
    const stopped = [];
    const events = [];
    const components = new Map();
    let renders = 0;
    const theme = { ...plainTheme };
    const ctx = {
        mode: "tui",
        hasUI: true,
        ui: {
            setWidget(key, factory, options) {
                components.get(key)?.dispose();
                components.delete(key);
                events.push({ key, factory, options });
                if (factory) {
                    components.set(key, factory({ requestRender: () => renders++ }, theme));
                }
            },
        },
    };
    const manager = new ui.FleetUI({
        everySecond(tick) {
            ticks.add(tick);
            return () => {
                stopped.push(tick);
                ticks.delete(tick);
            };
        },
    });

    const lines = (width = 240) => components.get(ui.FLEET_WIDGET)?.render(width) ?? [];

    return {
        ctx,
        manager,
        components,
        events,
        theme,
        ticks,
        stopped,
        lines,
        get renders() {
            return renders;
        },
        get now() {
            return now;
        },
        advance(ms) {
            now += ms;
            for (const tick of ticks) tick();
        },
    };
}

test("lazy clock, queued/running transitions, terminal clocks and merged call/run keys", () => {
    const f = fixture();
    assert.equal(f.ticks.size, 0);
    const a = f.manager.begin("a", f.ctx);
    const b = f.manager.begin("b", f.ctx);
    assert.equal(f.events.length, 0);
    a.update(batch(row("same"), row("second")));
    assert.equal(f.events[0].options.placement, "aboveEditor");
    assert.equal(f.ticks.size, 1);
    assert.match(f.lines()[1], /queued · 0s/);
    const renderCount = f.renders;
    f.advance(2000);
    assert.equal(f.renders, renderCount + 1);
    assert.match(f.lines()[1], /queued · 0s/); // Queue time is not execution time.
    a.update(batch(row("same", "running"), row("second")));
    assert.match(f.lines()[1], /running · 0s/);
    b.update(batch(row("same", "running", { lastActivity: "read" })));
    assert.equal(f.lines().length, 4); // Duplicate role AND run ID across different calls survive.
    f.advance(3000);
    a.update(batch(
        row("same", "complete", { durationMs: 2700 }),
        row("second", "incomplete", {
            durationMs: 1700,
        }),
    ));
    a.finish();
    assert.match(f.lines()[0], /1 calls · 3 runs/);
    assert.ok(f.lines().some((line) => /complete · 2s/.test(line)));
    assert.ok(f.lines().some((line) => /incomplete · 1s/.test(line)));
    f.advance(5000);
    assert.ok(f.lines().some((line) => /complete · 2s/.test(line)));
    b.update(batch(row("same", "failed", { durationMs: 9000 })));
    b.finish();
    assert.deepEqual(f.lines(), []);
    assert.equal(f.ticks.size, 0);
    assert.equal(f.stopped.length, 1);
    a.update(batch(row("resurrected", "running")));
    a.finish();
    f.manager.reset();
    assert.equal(f.events.length, 2);
    assert.equal(f.stopped.length, 1);
});

test("cancellation, error cleanup, reset, host disposal and stale timer/lease callbacks are idempotent", () => {
    for (const boundary of ["reset", "dispose", "finish", "cancel"]) {
        const f = fixture();
        const old = f.manager.begin("call", f.ctx);
        let oldRefreshes = 0;
        old.subscribeHeartbeat(() => oldRefreshes++);
        old.update(batch(row("old", "running")));
        const tick = [...f.ticks][0];
        const component = f.components.get(ui.FLEET_WIDGET);
        if (boundary === "reset") f.manager.reset();
        else if (boundary === "dispose") {
            // Pi removes disposed components from its map, without asking the owner to remove again.
            component.dispose();
            f.components.clear();
        } else old.finish(boundary === "cancel" ? "cancelled" : "failed");
        assert.equal(f.ticks.size, 0);
        const next = f.manager.begin("call", f.ctx);
        next.update(batch(row("new", "running")));
        const renders = f.renders;
        const refreshes = oldRefreshes;
        tick();
        old.update(batch(row("stale", "running")));
        old.finish();
        component.dispose();
        assert.equal(f.renders, renders);
        assert.equal(oldRefreshes, refreshes);
        assert.equal(f.lines().length, 2);
        assert.doesNotMatch(f.lines().join("\n"), /stale/);
        next.finish();
        f.manager.reset();
        assert.equal(f.ticks.size, 0);
        assert.equal(f.stopped.length, 2);
    }
});

test("throwing heartbeat subscribers are disabled once without starving healthy calls or cleanup", (t) => {
    for (const boundary of ["tick", "finish"]) {
        const warnings = [];
        t.mock.method(console, "warn", (...args) => warnings.push(args));
        const f = fixture();
        const a = f.manager.begin("a", f.ctx);
        const b = f.manager.begin("b", f.ctx);
        let failures = 0;
        let healthy = 0;
        const unsubscribe = a.subscribeHeartbeat(() => {
            failures++;
            throw new Error("broken refresh");
        });
        a.subscribeHeartbeat(() => {
            healthy++;
            a.update(batch(row("a", "running", { durationMs: f.now })));
        });
        b.subscribeHeartbeat(() => b.update(batch(row("b", "running", { durationMs: f.now }))));
        a.update(batch(row("a", "running")));
        b.update(batch(row("b", "running")));
        const staleTick = [...f.ticks][0];
        if (boundary === "tick") {
            assert.doesNotThrow(() => f.advance(2300));
            assert.doesNotThrow(() => f.advance(1000));
            assert.equal(failures, 1);
            assert.equal(healthy, 2);
            assert.match(f.lines()[1], /running · 3s/);
        }
        assert.doesNotThrow(() => a.finish("cancelled"));
        assert.equal(failures, 1);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0][0], /Disabled fleet heartbeat subscriber/);
        const frozen = f.lines().find((line) => /cancelled/.test(line));
        f.advance(2000);
        assert.ok(f.lines().includes(frozen));
        assert.ok(f.lines().some((line) => /running · [25]s/.test(line)));
        assert.equal(f.ticks.size, 1);
        const refreshCount = healthy;
        unsubscribe();
        unsubscribe();
        b.subscribeHeartbeat(() => {
            throw new Error("broken final refresh");
        });
        assert.doesNotThrow(() => b.finish("cancelled"));
        assert.equal(warnings.length, 2);
        assert.equal(f.components.size, 0);
        assert.equal(f.ticks.size, 0);
        assert.equal(f.stopped.length, 1);
        assert.doesNotThrow(staleTick);
        a.finish();
        b.finish();
        f.manager.reset();
        assert.equal(healthy, refreshCount);
        assert.equal(f.stopped.length, 1);
        t.mock.restoreAll();
    }
});

test("refresh failure after reset cannot release or tick replacement ownership", (t) => {
    t.mock.method(console, "warn", () => {});
    for (const boundary of ["tick", "finish"]) {
        const f = fixture();
        const old = f.manager.begin("call", f.ctx);
        old.update(batch(row("old", "running")));
        const staleTick = [...f.ticks][0];
        let next;
        let refreshes = 0;
        old.subscribeHeartbeat(() => {
            f.manager.reset();
            next = f.manager.begin("call", f.ctx);
            next.subscribeHeartbeat(() => refreshes++);
            next.update(batch(row("new", "running")));
            throw new Error("old subscriber failed after replacing the fleet");
        });
        assert.doesNotThrow(() => boundary === "tick" ? staleTick() : old.finish("cancelled"));
        assert.equal(f.ticks.size, 1);
        assert.match(f.lines()[1], /running/);
        assert.doesNotMatch(f.lines().join("\n"), /old|cancelled/);
        assert.equal(refreshes, 0);
        assert.doesNotThrow(staleTick);
        old.finish("cancelled");
        assert.equal(refreshes, 0);
        f.advance(1000);
        assert.equal(refreshes, 1);
        next.finish();
        assert.equal(f.components.size, 0);
        assert.equal(f.ticks.size, 0);
        assert.equal(f.stopped.length, 2);
    }
});

test("reset removes widget even when ticker disposal throws, and cannot retry stale ownership", () => {
    const f = fixture();
    let stops = 0;
    let staleTick;
    const manager = new ui.FleetUI({
        everySecond(tick) {
            staleTick = tick;
            return () => {
                stops++;
                throw new Error("ticker disposal failed");
            };
        },
    });
    const lease = manager.begin("call", f.ctx);
    lease.update(batch(row("run", "running")));
    assert.throws(() => manager.reset(), /ticker disposal failed/);
    assert.equal(f.components.size, 0);
    assert.equal(stops, 1);
    assert.doesNotThrow(staleTick);
    assert.doesNotThrow(() => lease.finish());
    assert.doesNotThrow(() => manager.reset());
    assert.equal(stops, 1);
});

test("throwing redraw is disabled once and cannot abort heartbeat or cleanup", (t) => {
    const warnings = [];
    t.mock.method(console, "warn", (...args) => warnings.push(args));
    const f = fixture();
    const install = f.ctx.ui.setWidget;
    f.ctx.ui.setWidget = (key, factory, options) =>
        install(
            key,
            factory && ((_tui, theme) =>
                factory({
                    requestRender() {
                        throw new Error("redraw failed");
                    },
                }, theme)),
            options,
        );
    const lease = f.manager.begin("call", f.ctx);
    let refreshes = 0;
    lease.subscribeHeartbeat(() => refreshes++);
    assert.doesNotThrow(() => lease.update(batch(row("run", "running"))));
    assert.doesNotThrow(() => f.advance(1000));
    assert.doesNotThrow(() => f.advance(1000));
    assert.equal(refreshes, 2);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Disabled fleet redraw/);
    assert.doesNotThrow(() => lease.finish("cancelled"));
    assert.equal(f.ticks.size, 0);
    assert.equal(f.components.size, 0);
});

test("a throwing diagnostic sink cannot escape tick or finish", (t) => {
    let warnings = 0;
    t.mock.method(console, "warn", () => {
        warnings++;
        throw new Error("broken diagnostic sink");
    });
    const f = fixture();
    const lease = f.manager.begin("call", f.ctx);
    lease.update(batch(row("a", "running")));
    lease.subscribeHeartbeat(() => {
        throw new Error("broken refresh");
    });
    assert.doesNotThrow(() => f.advance(1000));
    assert.doesNotThrow(() => f.advance(1000));
    lease.subscribeHeartbeat(() => {
        throw new Error("broken finish refresh");
    });
    assert.doesNotThrow(() => lease.finish("cancelled"));
    assert.equal(warnings, 2);
    assert.equal(f.ticks.size, 0);
    assert.equal(f.components.size, 0);
});

test("real interval subscriber exception does not terminate an isolated process", async () => {
    const source = `
        import assert from "node:assert/strict";
        import { createJiti } from "jiti";
        const { FleetUI } = await createJiti(import.meta.url, { fsCache: false }).import("./src/ui.ts");
        const manager = new FleetUI();
        const widgets = new Map();
        const ctx = { mode: "tui", hasUI: true, ui: {
            setWidget(key, factory) {
                widgets.get(key)?.dispose();
                widgets.delete(key);
                if (factory) widgets.set(key, factory({ requestRender() {} }, { fg: (_, text) => text }));
            }
        }};
        const a = manager.begin("bad", ctx);
        const b = manager.begin("healthy", ctx);
        let failures = 0;
        let ticks = 0;
        a.subscribeHeartbeat(() => { failures++; throw new Error("real heartbeat failure"); });
        a.update({ results: [], partial: false });
        b.update({ results: [{ id: "r", agent: "scout", profile: "scout", model: "fake", status: "running", durationMs: 0 }], partial: false });
        let watchdog;
        try {
            await new Promise((resolve, reject) => {
                watchdog = setTimeout(() => reject(new Error("heartbeat never arrived")), 5000);
                b.subscribeHeartbeat(() => { ticks++; resolve(); });
            });
            assert.equal(failures, 1);
            assert.equal(ticks, 1);
            a.finish("cancelled");
            b.subscribeHeartbeat(() => { throw new Error("real finish failure"); });
            b.finish("cancelled");
            assert.equal(widgets.size, 0);
            manager.reset();
            console.log("timer-cleanup-ok");
        } finally { clearTimeout(watchdog); }
    `;
    const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        ["--input-type=module", "-e", source],
        { cwd: new URL("../", import.meta.url), timeout: 20000 },
    );
    assert.match(stdout, /timer-cleanup-ok/);
    assert.equal((stderr.match(/Disabled fleet heartbeat subscriber/g) ?? []).length, 2);
});

test("cancelled rows can remain beside live calls but their elapsed clocks freeze", () => {
    const f = fixture();
    const a = f.manager.begin("a", f.ctx);
    const b = f.manager.begin("b", f.ctx);
    a.update(batch(row("a", "running")));
    b.update(batch(row("b", "running")));
    const unsubscribe = a.subscribeHeartbeat(() =>
        a.update(batch(row("a", "running", { durationMs: f.now })))
    );
    f.advance(3000);
    a.finish("cancelled");
    f.advance(10000);
    assert.ok(f.lines().some((line) => /cancelled · 3s/.test(line)));
    unsubscribe();
    unsubscribe();
    b.finish();
    assert.equal(f.ticks.size, 0);
});

test("bounded single-line Unicode/ANSI presentation, narrow widths, no widget margin and render-time themes", () => {
    const f = fixture();
    const lease = f.manager.begin("a", f.ctx);
    const malicious =
        "\x1b[31m界👩‍💻e\u0301\x1b[0m\n\t\rnext\x1b]8;;https://example.org\x07link\x1b]8;;\x07";
    lease.update(
        batch(
            ...Array.from({ length: 12 }, (_, i) =>
                row(String(i), i < 9 ? "complete" : "running", {
                    agent: malicious,
                    model: malicious.repeat(3),
                    lastActivity: malicious.repeat(5),
                })),
        ),
    );
    assert.equal(f.lines().length, 9);
    assert.match(f.lines()[0], /\+4 more/);
    assert.match(f.lines()[1], /running/); // Active rows outrank settled overflow.
    assert.equal(ui.compactText(malicious), "界👩‍💻é nextlink");
    for (const width of [0, 1, 2, 3, 8, 20, 80, 240]) {
        const lines = f.lines(width);
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
        // Pi's clipping utility may append a styling reset even to unstyled text.
        assert.ok(lines.every((line) => !/[\n\r\t\x1b]/.test(line.replace(/\x1b\[0m/g, ""))));
        assert.ok(lines.map(stripTerminalSequences).every((line) => !line.startsWith(" ")));
        if (width === 0) assert.deepEqual(lines, []);
        if (width === 1) {
            assert.equal(lines.length, 9);
            assert.ok(lines.map(stripTerminalSequences).every((line) => line === "…"));
        }
        if (width === 80) assert.match(stripTerminalSequences(lines[0]), /^Agents/);
    }
    f.theme.fg = (_token, value) => `\x1b[31m${value}\x1b[0m`;
    const first = f.lines()[0];
    f.theme.fg = (_token, value) => `\x1b[32m${value}\x1b[0m`;
    f.components.get(ui.FLEET_WIDGET).invalidate();
    assert.notEqual(f.lines()[0], first);
    assert.equal(stripTerminalSequences(f.lines()[0]), stripTerminalSequences(first));
    lease.finish();
});

test("RPC/print/JSON or unavailable UI never installs widgets or starts clocks", () => {
    for (const mode of ["rpc", "print", "json", "tui"]) {
        const f = fixture();
        f.ctx.mode = mode;
        f.ctx.hasUI = mode !== "tui";
        const lease = f.manager.begin("a", f.ctx);
        lease.update(batch(row("a", "running")));
        lease.finish();
        f.manager.reset();
        assert.equal(f.events.length, 0);
        assert.equal(f.ticks.size, 0);
    }
});

// Manually released model streams: no network, sleeps or wall-clock assumptions.
function controlledStreams() {
    const pending = [];
    const waiters = [];

    const started = () =>
        new Promise((resolve) => {
            if (pending.length) resolve(pending.shift());
            else waiters.push(resolve);
        });

    const stream = (m, _context, opts) => {
        const s = createAssistantMessageEventStream();
        const message = {
            role: "assistant",
            content: [],
            api: m.api,
            model: m.id,
            provider: m.provider,
            usage: state.emptyUsage(),
            stopReason: "stop",
            timestamp: 0,
        };
        let settled = false;

        const release = (content = [call("agent_report", report())], failure = false) => {
            if (settled) return;
            settled = true;
            opts.signal.removeEventListener("abort", abort);
            if (failure) {
                const error = {
                    ...message,
                    stopReason: "error",
                    errorMessage: "fake provider failure",
                };
                s.push({ type: "error", reason: "error", error });
                s.end(error);
            } else {
                const final = {
                    ...message,
                    content,
                    stopReason: content.some((c) => c.type === "toolCall") ? "toolUse" : "stop",
                };
                s.push({ type: "done", reason: final.stopReason, message: final });
                s.end(final);
            }
        };

        const abort = () => release([], true);

        opts.signal.addEventListener("abort", abort, { once: true });
        s.push({ type: "start", partial: message });
        s.push({
            type: "text_delta",
            contentIndex: 0,
            delta: "Inspecting 界\nfiles",
            partial: message,
        });
        if (opts.signal.aborted) abort();
        const next = { release };
        if (waiters.length) waiters.shift()(next);
        else pending.push(next);
        return s;
    };

    return { stream, started };
}

test("shared heartbeat republishes quiet tool cards, respects staggered starts and freezes terminals", async (t) => {
    let now = 10000;
    const ticks = new Set();
    let created = 0;
    let disposed = 0;
    let unsubscribed = 0;
    const run = runtime.Runtime.prototype.run;
    t.mock.method(runtime.Runtime.prototype, "run", function(...args) {
        const subscribe = args[4];
        args[4] = (refresh) => {
            const unsubscribe = subscribe(refresh);
            return () => {
                unsubscribed++;
                unsubscribe();
            };
        };
        return run.apply(this, args);
    });
    t.mock.method(Date, "now", () => now);
    t.mock.method(globalThis, "setInterval", (tick, ms) => {
        assert.equal(ms, 1000);
        created++;
        const timer = { tick, unref() {} };
        ticks.add(timer);
        return timer;
    });
    t.mock.method(globalThis, "clearInterval", (timer) => {
        if (ticks.delete(timer)) disposed++;
    });

    const advance = (ms) => {
        now += ms;
        for (const timer of ticks) timer.tick();
    };

    const streams = controlledStreams();
    const h = await harness(t, { mode: "tui", hasUI: true, stream: streams.stream });
    assert.equal(created, 0); // Extension factory and idle sessions own no clock.
    await mkdir(h.agentDir, { recursive: true });
    await writeFile(
        join(h.agentDir, "pi-openai-subagents.json"),
        JSON.stringify({ concurrency: 1 }),
    );
    await h.command("reload");
    const updatesA = [];
    const updatesB = [];
    const a = h.execute(
        "subagents_run",
        {
            tasks: [{ agent: "scout", task: "First" }, { agent: "scout", task: "Queued" }],
        },
        undefined,
        undefined,
        (update) => updatesA.push(structuredClone(update)),
    );
    const first = await streams.started();
    assert.equal(created, 1);
    const staleTick = [...ticks][0].tick;
    const count = updatesA.length;
    advance(2300); // No child events at all while the model stream waits.
    assert.equal(updatesA.length, count + 1);
    assert.deepEqual(updatesA.at(-1).details.results.map((r) => r.durationMs), [2300, 0]);
    const card = h.tools.get("subagents_run").renderResult(
        updatesA.at(-1),
        { expanded: false },
        plainTheme,
    );
    assert.deepEqual(card.render(240).slice(0, 3), [
        "scout · running",
        "Role: scout · Model: openai/old",
        "Elapsed: 2s · 0 turns",
    ]);
    assert.ok(h.widgetFrames.at(-1).some((line) => /running · 2s/.test(line)));
    first.release();
    const second = await streams.started(); // Its start is 2300ms after the first, not queue receipt.
    advance(1000);
    assert.deepEqual(updatesA.at(-1).details.results.map((r) => r.durationMs), [2300, 1000]);
    let queued;
    const queuedUpdate = new Promise((resolve) => {
        queued = resolve;
    });
    const b = h.execute(
        "subagents_run",
        { tasks: [{ agent: "scout", task: "Other call" }] },
        undefined,
        undefined,
        (update) => {
            updatesB.push(structuredClone(update));
            queued();
        },
    );
    await queuedUpdate;
    assert.equal(created, 1); // Concurrent calls share one timer.
    second.release();
    const third = await streams.started();
    const finalA = (await a).result.details.results;
    assert.equal(unsubscribed, 1);
    assert.deepEqual(finalA.map((r) => r.durationMs), [2300, 1000]);
    advance(2000);
    assert.equal(updatesB.at(-1).details.results[0].durationMs, 2000);
    assert.deepEqual(finalA.map((r) => r.durationMs), [2300, 1000]);
    assert.ok(h.widgetFrames.at(-1).some((line) => /complete · 1s/.test(line)));
    third.release();
    assert.equal((await b).result.details.results[0].durationMs, 2000);
    assert.equal(h.widgets.size, 0);
    assert.equal(ticks.size, 0);
    assert.equal(disposed, 1);
    assert.equal(unsubscribed, 2);
    const finalCount = updatesA.length + updatesB.length;
    staleTick();
    assert.equal(updatesA.length + updatesB.length, finalCount);
    assert.ok(!h.entries.some((e) => JSON.stringify(e.data).includes("\"started\"")));
});

test("throwing partial onUpdate during idle heartbeat leaves widget and concurrent model work healthy", async (t) => {
    let now = 10000;
    const ticks = new Set();
    let created = 0;
    let stopped = 0;
    const warnings = [];
    t.mock.method(Date, "now", () => now);
    t.mock.method(console, "warn", (...args) => warnings.push(args));
    t.mock.method(globalThis, "setInterval", (tick) => {
        created++;
        const timer = { tick, unref() {} };
        ticks.add(timer);
        return timer;
    });
    t.mock.method(globalThis, "clearInterval", (timer) => {
        if (ticks.delete(timer)) stopped++;
    });

    const advance = (ms) => {
        now += ms;
        for (const timer of ticks) timer.tick();
    };

    const streams = controlledStreams();
    const h = await harness(t, { mode: "tui", hasUI: true, stream: streams.stream });
    let failPublication = false;
    let publications = 0;
    let failures = 0;
    const a = h.execute(
        "subagents_run",
        { tasks: [{ agent: "scout", task: "Broken card" }] },
        undefined,
        undefined,
        () => {
            publications++;
            if (failPublication) {
                failures++;
                throw new Error("partial publication failed");
            }
        },
    );
    const first = await streams.started();
    const updates = [];
    const b = h.execute(
        "subagents_run",
        { tasks: [{ agent: "scout", task: "Healthy card" }] },
        undefined,
        undefined,
        (update) => updates.push(structuredClone(update)),
    );
    const second = await streams.started();
    const staleTick = [...ticks][0].tick;
    assert.equal(created, 1);
    failPublication = true;
    assert.doesNotThrow(() => advance(2300));
    const disabledCount = publications;
    assert.equal(failures, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Disabled subagents_run partial onUpdate/);
    assert.doesNotThrow(() => advance(1000));
    assert.equal(publications, disabledCount);
    assert.equal(updates.at(-1).details.results[0].durationMs, 3300);
    assert.equal(h.widgetFrames.at(-1).filter((line) => /running · 3s/.test(line)).length, 2);
    assert.equal(h.widgets.size, 1); // No aborted model or ownership loss after UI-only failure.
    first.release();
    const resultA = (await a).result.details.results[0];
    assert.equal(resultA.status, "complete");
    assert.equal(resultA.durationMs, 3300);
    assert.deepEqual(resultA.report.verification, []); // Warning isn't successful verification.
    advance(1000);
    assert.ok(h.widgetFrames.at(-1).some((line) => /complete · 3s/.test(line)));
    assert.equal(updates.at(-1).details.results[0].durationMs, 4300);
    second.release([], true);
    const resultB = (await b).result.details.results[0];
    assert.equal(resultB.status, "incomplete"); // Provider failure retains its own status/reason.
    assert.match(resultB.reason, /fake provider failure/);
    assert.equal(publications, disabledCount);
    assert.equal(warnings.length, 1);
    assert.equal(h.widgets.size, 0);
    assert.equal(ticks.size, 0);
    assert.equal(stopped, 1);
    const count = updates.length;
    assert.doesNotThrow(staleTick);
    assert.equal(updates.length, count);
    assert.ok(
        !h.entries.some((e) => /partial publication failed|Disabled/.test(JSON.stringify(e))),
    );
});

test("headless event snapshots measure actual elapsed without creating a heartbeat", async (t) => {
    let now = 1000;
    t.mock.method(Date, "now", () => now);
    t.mock.method(globalThis, "setInterval", () => {
        assert.fail("Headless execution must not allocate a UI interval");
    });
    const streams = controlledStreams();
    const h = await harness(t, { mode: "rpc", hasUI: true, stream: streams.stream });
    const updates = [];
    const run = h.execute(
        "subagents_run",
        { tasks: [{ agent: "scout", task: "Quiet" }] },
        undefined,
        undefined,
        (update) => updates.push(structuredClone(update)),
    );
    const pending = await streams.started();
    now += 3456;
    pending.release();
    assert.equal((await run).result.details.results[0].durationMs, 3456);
    assert.ok(updates.some((update) =>
        update.details.results[0].status === "running"
        && update.details.results[0].durationMs === 3456
    ));
    assert.equal(h.widgetEvents.length, 0);
});

test("real runtime updates fleet without onUpdate, with orchestration off and parallel batches", async (t) => {
    const streams = controlledStreams();
    const h = await harness(t, { mode: "tui", hasUI: true, stream: streams.stream });
    const a = h.execute("subagents_run", { tasks: [{ agent: "scout", task: "First" }] });
    const first = await streams.started();
    const b = h.execute("subagents_run", { tasks: [{ agent: "scout", task: "Second" }] });
    const second = await streams.started();
    assert.equal(h.widgets.size, 1);

    const lines = () => [...h.widgets.values()].flatMap((c) => c.render(240));

    assert.match(lines()[0], /2 calls · 2 runs/);
    assert.equal(lines().filter((line) => /^scout · running · \d+s$/.test(line)).length, 2);
    assert.ok(h.widgetFrames.flat().some((line) => /queued/.test(line)));
    assert.ok(h.widgetFrames.flat().some((line) => /running/.test(line)));
    first.release();
    assert.equal((await a).result.details.results[0].status, "complete");
    assert.ok(lines().some((line) => /complete/.test(line)));
    second.release([]);
    assert.equal((await b).result.details.results[0].status, "incomplete");
    assert.equal(h.widgets.size, 0);
    assert.doesNotMatch(
        h.widgetFrames.flat().join("\n"),
        /Inspecting 界 files|\[scout\]|openai\//,
    );
    assert.ok(h.widgetFrames.flat().some((line) => /incomplete/.test(line)));
    assert.equal(h.widgetEvents.filter((e) => e.content).length, 1);
    assert.equal(h.widgetEvents.filter((e) => !e.content).length, 1);
    assert.ok(!h.entries.some((e) => /fleet|clock/.test(e.customType)));
});

test("real queued cancellation removes fleet immediately and rejects late terminal callbacks", async (t) => {
    const streams = controlledStreams();
    const h = await harness(t, { mode: "tui", hasUI: true, stream: streams.stream });
    const ctrl = new AbortController();
    const run = h.execute("subagents_run", {
        tasks: Array.from({ length: 8 }, (_, i) => ({ agent: "scout", task: String(i) })),
    }, ctrl.signal);
    await streams.started();
    assert.ok(h.widgetFrames.flat().some((line) => /queued/.test(line)));
    ctrl.abort();
    assert.equal(h.widgets.size, 0);
    const eventCount = h.widgetEvents.length;
    const result = await run;
    assert.ok(result.result.details.results.every((r) => r.status === "cancelled"));
    assert.equal(h.widgetEvents.length, eventCount);
});

test("integration cleanup on validation/error and every session boundary, including stale callbacks", async (t) => {
    const h = await harness(t, { mode: "tui", hasUI: true });
    const invalid = await h.execute("subagents_run", {
        tasks: [{ agent: "nonexistent", task: "bad" }],
    });
    assert.equal(invalid.isError, true);
    assert.equal(h.widgetEvents.length, 0);
    const callbacks = [];
    const mockedRun = t.mock.method(
        runtime.Runtime.prototype,
        "run",
        async (_tasks, _ctx, _signal, update) => {
            update(batch(row("fake", "running")));
            callbacks.push(update);
            throw new Error("synthetic runtime failure");
        },
    );
    const failure = await h.execute("subagents_run", { tasks: [{ agent: "scout", task: "fail" }] });
    assert.equal(failure.isError, true);
    assert.equal(h.widgets.size, 0);
    callbacks.pop()(batch(row("late", "running")));
    assert.equal(h.widgets.size, 0);
    for (const boundary of ["session_tree", "session_start", "session_shutdown", "reload"]) {
        let settle;
        mockedRun.mock.mockImplementation((_tasks, _ctx, _signal, update) => {
            update(batch(row("old", "running")));
            callbacks.push(update);
            return new Promise((resolve) => {
                settle = resolve;
            });
        });
        const run = h.execute("subagents_run", { tasks: [{ agent: "scout", task: "old branch" }] });
        // Advance microtasks until the mocked Runtime.run has been invoked.
        while (!settle) await Promise.resolve();
        assert.equal(h.widgets.size, 1);
        if (boundary === "reload") await h.command("reload");
        else await h.emit(boundary, { reason: "reload" });
        assert.equal(h.widgets.size, 0);
        const count = h.widgetEvents.length;
        callbacks.pop()(batch(row("stale", "running")));
        settle(batch());
        await run;
        assert.equal(h.widgetEvents.length, count);
    }
});

test("headless/RPC integration does not touch widgets even when hasUI is true; onUpdate remains unchanged", async (t) => {
    for (const mode of ["print", "json", "rpc"]) {
        const h = await harness(t, { mode, hasUI: true });
        const updates = [];
        const result = await h.execute(
            "subagents_run",
            { tasks: [{ agent: "scout", task: "Headless" }] },
            undefined,
            undefined,
            (update) => updates.push(structuredClone(update)),
        );
        assert.equal(result.result.details.results[0].status, "complete");
        assert.equal(h.widgetEvents.length, 0);
        assert.ok(updates.some((update) => update.details.results[0].status === "queued"));
        assert.ok(updates.some((update) => update.details.results[0].status === "running"));
        assert.ok(updates.some((update) => update.details.results[0].status === "complete"));
        assert.match(updates[0].content[0].text, /^scout queued openai\/old/);
    }
});

test("absolute tool shell margin stays one; custom info/warning wrapping uses one column", async (t) => {
    await initTheme("dark");
    const { ToolExecutionComponent } = await import(
        new URL(
            "./modes/interactive/components/tool-execution.js",
            import.meta.resolve("@earendil-works/pi-coding-agent"),
        )
    );
    const h = await harness(t);
    const definition = h.tools.get("subagents_run");
    for (
        const args of [{}, { tasks: null }, { tasks: [null, {}] }, { tasks: [{ agent: "scout" }] }]
    ) {
        const inner = definition.renderCall(args, plainTheme);
        assert.ok(stripTerminalSequences(inner.render(80)[0]).startsWith("Subagents:"));
        const shell = new ToolExecutionComponent("subagents_run", "margin", args, {}, definition, {
            requestRender() {},
        }, h.cwd);
        const lines = shell.render(80).map(stripTerminalSequences).filter((line) => line.trim());
        assert.ok(lines[0].startsWith(" Subagents:"));
        assert.ok(!lines[0].startsWith("  "));
        shell.updateResult({
            content: [{ type: "text", text: "fallback output wraps across many narrow columns" }],
            details: undefined,
        });
        assert.ok(
            shell.render(20).map(stripTerminalSequences).filter((line) => line.trim()).every(
                (line) => line.startsWith(" ") && !line.startsWith("  "),
            ),
        );
    }
    for (const renderer of h.renderers.values()) {
        const component = renderer({
            content: "Command info wraps across many narrow columns\nWarning text here",
        });
        for (const width of [3, 8, 20, 80]) {
            const lines = component.render(width).map(stripTerminalSequences);
            assert.ok(lines.every((line) => visibleWidth(line) <= width));
            assert.ok(
                lines.filter((line) => line.trim()).every((line) =>
                    line.startsWith(" ") && !line.startsWith("  ")
                ),
            );
        }
    }
    const result = await h.execute("subagents_run", {
        tasks: [{ agent: "scout", task: "Margin" }],
    });
    const inner = definition.renderResult(result.result, { expanded: true }, plainTheme);
    assert.equal(stripTerminalSequences(inner.render(80)[0]), "scout · complete");
    const shell = new ToolExecutionComponent(
        "subagents_run",
        "result",
        { tasks: [{ agent: "scout" }] },
        {},
        definition,
        { requestRender() {} },
        h.cwd,
    );
    shell.updateResult(result.result);
    assert.ok(
        shell.render(80).map(stripTerminalSequences).some((line) =>
            line.trimEnd() === " scout · complete"
        ),
    );
    assert.equal(result.result.structuredContent.results[0].report.summary, "Task inspected");
});
