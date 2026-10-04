import { createJiti } from "jiti";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
    activity,
    call,
    extension,
    harness,
    policies,
    report,
    searchPacket,
    state,
    stream,
    tool,
} from "./helpers.mjs";
const jiti = createJiti(import.meta.url, { fsCache: false });
// Test-only parity with the actual producer; runtime has no sibling dependency.
const producer = await jiti.import("../../pi-openai-web/src/results.ts");
const { PacketSchema } = await jiti.import("../../pi-openai-web/src/schemas.ts");
const requireWeb = createRequire(new URL("../../pi-openai-web/package.json", import.meta.url));
const { Check } = await import(requireWeb.resolve("typebox/value"));

const produce = (queries = searchPacket().results, final = true) =>
    producer.toolResult(
        producer.attachSearch(producer.basePacket("openai_search", "actual"), queries, final),
        final,
    );

const evidence = (packet) => state.webPacket("run", "openai_search", { details: packet }, false);

const malformed = [
    ["null citations", (p) => p.results[0].citations = [null]],
    ["null evidence", (p) => p.evidence = [null]],
    ["null action sibling", (p) => p.results[0].actions.push(null)],
    ["null answer sibling", (p) => p.results[0].answerSegments.push(null)],
    ["false packet error", (p) => p.error = false],
    ["false query error", (p) => p.results[0].error = false],
    ["wrong version", (p) => p.version = 2],
    ["wrong tool", (p) => p.tool = "other"],
    ["wrong status", (p) => p.status = "done"],
    ["null query sibling", (p) => p.results.push(null)],
    ["bad model", (p) => p.results[0].model.api = null],
    ["bad request model", (p) => p.request.model = null],
    ["bad origin", (p) => p.results[0].answerSegments[0].origin.contentIndex = 1.5],
    ["bad source", (p) => p.results[0].sources = [null]],
    ["bad citation origin", (p) => p.results[0].citations[0].origin = null],
    ["bad warning", (p) => p.warnings = [false]],
    ["bad truncation", (p) => p.truncation.omissions = [null]],
    ["bad query truncation", (p) => p.results[0].truncation.answerBytes = "1"],
    ["bad usage", (p) => p.usage = { ...state.emptyUsage(), cost: null }],
    ["bad query usage", (p) => p.results[0].usage = false],
    ["bad request", (p) => p.request.finishedAt = "2"],
    ["bad page", (p) => p.page = null],
    ["unknown field", (p) => p.results[0].extra = true],
];
test("actual producer/schema success and partial packets satisfy owned search", () => {
    const success = searchPacket().results[0];
    const failure = {
        ...structuredClone(success),
        ok: false,
        status: "failure",
        answerSegments: [],
        error: { kind: "cancelled", message: "Cancelled" },
    };
    for (const output of [produce(), produce([success, failure])]) {
        assert.equal(Check(PacketSchema, output.details), true);
        const e = state.webPacket("run", "openai_search", output, output.isError);
        assert.equal(state.successfulSearch(e), true);
        assert.deepEqual(e.details, output.details);
    }
    for (const output of [produce([success], false), produce([failure]), produce([])]) {
        assert.equal(Check(PacketSchema, output.details), true);
        assert.equal(
            state.successfulSearch(state.webPacket("run", "openai_search", output, output.isError)),
            false,
        );
    }
});
test("every malformed actual-schema packet is rejected before successful query counting", () => {
    for (const [name, mutate] of malformed) {
        const p = structuredClone(produce().details);
        mutate(p);
        assert.equal(Check(PacketSchema, p), false, name);
        assert.equal(state.successfulSearch(evidence(p)), false, name);
    }
    for (
        const mutate of [
            (p) => p.tool = "web_action",
            (p) => p.results[0].actions = [],
            (p) => p.results[0].answerSegments[0].complete = false,
            (p) => p.results[0].answerSegments[0].text = " ",
        ]
    ) {
        const p = structuredClone(produce().details);
        mutate(p);
        assert.equal(state.successfulSearch(evidence(p)), false);
    }
});
test("full nested contract parity includes usage, optional fields and page siblings", () => {
    const p = structuredClone(produce().details);
    const usage = { ...state.emptyUsage(), cacheWrite1h: 0, reasoning: 0 };
    p.usage = usage;
    p.request = {
        ...p.request,
        model: searchPacket().request.model,
        freshness: "cached",
        searchContextSize: "high",
        queries: ["source"],
        action: "find",
        url: "https://example.com",
    };
    const q = p.results[0];
    q.usage = usage;
    q.responseId = "response";
    q.answerSegments[0].origin.itemId = "item";
    q.actions[0].url = "https://example.com";
    q.actions[0].pattern = "source";
    p.page = {
        ok: true,
        requestedUrl: "https://example.com",
        finalUrl: "https://example.com",
        timestamp: "now",
        title: "page",
        totalLines: 1,
        excerpts: [{ startLine: 1, endLine: 1, text: "page" }],
        matches: [{ line: 1, column: 1, text: "page" }],
        no_match: false,
        warnings: ["warning"],
        completeness: "complete",
        truncated: false,
        truncation: { wire: false, decoded: false, extracted: false, matches: false },
    };
    assert.equal(Check(PacketSchema, p), true);
    assert.equal(state.successfulSearch(evidence(p)), true);
    const paths = [];

    const walk = (value, path = []) => {
        if (path.length) paths.push(path);
        if (value && typeof value === "object") {
            for (const key of Object.keys(value)) walk(value[key], [...path, key]);
        }
    };

    walk(p);
    let rejected = 0;
    for (const path of paths) {
        const malformed = structuredClone(p);
        let parent = malformed;
        for (const key of path.slice(0, -1)) parent = parent[key];
        const key = path.at(-1);
        parent[key] = typeof parent[key] === "boolean" ? "invalid" : null;
        // Nullable page title/finalUrl are intentionally accepted by the public contract.
        if (Check(PacketSchema, malformed)) continue;
        assert.equal(state.successfulSearch(evidence(malformed)), false, path.join("."));
        rejected++;
    }
    assert.ok(rejected > 100);
});

