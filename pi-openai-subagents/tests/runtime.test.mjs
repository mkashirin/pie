import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
    call,
    environment,
    harness,
    model,
    pause,
    policies,
    promptInputs,
    report,
    runtime,
    scheduling,
    searchPacket,
    state,
    stream,
    tool,
} from "./helpers.mjs";

const turns = (context) => context.messages.filter((m) => m.role === "assistant").length;

const lastText = (context) =>
    context.messages.filter((m) => m.role === "toolResult").at(-1)?.content.filter((p) =>
        p.type === "text"
    ).map((p) => p.text).join("\n") ?? "";

const evidenceID = (context) =>
    lastText(context).match(/Evidence packet ID: (evidence-[\w-]+)/)?.[1];

test("real Agent single run, isolated task context, usage and model assignments", async (t) => {
    let transcript;
    let actual;
    const h = await harness(t, {
        stream: (m, context) => {
            transcript = context;
            actual = m;
            return stream(m, [call("agent_report", report())]);
        },
    });
    await h.command("model scout other/family/model");
    const result = await h.execute("subagents_run", {
        tasks: [{ agent: "scout", task: "Locate auth", context: "Explicit facts" }],
    });
    const r = result.result.details.results[0];
    assert.equal(r.status, "complete");
    assert.equal(actual.provider, "other");
    assert.equal(r.model, "other/family/model");
    assert.equal(r.turns, 1);
    assert.equal(result.result.usage.totalTokens, 5);
    assert.equal(result.result.structuredContent.results[0].id, r.id);
    assert.equal(transcript.messages.filter((m) => m.role === "user").length, 1);
    assert.match(JSON.stringify(transcript), /Explicit facts/);
    assert.doesNotMatch(JSON.stringify(transcript), /abandoned-parent-secret/);
});
test("child input projection drops telemetry/details, deduplicates evidence and caps prompt bytes", () => {
    const evidence = {
        id: "evidence-source",
        owner: "research-run",
        tool: "openai_search",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        text: "Source answer with useful citations. ".repeat(1000),
        details: { secretLargePayload: "never send this detail payload".repeat(1000) },
        isError: false,
        inspection: "search",
    };
    const inputRun = {
        id: "research-run",
        agent: "researcher",
        profile: "researcher",
        model: "openai/test-model",
        thinking: "high",
        status: "complete",
        task: "Research",
        inputs: [],
        writePaths: [],
        report: report({ summary: "Keep report content" }),
        evidence: [evidence],
        durationMs: 1234,
        usage: state.emptyUsage(),
        turns: 3,
        lastActivity: "last streamed token",
        truncated: false,
        reportBytes: 100,
        changed: false,
        uncertainShell: false,
        revision: 1,
        reviewRevision: 1,
        toolActivity: [
            { tool: "read", capability: "read", isError: false },
            { tool: "read", capability: "read", isError: false },
        ],
    };
    const formatted = promptInputs.formatPromptInputs([inputRun, evidence]);
    const payload = JSON.parse(formatted.text);
    const projectedRun = payload.records[0];
    assert.deepEqual(payload.inputIds, ["research-run", "evidence-source"]);
    assert.equal(projectedRun.report.summary, "Keep report content");
    assert.equal(projectedRun.usage, undefined);
    assert.equal(projectedRun.durationMs, undefined);
    assert.deepEqual(projectedRun.toolActivity, [{
        tool: "read",
        capability: "read",
        succeeded: 2,
        failed: 0,
    }]);
    assert.equal(projectedRun.evidence[0].structuredDetailsOmitted, true);
    assert.equal(projectedRun.evidence[0].textTruncated, true);
    assert.equal(payload.records[1].kind, "evidence-reference");
    assert.doesNotMatch(formatted.text, /never send this detail payload/);
    assert.equal(evidence.details.secretLargePayload.length > 0, true);

    const hugeReport = {
        ...inputRun,
        id: "huge-report",
        evidence: [],
        report: report({ summary: "界".repeat(50_000) }),
    };
    const capped = promptInputs.formatPromptInputs([hugeReport]);
    assert.equal(capped.truncated, true);
    assert.ok(Buffer.byteLength(capped.text) <= 64 * 1024);
    assert.match(capped.text, /Truncated/);
});
test("parent hooks retain final veto; workers inherit shell, scouts do not", async (t) => {
    let executed = 0;
    const tools = [tool("bash", async () => {
        executed++;
        return {
            content: [{ type: "text", text: "ran" }],
            details: {},
            usage: { ...state.emptyUsage(), totalTokens: 999 },
        };
    })];
    const h = await harness(t, {
        tools,
        stream: (m, c) =>
            stream(m, [
                call(
                    turns(c) === 0 ? "bash" : "agent_report",
                    turns(c) === 0 ? { command: "check" } : report(),
                ),
            ]),
    });
    const scout = await h.execute("subagents_run", {
        tasks: [{ agent: "scout", task: "Try shell" }],
    });
    assert.equal(executed, 0);
    assert.equal(scout.result.details.results[0].turns, 2);
    const worker = await h.execute("subagents_run", {
        tasks: [{ agent: "worker", task: "Run checks" }],
    });
    assert.equal(executed, 1);
    assert.equal(worker.result.usage.totalTokens, 10);
    assert.equal(worker.result.details.results[0].uncertainShell, true);
    h.pi.on(
        "tool_call",
        (event) =>
            event.toolName === "bash" ? { block: true, reason: "Parent policy veto" } : undefined,
    );
    await h.execute("subagents_run", { tasks: [{ agent: "worker", task: "Try again" }] });
    assert.equal(executed, 1);
});
test("orchestrator restrictions are enforced directly and through wrapper nested calls", async (t) => {
    let executed = 0;
    const h = await harness(t, {
        tools: [
            tool("bash", async () => {
                executed++;
                return { content: [], details: {} };
            }),
            tool(
                "wrapper",
                async (_id, _args, _signal, _update, ctx) =>
                    (await ctx.executeTool("bash", { command: "x" })).result,
                {
                    annotations: { readOnlyHint: true },
                },
            ),
        ],
    });
    await h.command("on");
    assert.equal((await h.execute("bash", { command: "x" })).isError, true);
    assert.equal((await h.execute("wrapper")).isError, true);
    assert.equal(executed, 0);
    const hook = h.tools.get("subagents_run").prepareLoadout({
        declared: [...h.tools.values()],
        registered: [...h.tools.values()],
    });
    assert.ok(hook.hiddenDeclarations.includes("bash"));
    assert.ok(!hook.hiddenDeclarations.includes("wrapper"));
});
test("parallel child identities survive wrapper nesting; reviewers get shell but no edit", async (t) => {
    const identities = [];
    const h = await harness(t, {
        tools: [
            tool("bash", async () => {
                await pause(3);
                identities.push(policies.identity.getStore().agent);
                return { content: [], details: {} };
            }),
            tool("edit"),
            tool(
                "wrapper",
                async (_id, _args, _s, _u, ctx) => (await ctx.executeTool("bash", {})).result,
                { annotations: { readOnlyHint: true } },
            ),
        ],
        stream: (m, c) =>
            stream(m, [
                call(turns(c) === 0 ? "wrapper" : "agent_report", turns(c) === 0 ? {} : report()),
            ]),
    });
    await h.execute("subagents_run", {
        tasks: [{ agent: "worker", task: "Execute" }, { agent: "scout", task: "Inspect" }],
    });
    assert.deepEqual(identities, ["worker"]);
    await h.command("tools reviewer");
    assert.match(h.messages.at(-1).content, /bash: execute - allowed/);
    assert.match(h.messages.at(-1).content, /edit: write - reviewer.*cannot/);
});
test("unknown tools require approval, parent veto still wins, and no tool activation occurs", async (t) => {
    let executed = 0;
    let approvals = 0;
    const mystery = tool("mystery", async () => {
        executed++;
        return { content: [], details: {} };
    });
    const h = await harness(t, {
        tools: [mystery],
        stream: (m, c) =>
            stream(m, [
                call(turns(c) === 0 ? "mystery" : "agent_report", turns(c) === 0 ? {} : report()),
            ]),
    });
    await h.execute("subagents_run", { tasks: [{ agent: "scout", task: "Unknown" }] });
    assert.equal(executed, 0);
    h.ctx.hasUI = true;
    h.ctx.ui.confirm = async () => {
        approvals++;
        return true;
    };
    await h.execute("subagents_run", { tasks: [{ agent: "scout", task: "Unknown" }] });
    assert.equal(executed, 1);
    assert.equal(approvals, 1);
    await h.execute("subagents_run", { tasks: [{ agent: "scout", task: "Unknown again" }] });
    assert.equal(approvals, 1);
    h.pi.on(
        "tool_call",
        (e) => e.toolName === "mystery" ? { block: true, reason: "veto" } : undefined,
    );
    await h.execute("subagents_run", { tasks: [{ agent: "scout", task: "Unknown vetoed" }] });
    assert.equal(executed, 2);
    h.pi.setActiveTools(["subagents_run"]);
    await h.execute("subagents_run", { tasks: [{ agent: "worker", task: "Unavailable" }] });
    assert.equal(executed, 2);
    assert.deepEqual(h.pi.getActiveTools(), ["subagents_run"]);
});
test("child cannot recurse or use session-control tools even with narrowed custom agent definitions", async (t) => {
    const h = await harness(t, {
        stream: (m, c) =>
            stream(m, [
                call(
                    turns(c) === 0 ? "subagents_run" : "agent_report",
                    turns(c) === 0 ? { tasks: [{ agent: "scout", task: "recurse" }] } : report(),
                ),
            ]),
    });
    const result = await h.execute("subagents_run", {
        tasks: [{ agent: "worker", task: "No recursion" }],
    });
    assert.equal(result.result.details.results.length, 1);
    assert.equal(result.result.details.results[0].turns, 2);
});
test("actual web packets and IDs reach research reports and independently searching validators", async (t) => {
    let target;
    let claims = [];
    let searches = 0;
    const h = await harness(t, {
        tools: [tool("openai_search", async () => ({
            content: [{ type: "text", text: `Retrieved source ${++searches}` }],
            details: searchPacket(),
        }))],
        stream: (m, c) => {
            if (turns(c) === 0) {
                return stream(m, [call("openai_search", { queries: ["primary source"] })]);
            }
            const id = evidenceID(c);
            assert.ok(id);
            const r = target
                ? report({
                    checks: [{
                        target,
                        verdict: "supported",
                        reason: "Independent source comparison",
                        evidence: [id],
                    }],
                    verification: ["Independent search"],
                })
                : report({
                    claims: [{
                        claim: "Material claim",
                        evidence: [id],
                        urls: ["https://source.example"],
                        date: "2026-01-01",
                        uncertainty: "Scope limited",
                    }],
                });
            claims = r.claims;
            return stream(m, [call("agent_report", r)]);
        },
    });
    const research = await h.execute("subagents_run", {
        tasks: [{ agent: "researcher", task: "Research" }],
    });
    const r = research.result.details.results[0];
    assert.equal(r.status, "complete");
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].details.results[0].citations[0].url, "https://source.example");
    assert.equal(claims[0].evidence[0], r.evidence[0].id);
    target = r.id;
    const validation = await h.execute("subagents_run", {
        tasks: [{ agent: "research-validator", task: "Validate claims", inputs: [target] }],
    });
    const v = validation.result.details.results[0];
    assert.equal(v.status, "complete");
    assert.equal(searches, 2);
    assert.equal(v.report.checks[0].target, r.id);
    assert.notEqual(v.evidence[0].id, r.evidence[0].id);
});
test("missing web capability and missing/invalid final reports yield incomplete, not fabricated success", async (t) => {
    const h = await harness(t, {
        stream: (m, c) =>
            stream(
                m,
                turns(c) === 0
                    ? [call("agent_report", report())]
                    : [{ type: "text", text: "Cannot complete research" }],
            ),
    });
    const result = await h.execute("subagents_run", {
        tasks: [{ agent: "researcher", task: "Research with no web" }],
    });
    assert.equal(result.result.details.results[0].status, "incomplete");
    assert.equal(result.isError, true);
    h.ctx.modelRegistry.streamSimple = (m) =>
        stream(m, [call("agent_report", { summary: "invalid missing fields" })]);
    await h.command("reload");
    // Limit prevents endless invalid reporter attempts.
    await mkdir(h.agentDir, { recursive: true });
    await writeFile(join(h.agentDir, "pi-openai-subagents.json"), JSON.stringify({ maxTurns: 2 }));
    await h.command("reload");
    const invalid = await h.execute("subagents_run", {
        tasks: [{ agent: "scout", task: "Invalid report" }],
    });
    assert.equal(invalid.result.details.results[0].status, "incomplete");
    assert.match(invalid.result.details.results[0].reason, /2 model turns/);
});
test("input IDs are branch-local and validated before any agent starts", async (t) => {
    let starts = 0;
    const h = await harness(t, {
        stream: (m) => {
            starts++;
            return stream(m, [call("agent_report", report())]);
        },
    });
    const r = await h.execute("subagents_run", {
        tasks: [{ agent: "scout", task: "bad", inputs: ["abandoned-run"] }],
    });
    assert.equal(r.isError, true);
    assert.equal(starts, 0);
    const invalid = await h.execute("subagents_run", {
        tasks: [{ agent: "scout", task: "ok" }, { agent: "nonexistent", task: "bad" }],
    });
    assert.equal(invalid.isError, true);
    assert.equal(starts, 0);
});
test("child tool declarations default to active direct tools and allow explicit callable opt-ins", async (t) => {
    const h = await harness(t, {
        tools: [
            tool("read"),
            tool("edit"),
            tool("deferred_read", async () => ({ content: [], details: {} }), {
                exposure: "deferred",
                annotations: { readOnlyHint: true },
            }),
            tool("codemode_read", async () => ({ content: [], details: {} }), {
                exposure: "codemode",
                annotations: { readOnlyHint: true },
            }),
        ],
    });
    const ledger = new state.Ledger();
    const host = {
        pi: h.pi,
        config: () => h.config,
        settings: () => ({}),
        ledger: () => ledger,
        authorize: async () => undefined,
    };
    const loadouts = [];
    const runner = new runtime.Runtime(host, (options) => {
        loadouts.push(options.initialState.tools.map((t) => t.name));
        return {
            state: {},
            subscribe: () => () => {},
            abort() {},
            async waitForIdle() {},
            async prompt() {
                await options.initialState.tools.find((t) => t.name === "agent_report").execute(
                    "report",
                    report(),
                );
            },
        };
    });

    await runner.run([{ agent: "scout", task: "Use default tools" }], h.ctx);
    assert.deepEqual(loadouts[0], ["read", "agent_report"]);

    await runner.run([{
        agent: "scout",
        task: "Use deferred tools",
        tools: ["deferred_read", "codemode_read"],
    }], h.ctx);
    assert.deepEqual(loadouts[1], ["deferred_read", "codemode_read", "agent_report"]);

    await assert.rejects(
        runner.run([{ agent: "scout", task: "Forbidden", tools: ["edit"] }], h.ctx),
        /cannot use write tool edit/,
    );
    assert.equal(loadouts.length, 2);
});
test("read-only child tools may run in parallel, while write-capable children stay sequential", async (t) => {
    let running = 0;
    let peak = 0;
    const operation = async () => {
        peak = Math.max(peak, ++running);
        await pause(15);
        running--;
        return { content: [], details: {} };
    };
    const h = await harness(t, {
        tools: [tool("read", operation), tool("grep", operation), tool("edit")],
        stream: (m, c) =>
            stream(
                m,
                turns(c) === 0
                    ? [call("read", {}), call("grep", {})]
                    : [call("agent_report", report())],
            ),
    });

    await h.execute("subagents_run", { tasks: [{ agent: "scout", task: "Inspect" }] });
    assert.equal(peak, 2);

    peak = 0;
    await h.execute("subagents_run", { tasks: [{ agent: "worker", task: "Implement" }] });
    assert.equal(peak, 1);
});
test("bounded concurrency, stable input order and partial failures", async (t) => {
    const e = await environment(t);
    const ledger = new state.Ledger();
    let running = 0;
    let peak = 0;
    let toolCatalogReads = 0;
    const host = {
        pi: {
            getAllTools: () => {
                toolCatalogReads++;
                return [];
            },
            getActiveTools: () => [],
        },
        config: () => e.config,
        settings: () => ({}),
        ledger: () => ledger,
        authorize: async () => undefined,
    };
    e.config.user.concurrency = 2;

    const fakeFactory = (options) => {
        let cb;
        return {
            state: {},
            subscribe(fn) {
                cb = fn;
                return () => {};
            },
            abort() {},
            async waitForIdle() {},
            async prompt(input) {
                peak = Math.max(peak, ++running);
                const slow = input.includes("slow");
                await pause(slow ? 15 : 3);
                try {
                    if (input.includes("fail")) throw new Error("fake failure");
                    await options.initialState.tools.find((t) => t.name === "agent_report").execute(
                        "r",
                        report(),
                    );
                } finally {
                    running--;
                }
            },
        };
    };

    const runner = new runtime.Runtime(host, fakeFactory);
    e.ctx.tools = [];
    const result = await runner.run([{ agent: "scout", task: "slow" }, {
        agent: "scout",
        task: "fast",
    }, { agent: "scout", task: "fail" }], e.ctx);
    assert.equal(peak, 2);
    assert.equal(toolCatalogReads, 1);
    assert.deepEqual(result.results.map((r) => r.task), ["slow", "fast", "fail"]);
    assert.deepEqual(result.results.map((r) => r.status), ["complete", "complete", "failed"]);
    assert.equal(result.partial, true);
    assert.equal(runner.busy, false);
});
test("terminal elapsed freezes before slow cleanup and heartbeat subscriptions are released", async (t) => {
    const e = await environment(t);
    const ledger = new state.Ledger();
    const host = {
        pi: { getAllTools: () => [], getActiveTools: () => [] },
        config: () => e.config,
        settings: () => ({}),
        ledger: () => ledger,
        authorize: async () => undefined,
    };
    let now = 1000;
    t.mock.method(Date, "now", () => now);
    let cleaning;
    const cleanupStarted = new Promise((resolve) => {
        cleaning = resolve;
    });
    let settle;
    const cleanup = new Promise((resolve) => {
        settle = resolve;
    });
    const runner = new runtime.Runtime(host, (options) => ({
        state: {},
        subscribe: () => () => {},
        abort() {},
        waitForIdle() {
            cleaning();
            return cleanup;
        },
        async prompt() {
            now += 2500;
            await options.initialState.tools.find((t) => t.name === "agent_report").execute(
                "report",
                report(),
            );
        },
    }));
    e.ctx.tools = [];
    const updates = [];
    let heartbeat;
    let unsubscribed = 0;
    const running = runner.run(
        [{ agent: "scout", task: "Slow cleanup" }],
        e.ctx,
        undefined,
        (update) => updates.push(update),
        (refresh) => {
            heartbeat = refresh;
            return () => unsubscribed++;
        },
    );
    await cleanupStarted;
    now += 10000;
    heartbeat();
    assert.equal(updates.at(-1).results[0].status, "complete");
    assert.equal(updates.at(-1).results[0].durationMs, 2500);
    settle();
    assert.equal((await running).results[0].durationMs, 2500);
    assert.equal(unsubscribed, 1);
    const count = updates.length;
    heartbeat();
    assert.equal(updates.length, count); // Stale callbacks cannot republish settled batches.
});

