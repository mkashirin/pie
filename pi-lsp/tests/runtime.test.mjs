import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";
register();
const { Runtime } = await import("../src/runtime.ts");
const { Value } = await import("typebox/value");
const { PacketSchema } = await import("../src/results.ts");
const fixture = fileURLToPath(new URL("./fixtures/server.mjs", import.meta.url));
async function setup(t, mode = "push") {
    const dir = await mkdtemp(join(tmpdir(), "lsp-runtime-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, "a.txt"), "x");
    await writeFile(
        join(dir, "pi-lsp.json"),
        JSON.stringify({
            servers: {
                fixture: {
                    command: [process.execPath, fixture, mode],
                    extensions: [".txt"],
                    diagnosticsSettleMs: 20,
                    pushDiagnosticsGraceMs: 50,
                },
            },
        }),
    );
    return dir;
}
test("real fake-server invocation preserves findings and complete outcomes", async (t) => {
    const dir = await setup(t);
    const runtime = new Runtime();
    const result = await runtime.execute(
        "lsp_diagnostics",
        "one",
        { paths: ["a.txt"] },
        dir,
        dir,
        false,
    );
    assert.equal(result.details.status, "success");
    assert.equal(result.isError, false);
    assert.equal(result.details.routes[0].files[0].diagnostics[0].message, "fixture");
    assert.equal(runtime.busy, 0);
    await runtime.stop();
});
test("fractional deadlines fail normally rather than rejecting the configured delay", async (t) => {
    const dir = await setup(t);
    await configure(dir, { fixture: server("silent") }, 0.5);
    const runtime = new Runtime();
    t.after(() => runtime.stop());
    const result = await runtime.execute("lsp_diagnostics", "fraction", {}, dir, dir, false);
    assert.equal(result.details.status, "failure");
    assert.equal(result.details.error, undefined);
    assert.equal(JSON.stringify(result.details).includes("RangeError"), false);
    assert.match(JSON.stringify(result.details), /TimeoutError/);
    assert.equal(runtime.busy, 0);
});
test("huge deadlines succeed, dispose skipped/completed routes and propagate cancellation", async (t) => {
    const dir = await setup(t);
    const warnings = [];
    const onWarning = (warning) => warnings.push(warning);
    process.on("warning", onWarning);
    t.after(() => process.removeListener("warning", onWarning));
    const signals = [];
    let wait = false;
    let started;
    const runtime = new Runtime((_server, _root, signal) => {
        signals.push(signal);
        return {
            async start() {
                started?.();
                if (wait) {
                    await new Promise((resolve, reject) => {
                        if (signal.aborted) reject(signal.reason);
                        else {signal.addEventListener("abort", () => reject(signal.reason), {
                                once: true,
                            });}
                    });
                }
            },
            open() {},
            closeDocument() {},
            async diagnostics() {
                return { complete: true, diagnostics: [], warnings: [] };
            },
            async shutdown() {
                return [];
            },
        };
    });
    t.after(() => runtime.stop());
    for (const timeout of [2147483648, 4294967296, Number.MAX_VALUE]) {
        await configure(dir, { skipped: server("push", [".js"]), fast: server("push") }, timeout);
        const result = await runtime.execute("lsp_diagnostics", "huge", {}, dir, dir, false);
        assert.equal(result.details.status, "success");
        assert.equal(result.details.routes[0].skipped, true);
        assert.equal(signals.at(-1).aborted, false);
    }
    // Disposed deadlines must no longer relay parent cancellation to finished clients.
    const finished = [...signals];
    wait = true;
    const ready = new Promise((resolve) => started = resolve);
    const controller = new AbortController();
    const pending = runtime.execute(
        "lsp_diagnostics",
        "cancel-huge",
        {},
        dir,
        dir,
        false,
        controller.signal,
    );
    await ready;
    controller.abort(new Error("cancel huge deadline"));
    assert.equal((await pending).details.status, "cancelled");
    assert.equal(signals.at(-1).reason.message, "cancel huge deadline");
    await runtime.stop();
    assert.ok(finished.every((signal) => !signal.aborted));
    assert.equal(runtime.busy, 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(warnings.some((warning) => warning.name === "TimeoutOverflowWarning"), false);
});
test("reload fails closed and execute validates independently", async (t) => {
    const dir = await setup(t);
    const runtime = new Runtime();
    const bad = await runtime.execute(
        "lsp_fix",
        "bad",
        { path: "a.txt", server: ["fixture"] },
        dir,
        dir,
        false,
    );
    assert.equal(bad.isError, true);
    await writeFile(join(dir, "pi-lsp.json"), "{");
    const result = await runtime.execute("lsp_diagnostics", "two", {}, dir, dir, false);
    assert.equal(result.details.status, "failure");
    assert.equal(result.details.routes.length, 0);
});
const server = (mode, extensions = [".txt"]) => ({
    command: [process.execPath, fixture, mode],
    extensions,
    diagnosticsSettleMs: 10,
});
async function configure(dir, servers, timeout = 2000) {
    await writeFile(join(dir, "pi-lsp.json"), JSON.stringify({ servers, timeout }));
}
test("complementary routes filter files and ordinary failures do not stop later servers", async (t) => {
    const dir = await setup(t);
    await writeFile(join(dir, "b.js"), "x");
    await configure(dir, {
        broken: server("exit"),
        text: server("push"),
        script: server("push", [".js"]),
    });
    const runtime = new Runtime();
    t.after(() => runtime.stop());
    const result = await runtime.execute("lsp_diagnostics", "routes", {}, dir, dir, false);
    assert.equal(result.isError, true);
    assert.deepEqual(result.details.routes.map((route) => route.server), [
        "broken",
        "text",
        "script",
    ]);
    assert.equal(result.details.routes[0].complete, false);
    for (const [index, file] of [[1, "a.txt"], [2, "b.js"]]) {
        assert.equal(result.details.routes[index].complete, true);
        assert.deepEqual(result.details.routes[index].files.map((outcome) => outcome.path), [
            await realpath(join(dir, file)),
        ]);
    }
});
test("per-route limits and silent deadlines remain incomplete and bounded", async (t) => {
    const dir = await setup(t);
    await writeFile(join(dir, "b.txt"), "x");
    await configure(dir, { limited: server("push"), silent: server("silent") }, 500);
    const runtime = new Runtime();
    t.after(() => runtime.stop());
    const result = await runtime.execute(
        "lsp_diagnostics",
        "limits",
        { limit: 1 },
        dir,
        dir,
        false,
    );
    assert.equal(result.isError, true);
    assert.equal(result.details.routes[0].limited, true);
    assert.equal(result.details.routes[0].files.length, 1);
    assert.equal(result.details.routes[1].complete, false);
    assert.equal(runtime.busy, 0);
});
test("user cancellation retains completed earlier routes", async (t) => {
    const dir = await setup(t);
    await configure(dir, { done: server("push"), waiting: server("silent") }, 10000);
    const runtime = new Runtime();
    t.after(() => runtime.stop());
    const controller = new AbortController();
    const pending = runtime.execute(
        "lsp_diagnostics",
        "cancel",
        {},
        dir,
        dir,
        false,
        controller.signal,
    );
    // Give the first child ample time to finish; second route cannot finish without abort.
    const timer = setTimeout(() => controller.abort(new Error("user cancelled")), 1500);
    t.after(() => clearTimeout(timer));
    const result = await pending;
    assert.equal(result.details.status, "cancelled");
    assert.equal(result.details.routes[0].complete, true);
    assert.equal(result.details.routes[0].files[0].diagnostics[0].message, "fixture");
});
test("configuration reload changes server selection on each invocation", async (t) => {
    const dir = await setup(t);
    const runtime = new Runtime();
    t.after(() => runtime.stop());
    for (const name of ["first", "second"]) {
        await configure(dir, { [name]: server("pull") });
        const result = await runtime.execute("lsp_diagnostics", name, {}, dir, dir, false);
        assert.equal(result.details.status, "success");
        assert.deepEqual(result.details.routes.map((route) => route.server), [name]);
    }
});
test("queued fix cancellation drains without waiting for host mutation or changing bytes", async (t) => {
    const dir = await setup(t, "exit");
    const path = await realpath(join(dir, "a.txt"));
    let release;
    let started;
    const ready = new Promise((resolve) => {
        started = resolve;
    });
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const blocker = withFileMutationQueue(path, async () => {
        started();
        await gate;
    });
    await ready;
    const runtime = new Runtime();
    const controller = new AbortController();
    let timer;
    try {
        const pending = runtime.execute(
            "lsp_fix",
            "queued",
            { path: "a.txt", write: true },
            dir,
            dir,
            false,
            controller.signal,
        );
        // Allow configuration/discovery to reach the already occupied host queue.
        await new Promise((resolve) => setTimeout(resolve, 100));
        controller.abort(new Error("cancel queued fix"));
        const result = await Promise.race([
            pending,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("queued fix failed to cancel promptly")),
                    1000,
                );
            }),
        ]);
        assert.equal(result.details.status, "cancelled");
        await runtime.stop();
        assert.equal(runtime.busy, 0);
    } finally {
        clearTimeout(timer);
        release();
        await blocker;
        await withFileMutationQueue(path, async () => {});
        await runtime.stop();
    }
    assert.equal(await readFile(path, "utf8"), "x");
});
test("explicit inputs fail before spawning, including beyond a file limit", async (t) => {
    const dir = await setup(t);
    await writeFile(join(dir, "b.unknown"), "x");
    let spawned = 0;
    const runtime = new Runtime(() => {
        spawned++;
        throw new Error("must not spawn");
    });
    for (const paths of [["a.txt", "b.unknown"], ["a.txt", "missing.txt"]]) {
        const result = await runtime.execute(
            "lsp_diagnostics",
            "explicit",
            { paths, limit: 1 },
            dir,
            dir,
            false,
        );
        assert.equal(result.details.status, "failure");
        assert.match(result.details.error.message, /b\.unknown|missing\.txt/);
        assert.equal(Value.Check(PacketSchema, result.details), true);
        assert.deepEqual(result.details.routes, []);
    }
    assert.equal(spawned, 0);
});
test("root-only unsupported files do not produce success", async (t) => {
    const dir = await setup(t);
    await configure(dir, { other: server("push", [".unknown"]) });
    const result = await new Runtime().execute("lsp_diagnostics", "empty", {}, dir, dir, false);
    assert.equal(result.details.status, "failure");
    assert.match(result.details.error.message, /No matching files/);
    assert.equal(Value.Check(PacketSchema, result.details), true);
});
test("case-sensitive routing and alias containment", async (t) => {
    const dir = await setup(t);
    await writeFile(join(dir, "case.C"), "x");
    await writeFile(join(dir, "case.c"), "x");
    await configure(dir, { upper: server("push", [".C"]), lower: server("push", [".c"]) });
    const runtime = new Runtime();
    t.after(() => runtime.stop());
    const result = await runtime.execute(
        "lsp_diagnostics",
        "case",
        { paths: ["@case.C"] },
        dir,
        dir,
        false,
    );
    assert.equal(result.details.status, "success");
    assert.equal(result.details.routes.find((r) => r.server === "upper").files.length, 1);
    assert.equal(result.details.routes.find((r) => r.server === "lower").skipped, true);
    const outside = await mkdtemp(join(tmpdir(), "lsp-outside-"));
    t.after(() => rm(outside, { recursive: true, force: true }));
    await symlink(outside, join(dir, "escape"));
    const escaped = await runtime.execute(
        "lsp_diagnostics",
        "escape",
        { paths: ["@escape"] },
        dir,
        dir,
        false,
    );
    assert.equal(escaped.details.status, "failure");
    assert.match(escaped.details.error.message, /outside root/);
});
test("discovery traversal warnings mean incomplete coverage", async (t) => {
    const dir = await setup(t);
    await symlink(join(dir, "absent"), join(dir, "broken"));
    const result = await new Runtime().execute("lsp_diagnostics", "warning", {}, dir, dir, false);
    assert.equal(result.details.status, "partial");
    assert.equal(result.details.routes[0].complete, false);
    assert.ok(result.details.warnings.some((w) => w.includes("Skipped")));
});
test("activity publishes actual overlap and ignores stale session completions and UI errors", async (t) => {
    const dir = await setup(t, "silent");
    const runtime = new Runtime();
    const counts = [];
    runtime.setActivity((count) => counts.push(count));
    const pending = [1, 2].map((id) =>
        runtime.execute("lsp_diagnostics", String(id), {}, dir, dir, false)
    );
    assert.deepEqual(counts, [0, 1, 2]);
    runtime.beginSession();
    const fresh = [];
    runtime.setActivity((count) => fresh.push(count));
    await Promise.all(pending);
    assert.deepEqual(fresh, [0]);
    runtime.setActivity(() => {
        throw new Error("UI failure");
    });
    const next = runtime.execute("lsp_diagnostics", "next", {}, dir, dir, false);
    await runtime.stop();
    assert.equal((await next).details.status, "cancelled");
    assert.equal(runtime.busy, 0);
});
test("committed fixes survive late user abort, deadline and shutdown failure", async (t) => {
    const dir = await setup(t);
    await configure(dir, { fixture: server("push") }, 30);
    const controller = new AbortController();
    const runtime = new Runtime((_server, _root, signal) => ({
        async start() {},
        open() {},
        closeDocument() {
            throw new Error("close failed");
        },
        async diagnostics() {
            return { complete: true, diagnostics: [], warnings: [] };
        },
        async codeActions(uri) {
            return [{
                title: "fix",
                kind: "source.fixAll",
                edit: {
                    changes: {
                        [uri]: [{
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 1 },
                            },
                            newText: "y",
                        }],
                    },
                },
            }];
        },
        async shutdown() {
            assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "y");
            controller.abort(new Error("late abort"));
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.equal(signal.aborted, true);
            throw new Error("shutdown failed");
        },
    }));
    const result = await runtime.execute(
        "lsp_fix",
        "commit",
        { path: "a.txt", write: true },
        dir,
        dir,
        false,
        controller.signal,
    );
    assert.equal(result.details.fix.written, true);
    assert.equal(result.details.fix.changed, true);
    assert.equal(result.details.status, "cancelled");
    assert.ok(result.details.warnings.some((w) => w.includes("shutdown failed")));
    assert.equal(Value.Check(PacketSchema, result.details), true);
    assert.equal(runtime.busy, 0);
});
test("session replacement aborts and drains overlapping activity", async (t) => {
    const dir = await setup(t, "silent");
    const runtime = new Runtime();
    const pending = [1, 2].map((id) =>
        runtime.execute("lsp_diagnostics", String(id), {}, dir, dir, false)
    );
    assert.equal(runtime.busy, 2);
    runtime.beginSession();
    for (const result of await Promise.all(pending)) {
        assert.equal(result.details.status, "cancelled");
    }
    await runtime.stop();
    assert.equal(runtime.busy, 0);
});
