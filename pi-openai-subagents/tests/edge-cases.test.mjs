import assert from "node:assert/strict";
import test from "node:test";
import { call, environment, harness, pause, policies, report, stream, tool } from "./helpers.mjs";

test("extension-generated thinking events stay internal across delayed prior hooks", async (t) => {
    const h = await harness(t);
    h.hooks.get("thinking_level_select").unshift(async () => {
        await pause(10);
    });
    await h.command("on");
    await pause(20);
    assert.equal(h.entries.at(-1).data.manualThinking, false);
    assert.equal(h.entries.at(-1).data.settings.agents?.orchestrator?.thinking, undefined);
    await h.command("off");
    await pause(20);
    assert.equal(h.ctx.thinkingLevel, "low");
    await h.command("on");
    h.pi.setThinkingLevel("medium");
    await pause(20);
    assert.equal(h.entries.at(-1).data.manualThinking, true);
    assert.equal(h.entries.at(-1).data.settings.agents.orchestrator.thinking, "medium");
    await h.command("off");
    assert.equal(h.ctx.thinkingLevel, "medium");
});

test("loadout advertises available specialists and unknown-tool approval requirements", async (t) => {
    const h = await harness(t, { tools: [tool("mystery"), tool("bash")] });

    const loadout = () => ({ declared: [...h.tools.values()], registered: [...h.tools.values()] });

    const outside = h.tools.get("subagents_run").prepareLoadout(loadout());
    assert.match(outside.descriptions.subagents_run, /research-validator/);
    assert.equal(outside.hiddenDeclarations, undefined);
    await h.command("on");
    const inside = h.tools.get("subagents_run").prepareLoadout(loadout());
    assert.match(inside.descriptions.mystery, /approval is required/);
    assert.ok(inside.hiddenDeclarations.includes("bash"));
    assert.ok(!inside.hiddenDeclarations.includes("mystery"));
});

test("cancelled consent and configuration invalidation never cache late approvals", async (t) => {
    const e = await environment(t);
    const consent = new policies.Consent();
    e.ctx.hasUI = true;
    let dialogs = 0;
    e.ctx.ui.confirm = async () => {
        dialogs++;
        await pause(10);
        return true;
    };
    const ctrl = new AbortController();
    const first = consent.approve("scout", tool("mystery"), {}, e.ctx, ctrl.signal);
    await pause(1);
    ctrl.abort();
    assert.equal(await first, false);
    const second = consent.approve("scout", tool("mystery"), {}, e.ctx);
    await pause(1);
    consent.clear();
    assert.equal(await second, false);
    assert.equal(await consent.approve("scout", tool("mystery"), {}, e.ctx), true);
    assert.equal(dialogs, 3);
});

test("a linked reviewer report without real inspection remains incomplete", async (t) => {
    const h = await harness(t);
    const worker = await h.execute("subagents_run", {
        tasks: [{ agent: "worker", task: "No changes" }],
    });
    const id = worker.result.details.results[0].id;
    h.ctx.modelRegistry.streamSimple = (m) =>
        stream(m, [call(
            "agent_report",
            report({
                verification: ["Claimed inspection without running a tool"],
                checks: [{
                    target: id,
                    verdict: "pass",
                    reason: "Unsupported claim",
                    evidence: [],
                }],
            }),
        )]);
    const review = await h.execute("subagents_run", {
        tasks: [{ agent: "reviewer", task: "Review", inputs: [id] }],
    });
    assert.equal(review.result.details.results[0].status, "incomplete");
    assert.match(review.result.details.results[0].reason, /actual inspection/);
    assert.ok(
        review.result.details.results[0].report,
        "Retain the report alongside incomplete status",
    );
});

test("foreground-only orchestrator and batch limits fail before starting child work", async (t) => {
    let started = 0;
    const h = await harness(t, {
        stream: (m) => {
            started++;
            return stream(m, [call("agent_report", report())]);
        },
    });
    const foreground = await h.execute("subagents_run", {
        tasks: [{ agent: "orchestrator", task: "Converse" }],
    });
    assert.equal(foreground.isError, true);
    assert.match(foreground.result.content[0].text, /foreground/);
    const oversized = await h.execute("subagents_run", {
        tasks: Array.from({ length: 9 }, () => ({ agent: "scout", task: "Inspect" })),
    });
    assert.equal(oversized.isError, true);
    assert.equal(started, 0);
});