test("rapid streamed message updates coalesce while terminal snapshots remain immediate", async (t) => {
    const e = await environment(t);
    const ledger = new state.Ledger();
    const host = {
        pi: { getAllTools: () => [], getActiveTools: () => [] },
        config: () => e.config,
        settings: () => ({}),
        ledger: () => ledger,
        authorize: async () => undefined,
    };
    let listener;
    const runner = new runtime.Runtime(host, (options) => ({
        state: {},
        subscribe(callback) {
            listener = callback;
            return () => {};
        },
        abort() {},
        async waitForIdle() {},
        async prompt() {
            for (let i = 0; i < 20; i++) {
                listener({
                    type: "message_update",
                    assistantMessageEvent: { type: "text_delta", delta: `chunk ${i}` },
                });
            }
            await options.initialState.tools.find((t) => t.name === "agent_report").execute(
                "report",
                report(),
            );
        },
    }));
    e.ctx.tools = [];
    const updates = [];
    const result = await runner.run(
        [{ agent: "scout", task: "Stream" }],
        e.ctx,
        undefined,
        (batch) => updates.push(batch),
    );
    assert.equal(result.results[0].status, "complete");
    assert.equal(updates.length, 3); // queued, running, and immediate terminal snapshot
    assert.equal(updates.at(-1).results[0].status, "complete");
});

