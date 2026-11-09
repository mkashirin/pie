import { Type } from "typebox";
import {
    createAgentSession,
    DefaultResourceLoader,
    ModelRuntime,
    SessionManager,
    SettingsManager,
} from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    call,
    environment,
    extension,
    model,
    policies,
    report,
    searchPacket,
    state,
    stream,
} from "./helpers.mjs";

test("installed Pi SDK: extension loading, actual parent bridges/hooks, nested identity, model switching and usage", async (t) => {
    const e = await environment(t);
    await mkdir(e.agentDir, { recursive: true });
    await writeFile(join(e.cwd, "fixture.txt"), "original fixture");
    await writeFile(
        join(e.agentDir, "pi-openai-subagents.json"),
        JSON.stringify({
            default: { model: "agent-test/child" },
            agents: { orchestrator: { model: "agent-test/parent" } },
            classifications: { mutation_probe: "write", wrapper: "read" },
        }),
    );
    const mr = await ModelRuntime.create({
        authPath: join(e.agentDir, "auth.json"),
        modelsPath: null,
        modelsStorePath: join(e.agentDir, "models-store.json"),
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    let parentTurns = 0;
    const identities = [];
    const errors = [];
    mr.registerProvider("agent-test", {
        baseUrl: "https://never-called.invalid",
        apiKey: "fake-test-key",
        api: "openai-responses",
        models: ["parent", "child", "previous"].map((id) => ({
            ...model("agent-test", id),
            api: "openai-responses",
        })),
        streamSimple: (m, context) => {
            if (m.id !== "child") {
                if (parentTurns++ === 0) {
                    return stream(m, [
                        call("subagents_run", {
                            tasks: [{ agent: "worker", task: "Probe nested access" }, {
                                agent: "scout",
                                task: "Probe nested denial",
                            }],
                        }),
                    ]);
                }
                return stream(m, [{ type: "text", text: "Foreground synthesis" }]);
            }
            const step = context.messages.filter((x) => x.role === "assistant").length;
            return stream(m, [
                call(step === 0 ? "wrapper" : "agent_report", step === 0 ? {} : report()),
            ]);
        },
    });
    const settings = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
        cacheWarming: "off",
    });
    const loader = new DefaultResourceLoader({
        cwd: e.cwd,
        agentDir: e.agentDir,
        settingsManager: settings,
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        extensionFactories: [extension, (pi) => {
            pi.registerTool({
                name: "mutation_probe",
                label: "Test mutation",
                description: "Inert mutation-classified test probe",
                parameters: Type.Object({}),
                async execute() {
                    identities.push(policies.identity.getStore()?.agent);
                    return {
                        content: [{ type: "text", text: "Probe ran; no actual mutation" }],
                        details: {},
                    };
                },
            });
            pi.registerTool({
                name: "wrapper",
                label: "Test wrapper",
                description: "Test nested parent calls",
                parameters: Type.Object({}),
                async execute(_id, _args, signal, _update, ctx) {
                    return (await ctx.executeTool("mutation_probe", {}, { signal })).result;
                },
            });
        }],
    });
    await loader.reload();
    const { session, extensionsResult } = await createAgentSession({
        cwd: e.cwd,
        agentDir: e.agentDir,
        modelRuntime: mr,
        model: mr.getModel("agent-test", "previous"),
        thinkingLevel: "low",
        settingsManager: settings,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(e.cwd),
    });
    t.after(() => session.dispose());
    assert.deepEqual(extensionsResult.errors, []);
    await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
    assert.ok(session.getActiveToolNames().includes("subagents_run"));
    await session.prompt("/subagents on");
    assert.equal(session.model.id, "parent");
    await session.prompt("Probe both roles and synthesize.");
    const result = session.messages.find((m) =>
        m.role === "toolResult" && m.toolName === "subagents_run"
    );
    assert.ok(result, JSON.stringify(session.messages));
    assert.deepEqual(result.details.results.map((r) => r.status), ["complete", "complete"]);
    assert.deepEqual(identities, ["worker"]);
    assert.equal(result.details.results[0].model, "agent-test/child");
    assert.ok(
        result.nestedCalls?.calls?.length || result.nestedCalls,
        "Actual Pi should record nested calls",
    );
    assert.equal(result.usage.totalTokens, 20); // two children, two model turns each; no nested usage counted twice
    assert.equal(await readFile(join(e.cwd, "fixture.txt"), "utf8"), "original fixture");
    await session.prompt("/subagents off");
    assert.equal(session.model.id, "previous");
    assert.equal(session.thinkingLevel, "low");
    assert.deepEqual(errors, []);
});

