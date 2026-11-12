import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
    call,
    cfg,
    environment,
    harness,
    policies,
    presentation,
    report,
    state,
    stream,
    tool,
} from "./helpers.mjs";

const request = {
    agent: "scout",
    task: "Find local naming conventions",
    reason: "Project style context is missing",
};
const turns = (c) => c.messages.filter((m) => m.role === "assistant").length;
const resultOf = (r) => {
    assert.ok(r.result.details?.results, JSON.stringify(r.result.content));
    return r.result.details.results[0];
};
const run = async (h, agent, task, extra = {}) =>
    resultOf(
        await h.execute("subagents_run", {
            tasks: [{ agent, task, ...extra }],
        }),
    );

test("contextRequests schema is optional but nonempty and restricted to scout tasks", () => {
    const schema = state.ReportSchema;
    assert.equal(schema.required.includes("contextRequests"), false);
    const requests = schema.properties.contextRequests;
    assert.ok(requests, "common report schema exposes contextRequests");
    assert.equal(requests.minItems, 1);
    assert.equal(requests.items.properties.agent.const, "scout");
    for (const field of ["task", "reason"]) {
        assert.equal(requests.items.properties[field].type, "string");
        assert.equal(requests.items.properties[field].minLength, 1);
        assert.ok(requests.items.required.includes(field));
    }
});

test("invalid context requests are rejected by the real Agent report validator", async (t) => {
    for (
        const contextRequests of [
            [],
            [{ ...request, agent: "worker" }],
            [{ ...request, task: "" }],
            [{ ...request, reason: "" }],
            [{ ...request, extra: true }],
        ]
    ) {
        const h = await harness(t, {
            stream: (m) => stream(m, [call("agent_report", report({ contextRequests }))]),
        });
        await mkdir(h.agentDir, { recursive: true });
        await writeFile(
            join(h.agentDir, "pi-openai-subagents.json"),
            JSON.stringify({ maxTurns: 2 }),
        );
        await h.command("reload");
        const pending = await run(h, "gardener", "Wait for valid context report");
        assert.equal(pending.status, "incomplete");
        assert.equal(pending.report, undefined);
        assert.equal(pending.changed, false);
    }
});

test("gardener mandatory core and worker profile survive user replacement", async (t) => {
    const e = await environment(t);
    const directory = join(e.agentDir, "pi-openai-subagents", "agents");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "gardener.md");
    await writeFile(
        path,
        "---\nname: gardener\ndescription: Custom cleanup\nprofile: worker\n---\nLocal cleanup preferences\n",
    );
    const config = await cfg.loadConfiguration(e.agentDir, e.cwd, false);
    const gardener = config.definitions.get("gardener");
    assert.match(gardener.core, /behavior-preserving/);
    assert.match(gardener.core, /contextRequests/);
    assert.match(gardener.prompt, /Local cleanup preferences/);
    await writeFile(
        path,
        "---\nname: gardener\ndescription: Changed profile\nprofile: scout\n---\nChanged profile\n",
    );
    await assert.rejects(cfg.loadConfiguration(e.agentDir, e.cwd, false), /changed base profile/);
});

test("gardener discovery, high thinking precedence and worker capability ceiling", async (t) => {
    const e = await environment(t);
    const gardener = e.config.definitions.get("gardener");
    assert.ok(gardener, "bundled gardener must be discoverable");
    assert.equal(gardener.name, "gardener");
    assert.equal(gardener.profile, "worker");
    assert.equal(gardener.thinking, "high");
    e.config.user = { default: { thinking: "low" } };
    assert.equal((await cfg.resolveAssignment(e.config, {}, "gardener", e.ctx)).thinking, "high");
    assert.equal(
        (await cfg.resolveAssignment(
            e.config,
            {
                agents: { gardener: { thinking: "medium" } },
            },
            "gardener",
            e.ctx,
        )).thinking,
        "medium",
    );
    for (const name of ["read", "edit", "write", "bash"]) {
        assert.equal(
            policies.policyDecision(e.config, {}, gardener, tool(name), true, {}).reason,
            undefined,
        );
    }
    for (const name of ["subagents_run", "new_session"]) {
        assert.ok(policies.policyDecision(e.config, {}, gardener, tool(name), true, {}).reason);
    }
    const prompt = `${gardener.core}\n${gardener.prompt}`;
    assert.match(prompt, /behavior.preserv/i);
    assert.match(prompt, /AGENTS/);
    assert.match(prompt, /scout/i);
    assert.match(prompt, /before.*(mutat|edit|chang)|(?:mutat|edit|chang).*before/is);
    for (const name of ["scout", "orchestrator"]) {
        const d = e.config.definitions.get(name);
        assert.match(`${d.core}\n${d.prompt}`, /style|naming/i);
        assert.match(`${d.core}\n${d.prompt}`, /gardener/i);
    }
});