test("throwing runtime update consumer is disabled without aborting work, and unsubscribe cleanup is final", async (t) => {
    for (const unsubscribeThrows of [false, true]) {
        const e = await environment(t);
        const ledger = new state.Ledger();
        const warnings = [];
        t.mock.method(console, "warn", (...args) => warnings.push(args));
        const host = {
            pi: { getAllTools: () => [], getActiveTools: () => [] },
            config: () => e.config,
            settings: () => ({}),
            ledger: () => ledger,
            authorize: async () => undefined,
        };
        let started;
        const promptStarted = new Promise((resolve) => started = resolve);
        let release;
        const pending = new Promise((resolve) => release = resolve);
        let event;
        let aborts = 0;
        const runner = new runtime.Runtime(host, (options) => ({
            state: {},
            subscribe(callback) {
                event = callback;
                return () => {};
            },
            abort() {
                aborts++;
            },
            async waitForIdle() {},
            async prompt() {
                started();
                await pending;
                await options.initialState.tools.find((t) => t.name === "agent_report").execute(
                    "report",
                    report(),
                );
            },
        }));
        e.ctx.tools = [];
        let heartbeat;
        let unsubscribed = 0;
        let fail = false;
        let publications = 0;
        const running = runner.run([{ agent: "scout", task: "Quiet" }], e.ctx, undefined, () => {
            publications++;
            if (fail) throw new Error("runtime consumer failure");
        }, (refresh) => {
            heartbeat = refresh;
            return () => {
                unsubscribed++;
                if (unsubscribeThrows) throw new Error("unsubscribe failure");
            };
        });
        await promptStarted;
        fail = true;
        assert.doesNotThrow(heartbeat);
        const count = publications;
        assert.doesNotThrow(heartbeat);
        assert.doesNotThrow(() => event({ type: "tool_execution_start", toolName: "read" }));
        assert.equal(publications, count);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0][0], /Disabled runtime update subscriber/);
        assert.equal(aborts, 0);
        release();
        if (unsubscribeThrows) await assert.rejects(running, /unsubscribe failure/);
        else assert.equal((await running).results[0].status, "complete");
        assert.equal([...ledger.runs.values()][0].status, "complete");
        assert.equal(runner.busy, false);
        assert.equal(runner.controllers.size, 0);
        assert.equal(runner.children.size, 0);
        assert.equal(unsubscribed, 1);
        assert.doesNotThrow(heartbeat);
        assert.equal(publications, count);
        t.mock.restoreAll();
    }
});