test("real Agent researcher and validator cannot complete with malformed owned packets", async (t) => {
    let packet;
    const h = await harness(t, {
        tools: [
            tool(
                "openai_search",
                async () => ({ content: [{ type: "text", text: "Source" }], details: packet }),
            ),
        ],
        stream: (m, context) =>
            stream(
                m,
                context.messages.some((x) =>
                        x.role === "toolResult" && x.toolName === "openai_search"
                    )
                    ? [call("agent_report", report())]
                    : [call("openai_search", { queries: ["source"] })],
            ),
    });
    // Cover the reviewer's exact blockers through the real Agent loop for both roles.
    for (const [name, mutate] of malformed.slice(0, 6)) {
        packet = structuredClone(produce().details);
        mutate(packet);
        assert.equal(Check(PacketSchema, packet), false);
        for (const agent of ["researcher", "research-validator"]) {
            const output = await h.execute("subagents_run", { tasks: [{ agent, task: name }] });
            assert.equal(
                output.result.details.results[0].status,
                "incomplete",
                `${agent}: ${name}`,
            );
        }
    }
});
test("only canonical IDs restore; generic current subagents_run results remain restorable", () => {
    const mode = { ...state.initialState(), enabled: true };
    const branch = ["state", "evidence", "runs"].map((kind) => ({
        type: "custom",
        customType: `pi-codex-subagents-${kind}-v1`,
        data: null,
    }));
    assert.deepEqual(state.restore(branch).mode, state.initialState());
    assert.equal(state.restore(branch).ledger.evidence.size, 0);
    assert.equal(state.restore(branch).ledger.runs.size, 0);
    const run = { id: "run-current", revision: 1, evidence: [evidence(produce().details)] };
    branch.push({ type: "custom", customType: state.STATE_ENTRY, data: mode });
    branch.push({ type: "custom", customType: state.EVIDENCE_ENTRY, data: run.evidence[0] });
    branch.push({
        type: "message",
        message: {
            role: "toolResult",
            toolName: "subagents_run",
            details: { results: [run], partial: false },
        },
    });
    const restored = state.restore(branch);
    assert.deepEqual(restored.mode, mode);
    assert.deepEqual(restored.ledger.runs.get(run.id), run);
    assert.deepEqual(restored.ledger.evidence.get(run.evidence[0].id), run.evidence[0]);
});
test("only current web tools get read adapters and evidence callbacks", async () => {
    const hooks = new Map();
    const renderers = new Map();
    const appended = [];
    extension({
        on: (n, fn) => hooks.set(n, fn),
        registerTool() {},
        registerCommand() {},
        registerMessageRenderer: (n, fn) => renderers.set(n, fn),
        appendEntry: (...args) => appended.push(args),
    });
    assert.deepEqual([...renderers.keys()], [
        "pi-openai-subagents-info",
        "pi-openai-subagents-warning",
    ]);
    for (const name of ["openai_search", "web_action"]) {
        assert.equal(policies.classify({ name }, {}), "read");
    }
    for (const name of ["codex_search", "codex_standalone_web"]) {
        assert.equal(policies.classify({ name }, {}), "unknown");
        assert.equal(
            state.successfulSearch(
                state.webPacket("run", name, { details: { successes: [{}] } }, false),
            ),
            false,
        );
        await policies.identity.run({ runId: "run", agent: "researcher" }, async () => {
            assert.equal(
                hooks.get("tool_result")({ toolName: name, toolCallId: name, content: [] }),
                undefined,
            );
            hooks.get("tool_execution_end")({
                toolName: name,
                toolCallId: name,
                result: {},
                isError: false,
            });
        });
    }
    assert.deepEqual(appended, []);
    assert.match(
        activity.activityPreview("researcher", "openai_search", { queries: ["claim"] }, "running")
            .focus,
        /claim/,
    );
});
