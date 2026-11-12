import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
    call,
    environment,
    harness,
    report,
    runtime,
    searchPacket,
    state,
    stream,
    tool,
} from "./helpers.mjs";

function deferred() {
    let resolve;
    const promise = new Promise((done) => resolve = done);
    return { promise, resolve };
}

function hostFor(e, ledger = new state.Ledger()) {
    e.ctx.tools = [];
    return {
        pi: { getAllTools: () => [], getActiveTools: () => [] },
        config: () => e.config,
        settings: () => ({}),
        ledger: () => ledger,
        authorize: async () => undefined,
    };
}

function child(prompt) {
    return {
        state: {},
        subscribe: () => () => {},
        abort() {},
        async waitForIdle() {},
        prompt,
    };
}

test("progress omits evidence payloads, reuses frozen settled runs, and retains complete final data", async (t) => {
    const e = await environment(t);
    const ledger = new state.Ledger();
    const host = hostFor(e, ledger);
    const waiting = deferred();
    const release = deferred();
    const completed = deferred();
    t.after(() => release.resolve());
    const updates = [];
    let heartbeat;
    let payloadReads = 0;
    const evidence = {
        id: "evidence-large",
        owner: "",
        tool: "openai_search",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        isError: false,
        inspection: "search",
        text: "large evidence ".repeat(200000),
        get details() {
            payloadReads++;
            return { full: "provider packet" };
        },
    };
    const runner = new runtime.Runtime(host, (options) =>
        child(async (input) => {
            if (input.includes("Wait for sibling")) {
                waiting.resolve();
                await release.promise;
            } else {
                const run = [...ledger.runs.values()].find((r) => r.task === "Retrieve evidence");
                evidence.owner = run.id;
                run.evidence.push(evidence);
            }
            await options.initialState.tools.find((tool) => tool.name === "agent_report").execute(
                "report",
                report({ summary: "Full final report", verification: ["Inspected"] }),
            );
        }));
    const pending = runner.run(
        [
            { agent: "scout", task: "Retrieve evidence" },
            { agent: "scout", task: "Wait for sibling" },
        ],
        e.ctx,
        undefined,
        (batch) => {
            updates.push(batch);
            if (batch.results[0].reportBytes > 0) completed.resolve();
        },
        (refresh) => {
            heartbeat = refresh;
            return () => {};
        },
    );
    await Promise.all([waiting.promise, completed.promise]);
    const terminal = updates.at(-1).results[0];
    const saved = JSON.stringify(terminal);
    assert.deepEqual(terminal.evidence, [{
        id: evidence.id,
        owner: evidence.owner,
        tool: evidence.tool,
        retrievedAt: evidence.retrievedAt,
        isError: false,
        inspection: "search",
    }]);
    assert.equal(payloadReads, 0);
    assert.ok(Object.isFrozen(terminal));
    assert.ok(Object.isFrozen(terminal.report.verification));
    assert.throws(() => terminal.report.verification.push("mutate"), TypeError);
    for (let i = 0; i < 5; i++) {
        heartbeat();
        assert.strictEqual(updates.at(-1).results[0], terminal);
    }
    assert.equal(JSON.stringify(terminal), saved);
    assert.ok(JSON.stringify(updates).length < evidence.text.length / 10);
    release.resolve();
    const final = await pending;
    assert.equal(payloadReads, 0);
    assert.strictEqual(final.results[0].evidence[0], evidence);
    assert.equal(final.results[0].evidence[0].details.full, "provider packet");
    assert.equal(final.results[0].evidence[0].text, evidence.text);
    assert.equal(
        final.results[0].reportBytes,
        Buffer.byteLength(state.reportText(final.results[0])),
    );
    assert.equal(final.results[0].report.summary, "Full final report");
    assert.ok(!Object.isFrozen(final.results[0].report));
    const count = updates.length;
    heartbeat();
    assert.equal(updates.length, count);
});

test("headless runtime without a progress consumer does not clone progress snapshots", async (t) => {
    const e = await environment(t);
    const host = hostFor(e);
    let clones = 0;
    const clone = globalThis.structuredClone;
    t.mock.method(globalThis, "structuredClone", (...args) => {
        clones++;
        return clone(...args);
    });
    const runner = new runtime.Runtime(host, (options) =>
        child(async () => {
            await options.initialState.tools.find((tool) => tool.name === "agent_report").execute(
                "report",
                report(),
            );
        }));
    const result = await runner.run([{ agent: "scout", task: "Inspect" }], e.ctx);
    assert.equal(result.results[0].status, "complete");
    assert.equal(clones, 0);
});