test("ownership canonicalization, escapes, symlink aliases, batch and cross-call conflicts", async (t) => {
    const e = await environment(t);
    await mkdir(join(e.cwd, "src"));
    await symlink(join(e.cwd, "src"), join(e.cwd, "alias"));
    const a = await scheduling.ownership(e.cwd, ["src"]);
    const b = await scheduling.ownership(e.cwd, ["alias/file.ts"]);
    assert.equal(scheduling.overlaps(a, b), true);
    await assert.rejects(scheduling.ownership(e.cwd, ["../escape"]), /escapes/);
    await assert.rejects(scheduling.ownership(e.cwd, ["src/*.ts"]), /explicit/);
    await symlink(e.agentDir, join(e.cwd, "outside"));
    await assert.rejects(scheduling.ownership(e.cwd, ["outside/child"]), /escapes/);
    const scheduler = new scheduling.Scheduler();

    const job = (id, paths) => ({ id, paths, writer: true, reviewer: false });

    assert.throws(() => scheduler.reserve([job("a", a), job("b", b)]), /conflict/);
    assert.throws(() => scheduler.reserve([job("a", []), job("b", b)]), /nonempty/);
    scheduler.reserve([job("a", a)]);
    assert.throws(() => scheduler.reserve([job("b", b)]), /conflict/);
    assert.throws(() => scheduler.reserve([job("c", []), job("d", [])]), /nonempty/);
});
test("exclusive unscoped writers serialize; reviewers wait for all reserved workers", async () => {
    const s = new scheduling.Scheduler(4);
    const jobs = [{ id: "review", writer: false, reviewer: true, paths: [] }, {
        id: "w1",
        writer: true,
        reviewer: false,
        paths: ["/a"],
    }, { id: "w2", writer: true, reviewer: false, paths: ["/b"] }];
    s.reserve(jobs);
    const order = [];
    await Promise.all(jobs.map((j) =>
        s.run(j, async () => {
            order.push(`${j.id}-start`);
            await pause(3);
            order.push(`${j.id}-end`);
        })
    ));
    assert.ok(order.indexOf("review-start") > order.indexOf("w1-end"));
    assert.ok(order.indexOf("review-start") > order.indexOf("w2-end"));
    const a = { id: "a", writer: true, reviewer: false, paths: [] };
    const b = { id: "b", writer: true, reviewer: false, paths: ["/b"] };
    s.reserve([a]);
    s.reserve([b]);
    let active = 0;
    await Promise.all([a, b].map((j) =>
        s.run(j, async () => {
            assert.equal(active++, 0);
            await pause(2);
            active--;
        })
    ));
});
test("declared ownership enforces direct mutation paths including nested calls", async (t) => {
    let edits = 0;
    const h = await harness(t, {
        tools: [tool("edit", async () => {
            edits++;
            return { content: [], details: {} };
        })],
        stream: (m, c) =>
            stream(m, [
                call(
                    turns(c) === 0 ? "edit" : "agent_report",
                    turns(c) === 0 ? { path: "elsewhere.ts" } : report(),
                ),
            ]),
    });
    await h.execute("subagents_run", {
        tasks: [{ agent: "worker", task: "Scoped", writePaths: ["owned.ts"] }],
    });
    assert.equal(edits, 0);
    const who = { writePaths: await scheduling.ownership(h.cwd, ["src"]) };
    await assert.rejects(
        runtime.checkMutationPaths(who, "ast_grep_replace", { paths: ["src/*.ts"] }, h.cwd),
        /glob/,
    );
    await assert.rejects(
        runtime.checkMutationPaths(
            who,
            "lsp_navigation",
            { operation: "rename", path: "src/x.ts" },
            h.cwd,
        ),
        /affected paths/,
    );
});
test(
    "turn limit, timeout, active/queued cancellation and shutdown cleanup",
    { timeout: 5000 },
    async (t) => {
        const h = await harness(t, {
            tools: [tool("read")],
            stream: (m) => stream(m, [call("read", {})]),
        });
        await mkdir(h.agentDir, { recursive: true });
        await writeFile(
            join(h.agentDir, "pi-openai-subagents.json"),
            JSON.stringify({ maxTurns: 2, timeoutMs: 20, concurrency: 1 }),
        );
        await h.command("reload");
        const bounded = await h.execute("subagents_run", {
            tasks: [{ agent: "scout", task: "Loop" }],
        });
        assert.equal(bounded.result.details.results[0].turns, 2);
        assert.match(bounded.result.details.results[0].reason, /model turns/);
        h.ctx.modelRegistry.streamSimple = (m, _c, opts) => {
            const s = stream(m, [{ type: "text", text: "unused" }]);
            // Override with a delayed stream that listens for cancellation.
            return {
                async *[Symbol.asyncIterator]() {
                    if (!opts.signal.aborted) {
                        await new Promise((resolve) =>
                            opts.signal.addEventListener("abort", resolve, { once: true })
                        );
                    }
                    const message = {
                        role: "assistant",
                        content: [],
                        api: m.api,
                        provider: m.provider,
                        model: m.id,
                        stopReason: "aborted",
                        usage: state.emptyUsage(),
                        timestamp: Date.now(),
                    };
                    yield { type: "error", reason: "aborted", error: message };
                },
                result: () => s.result(),
            };
        };
        // Production timeouts are unref'ed; this abort-only fake stream has no live I/O.
        const keepAlive = setInterval(() => {}, 1000);
        try {
            const timeout = await h.execute("subagents_run", {
                tasks: [{ agent: "scout", task: "Timeout" }],
            });
            assert.match(timeout.result.details.results[0].reason, /timeout/);
        } finally {
            clearInterval(keepAlive);
        }
        const ctrl = new AbortController();
        const promise = h.execute("subagents_run", {
            tasks: [{ agent: "scout", task: "Active" }, { agent: "scout", task: "Queued" }],
        }, ctrl.signal);
        await pause(5);
        ctrl.abort();
        const cancelled = await promise;
        assert.ok(cancelled.result.details.results.every((r) => r.status === "cancelled"));
        const shutdown = h.execute("subagents_run", {
            tasks: [{ agent: "scout", task: "Shutdown" }],
        });
        await pause(5);
        await h.emit("session_shutdown", { reason: "reload" });
        assert.equal((await shutdown).result.details.results[0].status, "cancelled");
    },
);
