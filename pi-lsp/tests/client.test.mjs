import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { fileURLToPath } from "node:url";
register();
const { LspClient } = await import("../src/client.ts");
const fixture = fileURLToPath(new URL("./fixtures/server.mjs", import.meta.url));
async function run(mode, callback, overrides = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const client = new LspClient(
        {
            name: "fixture",
            command: [process.execPath, fixture, mode],
            extensions: [".txt"],
            diagnosticsSettleMs: 40,
            pushDiagnosticsGraceMs: 90,
            pullDiagnosticsGraceMs: 90,
            ...overrides,
        },
        process.cwd(),
        controller.signal,
    );
    try {
        await client.start();
        await callback(client, controller);
    } finally {
        clearTimeout(timer);
        await client.shutdown();
    }
}
for (const mode of ["push", "pull", "pull-late", "fragmented", "multi", "stderr"]) {
    test(`${mode} returns diagnostics`, () =>
        run(mode, async (client) => {
            client.open("file:///test.txt", "x", "plaintext");
            const result = await client.diagnostics("file:///test.txt");
            assert.equal(result.complete, true);
            assert.equal(result.diagnostics[0].message, "fixture");
        }));
}
for (
    const envelope of [
        "null",
        "[]",
        "{}",
        "{\"jsonrpc\":\"1.0\",\"method\":\"test\"}",
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":null,\"error\":{\"code\":1,\"message\":\"bad\"}}",
        "{\"jsonrpc\":\"2.0\",\"method\":\"test\",\"params\":null}",
        "{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":null}",
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":\"bad\",\"message\":\"bad\"}}",
    ]
) {
    test(`invalid envelope fails: ${envelope}`, () =>
        run(`envelope:${envelope}`, async (client) => {
            client.open("file:///test.txt", "", "plaintext");
            await assert.rejects(client.diagnostics("file:///test.txt"), /protocol|Invalid/i);
        }));
}
for (
    const kind of [
        "duplicate",
        "reversed",
        "whitespace",
        "folded",
        "suffix",
        "utf8-message",
        "utf8-extra",
    ]
) {
    for (const fragmentation of ["whole", "7"]) {
        test(`raw ${kind} (${fragmentation}) fails explicitly`, () =>
            run(`raw:${kind}:${fragmentation}`, async (client) => {
                client.open("file:///test.txt", "", "plaintext");
                await assert.rejects(client.diagnostics("file:///test.txt"), /LSP protocol error/);
            }, { pushDiagnosticsGraceMs: 1500 }));
    }
}
test("server requests and static initialization capabilities", () =>
    run("requests", async (client) => {
        const [action] = await client.codeActions("file:///test.txt", "", [], "quickfix");
        const report = JSON.parse(action.title);
        assert.equal(report.initialized, true);
        assert.deepEqual(report.settings, { nested: { value: 4 } });
        assert.deepEqual(report.responses[0], [4, null, { nested: { value: 4 } }]);
        assert.equal(report.responses[1][0].uri, report.initialization.rootUri);
        assert.equal(report.responses[2], null);
        assert.equal(report.responses[3].applied, false);
        assert.deepEqual(report.responses.slice(4), [-32601, -32601]);
        const capabilities = report.initialization.capabilities;
        assert.deepEqual(capabilities.general.positionEncodings, ["utf-16"]);
        for (const key of ["synchronization", "diagnostic", "codeAction"]) {
            assert.equal(capabilities.textDocument[key].dynamicRegistration, false);
        }
    }, { initialization: { nested: { value: 4 } } }));
test("CR-only code actions cover the full document", () =>
    run("range", async (client) => {
        const actions = await client.codeActions("file:///test.txt", "a\rb", [], "quickfix");
        assert.deepEqual(JSON.parse(actions[0].title).end, { line: 1, character: 1 });
    }));