test("headless extension without onUpdate skips progress while preserving final results", async (t) => {
    const h = await harness(t);
    const cloned = [];
    const clone = globalThis.structuredClone;
    t.mock.method(globalThis, "structuredClone", (value) => {
        cloned.push(value);
        return clone(value);
    });
    const final = (await h.execute("subagents_run", {
        tasks: [{ agent: "scout", task: "Inspect without progress" }],
    })).result;
    assert.equal(final.details.results[0].status, "complete");
    assert.equal(final.structuredContent.results[0].id, final.details.results[0].id);
    assert.ok(cloned.every((value) => !("reportBytes" in value)));
});

test("final serialization selects native JSON for small results and the fast path for large evidence", async (t) => {
    const sourceText = "Source answer. ".repeat(10000);
    const h = await harness(t, {
        tools: [tool("openai_search", async () => ({
            content: [{ type: "text", text: sourceText }],
            details: searchPacket(),
        }))],
    });
    let batchSerializations = 0;
    const stringify = JSON.stringify;
    t.mock.method(JSON, "stringify", (value, ...args) => {
        if (Array.isArray(value?.results) && typeof value?.partial === "boolean") {
            batchSerializations++;
        }
        return stringify(value, ...args);
    });
    await h.execute("subagents_run", { tasks: [{ agent: "scout", task: "Small report" }] });
    assert.equal(batchSerializations, 1);
    h.ctx.modelRegistry.streamSimple = (model, context) =>
        stream(model, [
            context.messages.some((message) =>
                    message.role === "toolResult" && message.toolName === "openai_search"
                )
                ? call(
                    "agent_report",
                    report({
                        claims: [{
                            claim: "Source inspected",
                            evidence: [],
                            urls: [],
                            date: "",
                            uncertainty: "",
                        }],
                    }),
                )
                : call("openai_search", { queries: ["primary source"] }),
        ]);
    const final = (await h.execute("subagents_run", {
        tasks: [{ agent: "researcher", task: "Inspect large evidence" }],
    })).result;
    assert.equal(final.details.results[0].status, "complete");
    assert.equal(batchSerializations, 1); // The large batch never encodes its strings.
    assert.ok(final.structuredContent.results[0].evidence[0].text.startsWith(sourceText));
    assert.deepEqual(final.structuredContent, JSON.parse(stringify(final.details)));
    assert.notEqual(
        final.structuredContent.results[0].evidence[0],
        final.details.results[0].evidence[0],
    );
});

test("repeated role assignments authenticate once per batch and refresh on subsequent calls", async (t) => {
    const e = await environment(t);
    const host = hostFor(e);
    let authentications = 0;
    e.ctx.modelRegistry.getApiKeyAndHeaders = async () => {
        authentications++;
        return { ok: true, apiKey: "fake" };
    };
    const runner = new runtime.Runtime(host, (options) =>
        child(async () => {
            await options.initialState.tools.find((tool) => tool.name === "agent_report").execute(
                "report",
                report(),
            );
        }));
    const tasks = ["one", "two", "three"].map((task) => ({ agent: "scout", task }));
    assert.equal((await runner.run(tasks, e.ctx)).partial, false);
    assert.equal(authentications, 1);
    assert.equal((await runner.run(tasks, e.ctx)).partial, false);
    assert.equal(authentications, 2);
});

test("queued children and later batches load fresh project context at their actual start", async (t) => {
    const e = await environment(t);
    const host = hostFor(e);
    e.config.user.concurrency = 1;
    await writeFile(join(e.cwd, "AGENTS.md"), "Original instructions");
    const prompts = [];
    const runner = new runtime.Runtime(host, (options) => {
        prompts.push(options.initialState.systemPrompt);
        return child(async (input) => {
            if (input.includes("Update instructions")) {
                await writeFile(join(e.cwd, "AGENTS.override.md"), "New overriding instructions");
            }
            await options.initialState.tools.find((tool) => tool.name === "agent_report").execute(
                "report",
                report(),
            );
        });
    });
    const result = await runner.run([
        { agent: "worker", task: "Update instructions" },
        { agent: "scout", task: "Inspect queued" },
    ], e.ctx);
    assert.equal(result.partial, false);
    assert.match(prompts[0], /Original instructions/);
    assert.match(prompts[1], /New overriding instructions/);
    assert.doesNotMatch(prompts[1], /Original instructions/);
    await writeFile(join(e.cwd, "AGENTS.override.md"), "External subsequent instructions");
    await runner.run([{ agent: "scout", task: "Inspect later" }], e.ctx);
    assert.match(prompts[2], /External subsequent instructions/);
});
