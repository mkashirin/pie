import { calculateCost } from "@earendil-works/pi-ai";
import { processResponsesStream } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import assert from "node:assert/strict";
import test from "node:test";
import { attachSearch, basePacket } from "../src/results.ts";
import { searchQuery } from "../src/search/index.ts";

const model = {
    provider: "openai",
    api: "openai-responses",
    id: "fixture",
    cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 },
    contextWindow: 100000,
    maxTokens: 1000,
    reasoning: false,
    input: ["text"],
    name: "fixture",
};
const usage = {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const message = (text = "Answer", u = usage) => ({
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: u,
    stopReason: "stop",
    timestamp: 1,
});

const citation = {
    type: "url_citation",
    start_index: 0,
    end_index: 6,
    url: "https://example.com",
    title: "Example",
};

const output = (text = "Answer") => [
    {
        type: "web_search_call",
        id: "ws",
        status: "completed",
        action: {
            type: "search",
            queries: ["query"],
            sources: [{ type: "url", url: "https://example.com" }],
        },
    },
    {
        type: "message",
        id: "msg",
        content: [{ type: "output_text", text, annotations: [citation] }],
    },
];

const completed = (text) => ({
    type: "response.completed",
    response: { id: "resp", status: "completed", output: output(text) },
});

function fixture(raw = [completed()], normalized = message(), settings = {}) {
    const calls = [];
    const registry = {
        streamSimple(m, context, options) {
            calls.push({ m, context, options, payload: options.onPayload({ parent: "secret" }) });
            return {
                async *[Symbol.asyncIterator]() {
                    for (const event of raw) options.onProviderStreamEvent(event);
                    if (settings.stall) {
                        await new Promise(() => {});
                        return;
                    }
                    if (settings.throw) throw settings.throw;
                    yield settings.event ?? { type: "done", reason: "stop", message: normalized };
                },
                result: () => Promise.resolve(settings.final ?? normalized),
            };
        },
    };
    return { calls, registry };
}

// Use the installed parser and event stream, with the same initial usage and terminal
// handling as the installed Responses provider. No client, credentials or transport.
function parserFixture(terminal = completed(), items = terminal.response?.output ?? output()) {
    return {
        registry: {
            streamSimple(m, _context, options) {
                const stream = new AssistantMessageEventStream();
                const initial = { ...usage, input: 0, output: 0, totalTokens: 0 };
                const normalized = { ...message("", initial), content: [], stopReason: "pending" };
                const raw = [
                    ...items.map((item, output_index) => ({
                        type: "response.output_item.done",
                        output_index,
                        item,
                    })),
                    terminal,
                ];
                void (async () => {
                    try {
                        stream.push({ type: "start", partial: normalized });
                        await processResponsesStream(
                            (async function*() {
                                yield* raw;
                            })(),
                            normalized,
                            stream,
                            m,
                            {
                                onProviderStreamEvent: options.onProviderStreamEvent,
                            },
                        );
                        if (["pending", "error", "aborted"].includes(normalized.stopReason)) {
                            throw new Error(normalized.errorMessage ?? "Missing stop reason");
                        }
                        stream.push({
                            type: "done",
                            reason: normalized.stopReason,
                            message: normalized,
                        });
                    } catch (error) {
                        normalized.stopReason = "error";
                        normalized.errorMessage = error.message;
                        stream.push({ type: "error", reason: "error", error: normalized });
                    } finally {
                        stream.end();
                    }
                })();
                return stream;
            },
        },
    };
}

const run = (f, overrides = {}) =>
    searchQuery({
        registry: f.registry,
        model,
        query: "query",
        freshness: "live",
        searchContextSize: "medium",
        ...overrides,
    });

test("native payload is fresh, isolated, required, and evidence deduplicates", async () => {
    const f = fixture([
        { type: "response.output_item.done", output_index: 1, item: output()[1] },
        completed(),
    ]);
    const result = await run(f);
    assert.equal(result.ok, true);
    assert.equal(result.responseId, "resp");
    assert.equal(result.citations.length, 1);
    assert.deepEqual(result.citations[0].origin, {
        outputIndex: 1,
        contentIndex: 0,
        itemId: "msg",
    });
    assert.equal(result.actions[0].type, "search");
    assert.equal(result.sources.length, 1);
    const expectedUsage = structuredClone(usage);
    calculateCost(model, expectedUsage);
    assert.deepEqual(result.usage, expectedUsage);
    const { payload, context, options } = f.calls[0];
    assert.deepEqual(payload, {
        model: "fixture",
        instructions: context.systemPrompt,
        input: [{ role: "user", content: [{ type: "input_text", text: "query" }] }],
        tools: [{ type: "web_search", external_web_access: true, search_context_size: "medium" }],
        tool_choice: "required",
        stream: true,
        store: false,
        include: ["web_search_call.action.sources"],
    });
    assert.equal(context.messages.length, 1);
    assert.equal(options.maxRetries, 0);
    assert.equal(options.transport, "sse");
    const cached = fixture();
    await run(cached, { freshness: "cached", searchContextSize: "high" });
    assert.equal(cached.calls[0].payload.tools[0].external_web_access, false);
});

test("requires physical openai or openai-multi and Responses API before streaming", async () => {
    const managed = fixture();
    assert.equal((await run(managed, { model: { ...model, provider: "openai-multi" } })).ok, true);
    assert.equal(managed.calls.length, 1);
    for (
        const override of [
            { provider: "custom" },
            { provider: "openai-multi-custom" },
            { provider: "openai-multi", api: "pi-virtual" },
            { api: "openai-codex-responses" },
            {
                api: "openai-completions",
            },
        ]
    ) {
        const f = fixture();
        assert.equal((await run(f, { model: { ...model, ...override } })).error.kind, "capability");
        assert.equal(f.calls.length, 0);
    }
});

test("all recognized native retrieval actions succeed with fixtures and installed parser", async () => {
    for (const type of ["search", "open_page", "find_in_page"]) {
        const terminal = completed();
        terminal.response.output[0].action = type === "search"
            ? output()[0].action
            : {
                type,
                url: "https://status.openai.com/",
                ...(type === "find_in_page" ? { pattern: "operational" } : {}),
            };
        for (const f of [fixture([terminal]), parserFixture(terminal)]) {
            const result = await run(f);
            assert.equal(result.ok, true, `${type}: ${result.error?.message}`);
            assert.equal(result.actions[0].type, type);
            assert.equal(result.actions[0].status, "completed");
            assert.equal(result.answerSegments[0].text, "Answer");
            assert.equal(result.citations.length, 1);
            assert.ok(result.warnings.some((w) => w.includes("not prove full-page inspection")));
        }
    }
});

test("explicit terminal retrieval state overrides streamed completion for the same item", async () => {
    const streamed = { type: "response.output_item.done", output_index: 0, item: output()[0] };
    for (const status of ["failed", "in_progress", undefined]) {
        const terminal = completed();
        terminal.response.output[0].status = status;
        const result = await run(fixture([streamed, terminal]));
        assert.equal(result.ok, false);
        assert.match(result.error.message, /completed native retrieval/);
        assert.ok(result.answerSegments.length > 0);
    }
    for (const type of ["unknown", undefined]) {
        const terminal = completed();
        terminal.response.output[0].action.type = type;
        const result = await run(fixture([streamed, terminal]));
        assert.equal(result.ok, false);
        assert.match(result.error.message, /completed native retrieval/);
    }
    // Contradictions are keyed by item ID, not the compacted terminal array index.
    const replaced = completed();
    replaced.response.output[0] = { type: "message", id: "ws", content: [] };
    const result = await run(fixture([streamed, replaced]));
    assert.equal(result.ok, false);
    assert.match(result.error.message, /confirmed streamed items: 0/);
});

test("completed streamed retrieval survives omission from sparse terminal output", async () => {
    for (const type of ["search", "open_page", "find_in_page"]) {
        for (const snapshot of [undefined, [], output().slice(1)]) {
            const items = output();
            items[0].action = type === "search" ? items[0].action : {
                type,
                url: "https://status.openai.com/",
                ...(type === "find_in_page" ? { pattern: "operational" } : {}),
            };
            const terminal = completed();
            if (snapshot === undefined) delete terminal.response.output;
            else terminal.response.output = snapshot;
            const raw = items.map((item, output_index) => ({
                type: "response.output_item.done",
                output_index,
                item,
            }));
            for (const f of [fixture([...raw, terminal]), parserFixture(terminal, items)]) {
                const result = await run(f);
                assert.equal(result.ok, true, `${type}: ${result.error?.message}`);
                assert.equal(result.actions[0].type, type);
                assert.equal(result.actions[0].status, "completed");
                assert.ok(result.answerSegments.some((s) => s.text === "Answer"));
                assert.ok(result.citations.length > 0);
                assert.ok(
                    result.warnings.some((w) => w.includes("terminal output did not repeat")),
                );
                assert.ok(
                    result.warnings.some((w) => w.includes("not prove full-page inspection")),
                );
                assert.equal(
                    attachSearch(basePacket("openai_search", "test"), [result]).status,
                    "success",
                );
            }
        }
    }
});

test("streamed proof requires a done item with recognized type, status, ID and index", async () => {
    const terminal = completed();
    terminal.response.output = output().slice(1);
    const done = { type: "response.output_item.done", output_index: 0, item: output()[0] };
    const variants = [
        { ...done, type: "response.output_item.added" },
        { ...done, output_index: undefined },
        { ...done, item: { ...done.item, id: undefined } },
        { ...done, item: { ...done.item, id: "x".repeat(257) } },
        { ...done, item: { ...done.item, status: "in_progress" } },
        { ...done, item: { ...done.item, status: "failed" } },
        { ...done, item: { ...done.item, status: undefined } },
        { ...done, item: { ...done.item, action: { type: "unknown" } } },
        { ...done, item: { ...done.item, action: {} } },
    ];
    for (const event of variants) {
        const result = await run(fixture([event, terminal]));
        assert.equal(result.ok, false);
        assert.match(result.error.message, /completed native retrieval/);
    }
    // A later observation can revoke completion even with invalid coordinates.
    for (const event of variants.filter((v) => v.item.id === "ws")) {
        const result = await run(fixture([done, event, terminal]));
        assert.equal(result.ok, false);
    }
});

test("duplicate terminal IDs use the latest observation and superseded metadata is not retained", async () => {
    const done = { type: "response.output_item.done", output_index: 0, item: output()[0] };
    const states = [
        { ...output()[0], status: "failed" },
        { ...output()[0], status: undefined, action: { type: "unknown" } },
        { type: "message", id: "ws", content: [] },
    ];
    for (const latest of states) {
        const terminal = completed();
        terminal.response.output = [output()[0], latest, output()[1]];
        const result = await run(fixture([done, terminal]));
        assert.equal(result.ok, false);
        assert.ok(!result.actions.some((a) => a.status === "completed"));
        if (latest.type === "web_search_call" && !latest.status) {
            assert.equal(result.actions[0].status, "unknown");
            assert.equal(result.actions[0].type, undefined);
        }
    }
    const terminal = completed();
    terminal.response.output = [];
    const failedWithoutIndex = { ...done, output_index: undefined, item: states[0] };
    const malformed = await run(fixture([done, failedWithoutIndex, terminal]));
    assert.equal(malformed.ok, false);
    assert.deepEqual(malformed.actions, []);
    // Sparse final output must not retain old fields from superseded full items.
    const changed = { ...done, item: states[1] };
    const superseded = await run(fixture([done, changed, terminal]));
    assert.equal(superseded.ok, false);
    assert.equal(superseded.actions[0].status, "unknown");
    assert.equal(superseded.actions[0].type, undefined);
    assert.equal(superseded.actions[0].queries, undefined);
});

test("streamed completion still requires successful native and normalized termination", async () => {
    const streamed = output().map((item, output_index) => ({
        type: "response.output_item.done",
        output_index,
        item,
    }));
    for (const type of ["response.incomplete", "response.failed", "response.done"]) {
        const terminal = completed();
        terminal.type = type;
        terminal.response.output = [];
        if (type !== "response.done") terminal.response.status = type.split(".")[1];
        assert.equal((await run(fixture([...streamed, terminal]))).ok, false);
    }
    assert.equal((await run(fixture(streamed))).ok, false); // premature EOF
    for (const reason of ["length", "toolUse", "error", "aborted"]) {
        const terminal = completed();
        terminal.response.output = [];
        const result = await run(
            fixture([...streamed, terminal], { ...message(), stopReason: reason }),
        );
        assert.equal(result.ok, false);
        assert.match(result.error.message, /successful normalized stream/);
    }
    const controller = new AbortController();
    const terminal = completed();
    terminal.response.output = [];
    const pending = run(fixture([...streamed, terminal], message(), { stall: true }), {
        signal: controller.signal,
    });
    controller.abort();
    assert.equal((await pending).error.kind, "cancelled");
});

test("streamed completion is response-local and explicit conflicting items do not erase other successes", async () => {
    const done = { type: "response.output_item.done", output_index: 0, item: output()[0] };
    const terminal = completed();
    terminal.response.output = [];
    const created = { type: "response.created", response: { id: "resp" } };
    assert.equal((await run(fixture([created, done, terminal]))).ok, true);
    const changed = structuredClone(terminal);
    changed.response.id = "another-response";
    const mixed = await run(fixture([created, done, changed]));
    assert.equal(mixed.ok, false);
    assert.match(mixed.error.message, /response ID changed/);
    assert.equal((await run(fixture([terminal]))).ok, false); // fresh request, no stale ledger
    const conflicting = output()[0];
    conflicting.id = "another-action";
    conflicting.status = "failed";
    terminal.response.output = [conflicting, output()[1]];
    assert.equal((await run(fixture([done, terminal]))).ok, true); // at least one actual retrieval
});

test("streamed completion tracking is bounded and independent of retained action metadata", async () => {
    const terminal = completed();
    terminal.response.output = [];
    for (const count of [130, 513]) {
        const raw = Array.from({ length: count }, (_, n) => ({
            type: "response.output_item.done",
            output_index: n,
            item: {
                ...output()[0],
                id: `ws-${n}`,
                action: { type: n === count - 1 ? "open_page" : "unknown" },
            },
        }));
        const result = await run(fixture([...raw, terminal]));
        assert.equal(result.ok, count === 130);
        assert.equal(result.truncation.evidence, true);
        if (count === 130) assert.ok(!result.actions.some((a) => a.type === "open_page"));
        else assert.ok(result.warnings.some((w) => w.includes("state limit exceeded")));
        // A completed item directly in terminal output is still sufficient on overflow.
        const fullTerminal = completed();
        assert.equal((await run(fixture([...raw, fullTerminal]))).ok, true);
    }
});

test("native and normalized terminal success are independently required with diagnostics", async () => {
    for (const reason of ["length", "toolUse", "pending", "error", "aborted"]) {
        const normalized = { ...message(), stopReason: reason };
        // Cover disagreement between done(stop), the terminal message, and result().
        for (const settings of [{}, { final: normalized }]) {
            const f = fixture([completed()], settings.final ? message() : normalized, settings);
            const result = await run(f);
            assert.equal(result.ok, false, reason);
            assert.match(result.error.message, /successful normalized stream/);
            assert.match(result.error.message, new RegExp(`final: ${reason}`));
        }
        const result = await run(fixture([completed()], message(), {
            event: { type: "done", reason, message: message() },
        }));
        assert.equal(result.ok, false);
        assert.match(result.error.message, /successful normalized stream/);
    }
    const withError = await run(fixture([completed()], {
        ...message(),
        errorMessage: "provider failure",
    }));
    assert.equal(withError.ok, false);
    const raw = completed();
    raw.response.status = "in_progress";
    const notCompleted = await run(fixture([raw]));
    assert.equal(notCompleted.ok, false);
    assert.match(notCompleted.error.message, /Native response did not complete/);
    const empty = await run(fixture([completed(" \n\t")], message(" \n\t")));
    assert.equal(empty.ok, false);
    assert.match(empty.error.message, /nonempty answer/);
});

test("retrieval success does not depend on retained metadata fitting the evidence cap", async () => {
    const terminal = completed();
    const unknownActions = Array.from({ length: 130 }, (_, n) => ({
        type: "web_search_call",
        id: `unknown-${n}`,
        status: "completed",
        action: { type: "unknown" },
    }));
    terminal.response.output.unshift(...unknownActions);
    const result = await run(fixture([terminal]));
    assert.equal(result.ok, true);
    assert.equal(result.truncation.evidence, true);
    assert.ok(!result.actions.some((a) => a.type === "search"));
});

test("legacy response.done, missing retrieval, empty answers, and premature EOF fail", async () => {
    for (
        const raw of [
            [{ ...completed(), type: "response.done" }],
            [{
                type: "response.completed",
                response: { status: "completed", output: output().slice(1) },
            }],
            [completed("")],
            [],
        ]
    ) assert.equal((await run(fixture(raw, message("")))).error.kind, "incomplete");
});

test("raw incomplete/error usage survives stalled normalized stream and cancellation", async () => {
    for (const type of ["response.incomplete", "response.failed", "error"]) {
        const controller = new AbortController();
        const u = {
            input_tokens: 30,
            output_tokens: 5,
            total_tokens: 35,
            input_tokens_details: { cached_tokens: 10, cache_write_tokens: 2 },
            output_tokens_details: { reasoning_tokens: 3 },
        };
        const f = fixture(
            [{ type: "response.output_item.done", output_index: 1, item: output("partial")[1] }, {
                type,
                response: {
                    id: "partial",
                    status: "incomplete",
                    output: output("partial"),
                    usage: u,
                },
                message: "failed",
            }],
            message(),
            { stall: true },
        );
        const promise = run(f, { signal: controller.signal });
        setTimeout(() => controller.abort(), 5);
        const result = await promise;
        assert.equal(result.error.kind, "cancelled");
        assert.equal(result.usage.input, 18);
        assert.equal(result.usage.totalTokens, 35);
        assert.equal(result.usage.reasoning, 3);
        assert.equal(result.answerSegments[0].text, "partial");
        assert.ok(result.warnings.some((w) => w.includes("provider work may still be running")));
    }
});

test("raw policy failures outrank generic normalized authentication failures", async () => {
    for (
        const text of [
            "Forbidden: web_search disabled for this workspace",
            "Account web tool not allowed",
            "web_search restricted by organization policy",
        ]
    ) {
        const f = fixture([{ type: "error", error: { status: 403, message: text } }], message(), {
            event: {
                type: "error",
                reason: "error",
                error: { ...message(), errorMessage: "403 Forbidden" },
            },
        });
        assert.equal((await run(f)).error.kind, "capability");
    }
    const auth = await run(
        fixture([], message(), {
            throw: Object.assign(new Error("Invalid API key"), { status: 401 }),
        }),
    );
    assert.equal(auth.error.kind, "auth");
    assert.match(auth.error.message, /\/login openai/);
    assert.match(auth.error.message, /\/openai-accounts/);
});

test("raw failed usage is not overwritten by zero normalized usage", async () => {
    const f = fixture([{
        type: "response.failed",
        response: {
            status: "failed",
            usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 },
            error: { message: "HTTP 500" },
        },
    }], message("", { ...usage, totalTokens: 0 }));
    const result = await run(f);
    assert.equal(result.usage.totalTokens, 11);
    assert.equal(result.ok, false);
});