test("gardener receives fresh project instructions, explicit context and supplied scout style report", async (t) => {
    const prompts = [];
    const h = await harness(t, {
        stream: (m, c) => {
            prompts.push(JSON.stringify(c));
            return stream(m, [call(
                "agent_report",
                report({
                    summary: prompts.length === 1
                        ? "STYLE_SCOUT_SENTINEL: use descriptive snake_case helpers"
                        : "Cleanup inspected",
                }),
            )]);
        },
    });
    const scout = await run(h, "scout", "Discover project naming and style");
    await writeFile(
        join(h.cwd, "AGENTS.md"),
        "FRESH_GARDENER_STYLE_SENTINEL: prefer guard clauses.\n",
    );
    const gardener = await run(h, "gardener", "Standalone scoped behavior-preserving cleanup", {
        context: "EXPLICIT_GARDENER_CONTEXT: preserve exported names",
        inputs: [scout.id],
    });
    assert.equal(gardener.status, "complete");
    assert.equal(gardener.thinking, "high");
    assert.match(prompts.at(-1), /FRESH_GARDENER_STYLE_SENTINEL/);
    assert.match(prompts.at(-1), /EXPLICIT_GARDENER_CONTEXT/);
    assert.match(prompts.at(-1), /STYLE_SCOUT_SENTINEL/);
});

test("context request waits for parent scout handoff, retries carry all inputs and clear stale gap", async (t) => {
    let calls = 0;
    let retryPrompt;
    const h = await harness(t, {
        stream: (m, c) => {
            calls++;
            if (calls === 5) retryPrompt = JSON.stringify(c);
            return stream(m, [call(
                "agent_report",
                report(
                    calls === 2
                        ? { contextRequests: [request] }
                        : {},
                ),
            )]);
        },
    });
    const worker = await run(h, "worker", "Implement change");
    assert.equal(calls, 1, "worker must not automatically start optional gardener");
    const pending = await run(h, "gardener", "Clean up worker result", { inputs: [worker.id] });
    assert.equal(calls, 2, "request must not recursively spawn scout");
    assert.equal(pending.status, "incomplete");
    assert.match(pending.reason, /context/i);
    assert.match(pending.reason, /scout/i);
    assert.equal(pending.changed, false);
    assert.deepEqual(pending.report.contextRequests, [request]);
    assert.match(presentation.reportMarkdown(pending), /Find local naming conventions/);
    assert.match(presentation.reportMarkdown(pending), /Project style context is missing/);
    const ledger = new state.Ledger();
    ledger.putRun(worker);
    ledger.putRun(pending);
    const unresolved = () =>
        ledger.gaps().some((g) => g.includes(pending.id) && /context/i.test(g));
    assert.equal(unresolved(), true);
    const scout = await run(h, "scout", request.task, { inputs: [pending.id, worker.id] });
    ledger.putRun(scout);
    assert.equal(unresolved(), true, "scout alone does not resolve gardener request");
    const unrelated = await run(h, "gardener", "Unrelated cleanup");
    ledger.putRun(unrelated);
    assert.equal(unresolved(), true, "same agent without explicit request input is insufficient");
    const retry = await run(h, "gardener", "Retry cleanup with style context", {
        inputs: [pending.id, scout.id, worker.id],
    });
    assert.equal(retry.status, "complete");
    assert.deepEqual(retry.inputs, [pending.id, scout.id, worker.id]);
    for (const id of retry.inputs) assert.ok(retryPrompt.includes(id));
    ledger.putRun(retry);
    assert.equal(unresolved(), false);
    assert.equal(calls, 5);
});

test("legacy reports complete, explicit gardener writes still require independent review", async (t) => {
    let edits = 0;
    const h = await harness(t, {
        tools: [tool("edit", async () => {
            edits++;
            return { content: [], details: {} };
        })],
        stream: (m, c) =>
            stream(m, [
                turns(c) === 0
                    ? call("edit", { path: "sample.js" })
                    : call(
                        "agent_report",
                        report({ changeStatus: "changed", changes: ["Simplified helper"] }),
                    ),
            ]),
    });
    const gardener = await run(h, "gardener", "Simplify helper", { writePaths: ["sample.js"] });
    assert.equal(gardener.status, "complete");
    assert.equal(edits, 1);
    assert.equal(gardener.changed, true);
    assert.equal(gardener.report.contextRequests, undefined);
    const ledger = new state.Ledger();
    ledger.putRun(gardener);
    assert.ok(ledger.gaps().some((g) => g.includes(gardener.id) && /review/i.test(g)));
});

test("gardener and worker overlapping ownership is rejected before either child starts", async (t) => {
    let starts = 0;
    const h = await harness(t, {
        stream: (m) => {
            starts++;
            return stream(m, [call("agent_report", report())]);
        },
    });
    const result = await h.execute("subagents_run", {
        tasks: [
            { agent: "worker", task: "Implement", writePaths: ["src"] },
            { agent: "gardener", task: "Clean up", writePaths: ["src/helper.js"] },
        ],
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.result.content), /conflict/i);
    assert.equal(starts, 0);
});
