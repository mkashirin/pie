import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { cfg, environment, harness, model, pause, policies, state, tool } from "./helpers.mjs";

function markdown(name, extra = "", body = "Custom instructions") {
    return `---\nname: ${name}\ndescription: Custom ${name}\n${extra}\n---\n${body}\n`;
}

test("bundled roles, custom profiles and user/project trust precedence", async (t) => {
    const e = await environment(t);
    assert.equal(e.config.definitions.size, 7);
    const user = join(e.agentDir, "pi-openai-subagents/agents");
    const project = join(e.cwd, ".pi/pi-openai-subagents/agents");
    await mkdir(user, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(
        join(user, "worker.md"),
        markdown("worker", "model: other/family/model", "User worker"),
    );
    await writeFile(
        join(user, "designer.md"),
        markdown("designer", "profile: scout", "User designer"),
    );
    await writeFile(join(project, "worker.md"), markdown("worker", "", "Project worker"));
    const untrusted = await cfg.loadConfiguration(e.agentDir, e.cwd, false);
    assert.equal(untrusted.definitions.get("worker").prompt, "User worker");
    assert.equal(untrusted.definitions.get("designer").profile, "scout");
    assert.match(untrusted.definitions.get("worker").core, /Implement the assigned task/);
    const trusted = await cfg.loadConfiguration(e.agentDir, e.cwd, true);
    assert.equal(trusted.definitions.get("worker").prompt, "Project worker");
    await writeFile(join(project, "worker2.md"), markdown("worker", "", "duplicate"));
    await assert.rejects(cfg.loadConfiguration(e.agentDir, e.cwd, true), /duplicate/);
    await writeFile(join(user, "designer.md"), markdown("designer", "profile: broken"));
    await assert.rejects(cfg.loadConfiguration(e.agentDir, e.cwd, false), /invalid/);
});
test("malformed settings and definition fields are rejected", async (t) => {
    const e = await environment(t);
    for (
        const bad of [
            { maxTurns: 0 },
            { wat: true },
            { agents: { worker: { thinking: "huge" } } },
            { classifications: { mystery: "safe" } },
            { default: { model: "unqualified" } },
            [],
        ]
    ) assert.throws(() => cfg.validateSettings(bad));
    await mkdir(e.agentDir, { recursive: true });
    await writeFile(join(e.agentDir, "pi-openai-subagents.json"), "{bad");
    await assert.rejects(cfg.loadConfiguration(e.agentDir, e.cwd, false));
});
test("assignment precedence, provider slash parsing, auth and thinking validation", async (t) => {
    const e = await environment(t);
    const config = e.config;
    config.user = {
        default: { model: "other/family/model" },
        agents: { worker: { model: "other/family/model" } },
    };
    config.project = { agents: { worker: { model: "openai/old" } } };
    assert.deepEqual(cfg.splitModel("other/family/model"), ["other", "family/model"]);
    assert.equal(cfg.assignmentFor(config, {}, "worker").ref, "openai/old");
    const session = { agents: { worker: { model: "other/family/model" } } };
    assert.equal(
        (await cfg.resolveAssignment(config, session, "worker", e.ctx)).ref,
        "other/family/model",
    );
    await assert.rejects(
        cfg.resolveAssignment(
            config,
            { agents: { worker: { model: "no/model" } } },
            "worker",
            e.ctx,
        ),
        /unavailable/,
    );
    await assert.rejects(
        cfg.resolveAssignment(
            config,
            { agents: { worker: { thinking: "max" } } },
            "worker",
            e.ctx,
            true,
        ),
        /does not support/,
    );
    e.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false, error: "missing auth" });
    await assert.rejects(cfg.resolveAssignment(config, {}, "worker", e.ctx), /login/);
});
test("Markdown defaults precede shared defaults; inherited thinking is normalized", async (t) => {
    const e = await environment(t);
    const d = e.config.definitions.get("worker");
    d.model = "other/family/model";
    e.config.user = { default: { model: "openai/old" } };
    assert.equal(cfg.assignmentFor(e.config, {}, "worker").ref, "other/family/model");
    d.thinking = "max";
    const a = await cfg.resolveAssignment(e.config, {}, "worker", e.ctx);
    assert.equal(a.thinking, "high");
    assert.match(a.normalization, /max/);
});
test("fixed role ceilings, inheritance subsets and deny precedence", async (t) => {
    const e = await environment(t);
    const worker = e.config.definitions.get("worker");
    const scout = e.config.definitions.get("scout");
    const reviewer = e.config.definitions.get("reviewer");
    const session = { agents: { worker: { allowTools: ["read", "bash"], denyTools: ["bash"] } } };

    const decision = (d, name, args) =>
        policies.policyDecision(e.config, session, d, tool(name), true, args);

    assert.equal(decision(worker, "read").reason, undefined);
    assert.match(decision(worker, "bash").reason, /denied/);
    assert.match(decision(worker, "edit").reason, /allow subset/);
    assert.match(decision(scout, "bash").reason, /cannot use execute/);
    assert.equal(decision(reviewer, "bash").reason, undefined);
    assert.match(decision(reviewer, "edit").reason, /cannot use write/);
    assert.match(decision(worker, "subagents_run").reason, /cannot use delegate/);
    assert.equal(decision(scout, "mystery").capability, "unknown");
    assert.equal(
        policies.classify(tool("mystery", undefined, { annotations: { readOnlyHint: true } }), {}),
        "read",
    );
    assert.equal(
        policies.classify(tool("mystery", undefined, { annotations: { readOnlyHint: true } }), {
            mystery: "write",
        }),
        "write",
    );
    assert.equal(policies.classify(tool("lsp_navigation"), {}, { operation: "rename" }), "write");
    assert.equal(
        policies.classify(tool("lsp_navigation"), {}, { operation: "executeCommand" }),
        "execute",
    );
});
test("unknown-tool consent is serialized, schema-keyed, denied headlessly and invalidated", async (t) => {
    const e = await environment(t);
    const consent = new policies.Consent();
    const mystery = tool("mystery");
    let calls = 0;
    let active = 0;
    assert.equal(await consent.approve("scout", mystery, {}, e.ctx), false);
    e.ctx.hasUI = true;
    e.ctx.ui.confirm = async () => {
        assert.equal(active++, 0);
        calls++;
        await pause(5);
        active--;
        return true;
    };
    assert.deepEqual(
        await Promise.all([
            consent.approve("scout", mystery, { a: 1 }, e.ctx),
            consent.approve("scout", mystery, { a: 2 }, e.ctx),
        ]),
        [true, true],
    );
    assert.equal(calls, 1);
    await consent.approve("worker", mystery, {}, e.ctx);
    assert.equal(calls, 2);
    await consent.approve(
        "scout",
        { ...mystery, parameters: { type: "object", properties: { a: { type: "string" } } } },
        {},
        e.ctx,
    );
    assert.equal(calls, 3);
    consent.clear();
    await consent.approve("scout", mystery, {}, e.ctx);
    assert.equal(calls, 4);
    e.ctx.ui.confirm = async () => {
        calls++;
        return false;
    };
    consent.clear();
    assert.equal(await consent.approve("scout", mystery, {}, e.ctx), false);
    assert.equal(await consent.approve("scout", mystery, {}, e.ctx), false);
    assert.equal(calls, 5);
});
test("command save/session settings, idle-only mutation and failed reload retention", async (t) => {
    const h = await harness(t);
    assert.ok(h.commands.has("subagents"));
    assert.ok(h.tools.has("subagents_run"));
    assert.equal(h.commands.has("agents"), false);
    assert.equal(h.tools.has("agents_run"), false);
    await h.command("model worker other/family/model");
    assert.equal(h.entries.at(-1).data.settings.agents.worker.model, "other/family/model");
    await assert.rejects(readFile(join(h.agentDir, "pi-openai-subagents.json")));
    await h.command("model worker openai/old --save");
    const saved = JSON.parse(await readFile(join(h.agentDir, "pi-openai-subagents.json"), "utf8"));
    assert.equal(saved.agents.worker.model, "openai/old");
    await h.command("model worker reset");
    await h.command("tools scout allow read");
    await h.command("tools scout deny read");
    assert.deepEqual(h.entries.at(-1).data.settings.agents.scout.denyTools, ["read"]);
    await h.command("tools scout inherit");
    assert.deepEqual(h.entries.at(-1).data.settings.agents.scout, {});
    h.ctx.isIdle = () => false;
    await h.command("thinking scout low");
    assert.match(h.messages.at(-1).content, /idle/);
    h.ctx.isIdle = () => true;
    await writeFile(join(h.agentDir, "pi-openai-subagents.json"), "{bad");
    await h.command("reload");
    assert.match(h.messages.at(-1).content, /SyntaxError/);
    await h.command("models");
    assert.match(h.messages.at(-1).content, /worker: openai\/old/);
});
test("foreground is promptable; model/thinking switch/restore respects manual selection", async (t) => {
    const h = await harness(t);
    const original = h.ctx.model;
    await h.command("on");
    assert.equal(h.ctx.model.provider, "openai");
    assert.equal(h.ctx.thinkingLevel, "high");
    const event = { prompt: "Discuss choices", systemPromptOptions: { sections: {} } };
    await h.emit("before_agent_start", event);
    assert.match(event.systemPromptOptions.sections.openai_subagents, /foreground/);
    await h.command("off");
    assert.equal(h.ctx.model, original);
    assert.equal(h.ctx.thinkingLevel, "low");
    await h.command("on");
    await h.pi.setModel(h.models[1]);
    h.pi.setThinkingLevel("medium");
    await pause(0);
    await h.command("off");
    assert.equal(h.ctx.model, h.models[1]);
    assert.equal(h.ctx.thinkingLevel, "medium");
    await h.command("on");
    assert.equal(h.ctx.model, h.models[1]);
});
test("active branch restores assignments and never imports abandoned branch data", async (t) => {
    const h = await harness(t);
    await h.command("model scout other/family/model");
    const selectedBranch = structuredClone(h.entries);
    await h.command("model scout openai/old");
    h.ctx.sessionManager.getBranch = () => selectedBranch;
    await h.emit("session_tree", {});
    await h.command("models");
    assert.match(h.messages.at(-1).content, /scout: other\/family\/model/);
    assert.equal(state.restore([]).mode.enabled, false);
});