test("byte, line, Unicode and metadata caps retain original citation offsets", async () => {
    for (const text of ["😀".repeat(100000), "\u0000".repeat(100000), "line\n".repeat(10000)]) {
        const raw = completed(text);
        raw.response.output[1].content[0].annotations[0] = { ...citation, end_index: text.length };
        raw.response.output[0].action.sources = Array.from(
            { length: 1000 },
            (_, n) => ({ type: "url", url: `https://example.com/${n}/${"a".repeat(1000)}` }),
        );
        const result = await run(
            fixture([{
                type: "response.output_item.done",
                output_index: 1,
                item: raw.response.output[1],
            }, raw], message(text)),
        );
        assert.equal(result.ok, true);
        assert.equal(result.truncation.answer, true);
        assert.equal(result.truncation.evidence, true);
        assert.ok(result.truncation.answerBytes <= 50 * 1024);
        assert.ok(result.truncation.answerLines <= 2000);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024);
        assert.equal(result.citations[0].endIndex, text.length);
        assert.ok(!/[\uD800-\uDBFF]$/.test(result.answerSegments[0].text));
    }
});

test("pre-abort and timeout are honest; progress callback failure does not lose evidence", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("deadline", "TimeoutError"));
    const f = fixture();
    assert.equal((await run(f, { signal: controller.signal })).error.kind, "timeout");
    assert.equal(f.calls.length, 0);
    const result = await run(fixture(), {
        onProgress() {
            throw new Error("UI failed");
        },
    });
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((w) => w.includes("Progress callback failed")));
});