test("installed SDK: canonical registration once, physical OpenAI default, veto and own-search gates", async (t) => {
    const e = await environment(t);
    await mkdir(e.agentDir, { recursive: true });
    const mr = await ModelRuntime.create({
        authPath: join(e.agentDir, "auth.json"),
        modelsPath: null,
        modelsStorePath: join(e.agentDir, "models-store.json"),
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    let target;
    let searchCalls = 0;
    let veto = true;
    let skipSearch = false;
    const physical = [];
    mr.registerProvider("openai", {
        baseUrl: "https://never-called.invalid",
        apiKey: "fake-test-key",
        api: "openai-responses",
        models: [model()],
        streamSimple: (m, context) => {
            physical.push([m.provider, m.api]);
            const step = context.messages.filter((x) => x.role === "assistant").length;
            if (!step && !skipSearch) {
                return stream(m, [call("openai_search", { queries: ["primary source"] })]);
            }
            const evidence = context.messages.filter((x) => x.role === "toolResult").at(-1)
                ?.content.filter((x) => x.type === "text").map((x) => x.text).join("\n")
                .match(/Evidence packet ID: (evidence-[\w-]+)/)?.[1];
            return stream(m, [call(
                "agent_report",
                report(
                    target
                        ? {
                            checks: [{
                                target,
                                verdict: "supported",
                                reason: "Independent source",
                                evidence: evidence ? [evidence] : [],
                            }],
                        }
                        : {
                            claims: [{
                                claim: "Fixture source claim",
                                evidence: evidence ? [evidence] : [],
                                urls: ["https://source.example"],
                                date: "2026-01-01",
                                uncertainty: "Inert test fixture",
                            }],
                        },
                ),
            )]);
        },
    });
    const settings = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
        cacheWarming: "off",
    });
    const loader = new DefaultResourceLoader({
        cwd: e.cwd,
        agentDir: e.agentDir,
        settingsManager: settings,
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        additionalExtensionPaths: [fileURLToPath(new URL("../", import.meta.url))],
        extensionFactories: [(pi) => {
            pi.registerTool({
                name: "openai_search",
                label: "Search",
                description: "Inert v1 search fixture",
                parameters: Type.Object({ queries: Type.Array(Type.String()) }),
                execute: async () => {
                    searchCalls++;
                    const packet = searchPacket();
                    return {
                        content: [{ type: "text", text: "Independent source" }],
                        details: packet,
                        structuredContent: packet,
                    };
                },
            });
            pi.on("tool_call", (event) =>
                veto && event.toolName === "openai_search"
                    ? { block: true, reason: "Parent search veto" }
                    : undefined);
        }],
    });
    await loader.reload();
    const { session, extensionsResult } = await createAgentSession({
        cwd: e.cwd,
        agentDir: e.agentDir,
        modelRuntime: mr,
        model: mr.getModel("openai", "gpt-6.1-sol"),
        settingsManager: settings,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(e.cwd),
    });
    t.after(() => session.dispose());
    assert.deepEqual(extensionsResult.errors, []);
    const registered = extensionsResult.extensions.filter((x) => x.tools.has("subagents_run"));
    assert.equal(registered.length, 1);
    assert.equal(
        registered[0].resolvedPath,
        fileURLToPath(new URL("../index.ts", import.meta.url)),
    );
    for (const prefix of ["pi-openai-subagents"]) {
        for (const suffix of ["info", "warning"]) {
            assert.ok(registered[0].messageRenderers.has(`${prefix}-${suffix}`));
        }
    }
    await session.bindExtensions({ mode: "print" });
    // Invoke through the actual SDK extension context's parent bridge, not tool implementations.
    let result;
    mr.registerProvider("sdk-parent", {
        baseUrl: "https://never-called.invalid",
        apiKey: "fake-test-key",
        api: "openai-responses",
        models: [model("sdk-parent", "parent")],
        streamSimple: (m, context) => {
            const last = context.messages.at(-1);
            if (last?.role === "toolResult") {
                result = last.details.results[0];
                return stream(m, [{ type: "text", text: "Settled" }]);
            }
            return stream(m, [
                call("subagents_run", {
                    tasks: [{
                        agent: target ? "research-validator" : "researcher",
                        task: "Search fixture",
                        inputs: target ? [target] : [],
                    }],
                }),
            ]);
        },
    });
    await session.setModel(mr.getModel("sdk-parent", "parent"));
    await session.prompt("Vetoed search");
    assert.equal(result.status, "incomplete");
    assert.equal(searchCalls, 0);
    veto = false;
    await session.prompt("Research source");
    assert.equal(result.status, "complete", JSON.stringify(result));
    assert.equal(result.model, "openai/gpt-6.1-sol");
    assert.equal(result.evidence[0].tool, "openai_search");
    assert.equal(state.successfulSearch(result.evidence[0]), true);
    target = result.id;
    skipSearch = true;
    await session.prompt("Input evidence is not own search");
    assert.equal(result.status, "incomplete");
    skipSearch = false;
    await session.prompt("Independent validator search");
    assert.equal(result.status, "complete", JSON.stringify(result));
    assert.equal(result.evidence[0].owner, result.id);
    assert.equal(searchCalls, 2);
    assert.ok(
        physical.length > 0
            && physical.every(([provider, api]) =>
                provider === "openai" && api === "openai-responses"
            ),
    );
});