function lifecycleClient(signal = new AbortController().signal) {
    return new LspClient(
        { name: "lifecycle", command: [process.execPath, fixture, "silent"], extensions: [".txt"] },
        process.cwd(),
        signal,
    );
}
test("concurrent starts share one session and cleanup terminates its child", async () => {
    const client = lifecycleClient();
    try {
        const first = client.start();
        assert.strictEqual(client.start(), first);
        await first;
        const child = client.process;
        assert.ok(child?.pid);
        await client.shutdown();
        assert.ok(child.exitCode !== null || child.signalCode !== null);
    } finally {
        await client.shutdown();
    }
});
test("immediate shutdown prevents a late spawn", async () => {
    const client = lifecycleClient();
    const starting = client.start();
    const rejection = assert.rejects(starting, /shutting down|cancelled/);
    await client.shutdown();
    await rejection;
    assert.equal(client.process, undefined);
    assert.strictEqual(client.shutdown(), client.shutdown());
});
test("shutdown before start rejects startup", async () => {
    const client = lifecycleClient();
    await client.shutdown();
    await assert.rejects(client.start(), /closed/);
    assert.equal(client.process, undefined);
});
test("abort during command resolution prevents spawn", async () => {
    const controller = new AbortController();
    const client = lifecycleClient(controller.signal);
    const starting = client.start();
    controller.abort();
    try {
        await assert.rejects(starting, { name: "AbortError" });
    } finally {
        await client.shutdown();
    }
    assert.equal(client.process, undefined);
});
test("unset pull grace returns empty immediately", () =>
    run("pull-late", async (client) => {
        client.open("file:///test.txt", "", "plaintext");
        const result = await client.diagnostics("file:///test.txt");
        assert.deepEqual(result.diagnostics, []);
        assert.equal(result.complete, true);
    }, { pullDiagnosticsGraceMs: undefined }));
test("unset push grace waits for route cancellation", () =>
    run("silent", async (client, controller) => {
        client.open("file:///test.txt", "", "plaintext");
        const timer = setTimeout(() => controller.abort(), 120);
        try {
            await assert.rejects(client.diagnostics("file:///test.txt"), /deadline/);
        } finally {
            clearTimeout(timer);
        }
    }, { pushDiagnosticsGraceMs: undefined }));
test("explicit empty is complete", () =>
    run("empty", async (client) => {
        client.open("file:///test.txt", "", "plaintext");
        assert.equal((await client.diagnostics("file:///test.txt")).complete, true);
    }));
test("silent push is incomplete", () =>
    run("silent", async (client) => {
        client.open("file:///test.txt", "", "plaintext");
        assert.equal((await client.diagnostics("file:///test.txt")).complete, false);
    }));
for (const mode of ["malformed", "oversized", "invalid-diagnostic"]) {
    test(`${mode} fails explicitly`, () =>
        run(mode, async (client) => {
            client.open("file:///test.txt", "", "plaintext");
            await assert.rejects(client.diagnostics("file:///test.txt"), /protocol|frame|Invalid/i);
        }));
}
test("ignored shutdown and TERM are bounded", () =>
    run("stubborn", async (client) => {
        const warnings = await client.shutdown();
        assert.ok(warnings.some((warning) => warning.includes("SIGKILL")));
    }));
test("initial unchanged is rejected", () =>
    run("pull-unchanged", async (client) => {
        client.open("file:///test.txt", "", "plaintext");
        await assert.rejects(client.diagnostics("file:///test.txt"), /expected full/);
    }));
test("actions resolve and shutdown is idempotent", () =>
    run("silent", async (client) => {
        assert.equal(client.supportsResolve, true);
        const actions = await client.codeActions("file:///test.txt", "x", [], "quickfix");
        assert.deepEqual((await client.resolveAction(actions[0])).edit, { changes: {} });
        assert.strictEqual(client.shutdown(), client.shutdown());
    }));
test("unsupported encoding is rejected", async () => {
    await assert.rejects(run("encoding", async () => {}), /Unsupported position encoding/);
});
test("process exit rejects diagnostics", () =>
    run("exit", async (client) => {
        client.open("file:///test.txt", "", "plaintext");
        await assert.rejects(client.diagnostics("file:///test.txt"), /exited/);
    }));
test("initialization observes route cancellation", async () => {
    const controller = new AbortController();
    const client = new LspClient(
        { name: "delay", command: [process.execPath, fixture, "init-delay"], extensions: [".txt"] },
        process.cwd(),
        controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 100);
    try {
        await assert.rejects(client.start(), /deadline/);
    } finally {
        clearTimeout(timer);
        await client.shutdown();
    }
});
test("deadline cancellation returns latest push incomplete", () =>
    run("push", async (client, controller) => {
        client.open("file:///test.txt", "", "plaintext");
        setTimeout(() => controller.abort(), 25);
        const result = await client.diagnostics("file:///test.txt");
        assert.equal(result.complete, false);
    }));