test("installed Responses parser does not certify missing or malformed usage as zero", async () => {
    for (
        const rawUsage of [undefined, {}, { input_tokens: 4 }, {
            input_tokens: -1,
            output_tokens: 2,
            total_tokens: 1,
        }, { input_tokens: 0, output_tokens: "0", total_tokens: 0 }]
    ) {
        const terminal = completed();
        if (rawUsage !== undefined) terminal.response.usage = rawUsage;
        const result = await run(parserFixture(terminal));
        assert.equal(result.ok, true);
        assert.equal(result.answerSegments[0].text, "Answer");
        assert.equal(result.actions[0].status, "completed");
        assert.equal(result.usage, undefined);
        assert.equal(Object.hasOwn(result, "usage"), false);
        assert.ok(result.warnings.some((w) => w.includes("usage is unavailable")));
    }
});

test("installed Responses parser retains explicit zero and calculates observed positive token costs", async () => {
    for (const zero of [true, false]) {
        const terminal = completed();
        terminal.response.usage = zero
            ? { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
            : {
                input_tokens: 30,
                output_tokens: 5,
                total_tokens: 35,
                input_tokens_details: { cached_tokens: 10, cache_write_tokens: 2 },
                output_tokens_details: { reasoning_tokens: 3 },
            };
        const result = await run(parserFixture(terminal));
        assert.equal(result.ok, true);
        assert.equal(result.usage.input, zero ? 0 : 18);
        assert.equal(result.usage.totalTokens, zero ? 0 : 35);
        assert.equal(result.usage.reasoning, zero ? 0 : 3);
        assert.ok(Math.abs(result.usage.cost.total - (zero ? 0 : 35 / 1e6)) < 1e-12);
        assert.ok(!result.warnings.some((w) => w.includes("usage is unavailable")));
    }
});

test("installed Responses parser preserves usage from incomplete, failed and error events", async () => {
    for (const type of ["response.incomplete", "response.failed", "error"]) {
        const terminal = {
            type,
            message: "HTTP 500",
            response: {
                status: type === "response.incomplete" ? "incomplete" : "failed",
                output: output(),
                usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 },
                error: { message: "HTTP 500" },
            },
        };
        const result = await run(parserFixture(terminal));
        assert.equal(result.ok, false);
        assert.equal(result.usage.input, 9);
        assert.equal(result.usage.output, 2);
        assert.equal(result.usage.totalTokens, 11);
        assert.ok(Math.abs(result.usage.cost.total - 13 / 1e6) < 1e-12);
    }
});

test("aggregate integration warns when totals contain only reported usage", async () => {
    const missing = await run(parserFixture());
    const terminal = completed();
    terminal.response.usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
    const reported = await run(parserFixture(terminal));
    const packet = attachSearch(basePacket("openai_search", "fixture"), [missing, reported]);
    assert.equal(packet.status, "success");
    // Aggregate costs contain numeric totals, not per-response provider provenance.
    const { totalFromProvider: _provenance, ...cost } = reported.usage.cost;
    assert.deepEqual(packet.usage, { ...reported.usage, cost });
    assert.ok(packet.warnings.some((w) => w.includes("totals include only reported usage")));
    const unknown = attachSearch(basePacket("openai_search", "fixture"), [missing]);
    assert.equal(unknown.usage, undefined);
    assert.ok(unknown.warnings.some((w) => w.includes("usage is unavailable")));
});
