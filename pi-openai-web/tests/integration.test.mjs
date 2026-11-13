import {
    createExtensionRuntime,
    ExtensionRunner,
    SessionManager,
    wrapRegisteredTool,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Value } from "typebox/value";
import { PacketSchema } from "../src/schemas.ts";

const jiti = createJiti(import.meta.url);
const { visibleWidth } = await jiti.import("@pi-extensions/pi-kit");
const { default: factory } = await jiti.import("../index.ts");
const { Runtime } = await jiti.import("../src/runtime.ts");

const { loadExtensionFromFactory } = await import(
    new URL("core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"))
);

async function isolateUserConfiguration(t) {
    const directory = await mkdtemp(join(tmpdir(), "pi-openai-web-integration-"));
    const keys = Object.keys(process.env).filter((key) =>
        key === "PI_CODING_AGENT_DIR" || key.startsWith("PI_OPENAI_WEB_")
    );
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    process.env.PI_CODING_AGENT_DIR = directory;
    t.after(async () => {
        for (const key of Object.keys(process.env)) {
            if (key === "PI_CODING_AGENT_DIR" || key.startsWith("PI_OPENAI_WEB_")) {
                delete process.env[key];
            }
        }
        Object.assign(process.env, previous);
        await rm(directory, { recursive: true, force: true });
    });
}

test("installed Pi loader/runner/wrapper: disabled registration, no UI/network status, callable structured result and veto", async (t) => {
    await isolateUserConfiguration(t);
    const previous = process.env.PI_OPENAI_WEB_ENABLED;
    process.env.PI_OPENAI_WEB_ENABLED = "false";
    try {
        const runtime = createExtensionRuntime();
        const loaded = await loadExtensionFromFactory(factory, process.cwd(), {
            emit() {},
            on() {
                return () => {};
            },
        }, runtime);
        assert.ok(loaded.handlers instanceof Map);
        const registry = {
            find: () => undefined,
            hasConfiguredAuth: () => false,
            streamSimple: () => {
                throw Error("network forbidden");
            },
            getApiKey: () => {
                throw Error("auth refresh forbidden");
            },
        };
        const runner = new ExtensionRunner(
            [loaded],
            runtime,
            process.cwd(),
            SessionManager.inMemory(process.cwd()),
            registry,
        );
        runner.onError((error) => {
            throw Error(error.message);
        });
        await runner.emit({ type: "session_start", reason: "startup" });
        assert.equal(runner.getAllRegisteredTools().length, 0);
        const messages = [];
        runtime.sendMessage = (message, options) => messages.push({ message, options });
        runner.getModel = () => ({ provider: "openai", api: "openai-responses", id: "fixture" });
        await loaded.commands.get("openai-web").handler("status", runner.createContext());
        assert.match(messages[0].message.content, /auth=not configured/);
        assert.equal(messages[0].options.triggerTurn, false);
        const commandRenderer = runner.getMessageRenderer("pi-openai-web-status");
        assert.ok(commandRenderer);
        for (
            const content of [
                messages[0].message.content,
                "pi-openai-web: Usage: test\nsecond line",
            ]
        ) {
            const component = commandRenderer({ ...messages[0].message, content }, {}, {});
            const rendered = component.render(80);
            assert.ok(rendered.length > 0);
            assert.ok(rendered.every((line) => line.startsWith(" ") && !line.startsWith("  ")));
            assert.equal(rendered[0].trim(), content.split("\n")[0]);
        }
        const statusView = commandRenderer({ content: "alpha beta gamma delta" }, {}, {});
        assert.deepEqual(statusView.render(14), [" alpha beta  ", " gamma delta "]);
        assert.ok(statusView.render(1).every((line) => visibleWidth(line) <= 1));
        assert.deepEqual(statusView.render(0), []);
        runner.getModel = () => undefined;
        process.env.PI_OPENAI_WEB_ENABLED = "true";
        await runner.emit({ type: "session_start", reason: "reload" });
        assert.deepEqual(
            runner.getAllRegisteredTools().map((tool) => tool.definition.name).sort(),
            ["openai_search", "web_action"],
        );
        assert.ok(
            !runner.getAllRegisteredTools().some((tool) => tool.definition.name === "openai_web"),
        ); // No alias.
        const pageDefinition = runner.getAllRegisteredTools().find((tool) =>
            tool.definition.name === "web_action"
        ).definition;
        assert.match(pageDefinition.description, /Standalone, credential-free HTTP fallback/);
        assert.match(pageDefinition.promptGuidelines.join("\n"), /Use web_action/);
        assert.ok(
            pageDefinition.promptGuidelines.every((line) => !line.includes("openai_web")),
        );
        assert.equal(
            Value.Check(pageDefinition.parameters, { action: "open", url: "https://example.com" }),
            true,
        );
        assert.equal(
            Value.Check(pageDefinition.parameters, {
                action: "find",
                url: "https://example.com",
                pattern: "fixture",
                max_matches: 51,
            }),
            false,
        );
        const registered = runner.getAllRegisteredTools().find((tool) =>
            tool.definition.name === "openai_search"
        );
        const callable = wrapRegisteredTool(registered, runner);
        const result = await callable.execute(
            "fixture",
            { queries: ["fixture"] },
            new AbortController().signal,
        );
        assert.equal(Value.Check(PacketSchema, result.structuredContent), true);
        assert.equal(result.isError, true); // No physical active model: fail closed before transport.
        // Host-generated errors bypass execute() and carry {} rather than a web Packet.
        for (const { definition } of runner.getAllRegisteredTools()) {
            for (const expanded of [false, true]) {
                const view = definition.renderResult(
                    {
                        content: [{ type: "text", text: "fixture permission veto\x07" }],
                        details: {},
                    },
                    { expanded, isPartial: false },
                    { fg: (_color, text) => text },
                );
                assert.deepEqual(view.render(80), ["", "fixture permission veto"]);
                assert.ok(view.render(8).every((line) => visibleWidth(line) <= 8));
            }
        }
        loaded.handlers.set("tool_call", [
            () => ({ block: true, reason: "fixture permission veto" }),
        ]);
        for (const toolName of ["openai_search", "web_action"]) {
            const veto = await runner.emitToolCall({
                type: "tool_call",
                toolName,
                toolCallId: "veto",
                input: toolName === "openai_search"
                    ? { queries: ["fixture"] }
                    : { action: "open", url: "https://example.com" },
            });
            assert.equal(veto.block, true);
            assert.equal(veto.reason, "fixture permission veto");
        }
        process.env.PI_OPENAI_WEB_ENABLED = "false";
        await runner.emit({ type: "session_start", reason: "reload" });
        assert.ok(
            runner.getAllRegisteredTools().every((tool) => tool.definition.exposure === "hidden"),
        );
        const disabled = await callable.execute(
            "disabled",
            { queries: ["fixture"] },
            new AbortController().signal,
        );
        assert.match(disabled.structuredContent.error.message, /disabled/);
        assert.equal(disabled.isError, true);
        await runner.emit({ type: "session_shutdown", reason: "quit" });
    } finally {
        if (previous === undefined) delete process.env.PI_OPENAI_WEB_ENABLED;
        else process.env.PI_OPENAI_WEB_ENABLED = previous;
    }
});

test("installed SDK: both tools cancel during reload on shutdown/replacement; new sessions work", async (t) => {
    await isolateUserConfiguration(t);
    const previous = process.env.PI_OPENAI_WEB_ENABLED;
    process.env.PI_OPENAI_WEB_ENABLED = "true";
    let calls = 0;
    const capture = Runtime.prototype.captureLifecycle;
    t.mock.method(Runtime.prototype, "captureLifecycle", function() {
        // Replace only transport adapters; execute/reload, lifecycle and semaphore remain real.
        this.adapters = {
            search: async (options) => {
                calls++;
                return {
                    ok: true,
                    status: "success",
                    query: options.query,
                    model: options.model,
                    freshness: options.freshness,
                    searchContextSize: options.searchContextSize,
                    startedAt: 1,
                    finishedAt: 2,
                    answerSegments: [],
                    citations: [],
                    actions: [],
                    sources: [],
                    warnings: [],
                    truncation: { answer: false, evidence: false, answerBytes: 0, answerLines: 0 },
                };
            },
            page: async (args) => {
                calls++;
                return {
                    ok: true,
                    requestedUrl: args.url,
                    finalUrl: args.url,
                    timestamp: new Date().toISOString(),
                    title: null,
                    totalLines: 0,
                    excerpts: [],
                    matches: [],
                    no_match: false,
                    warnings: [],
                    completeness: "complete",
                    truncated: false,
                    truncation: { wire: false, decoded: false, extracted: false, matches: false },
                };
            },
        };
        return capture.call(this);
    });
    try {
        const runtime = createExtensionRuntime();
        const loaded = await loadExtensionFromFactory(factory, process.cwd(), {
            emit() {},
            on() {
                return () => {};
            },
        }, runtime);
        const runner = new ExtensionRunner(
            [loaded],
            runtime,
            process.cwd(),
            SessionManager.inMemory(process.cwd()),
            {
                find: () => undefined,
                hasConfiguredAuth: () => false,
                streamSimple: () => {
                    throw Error("real network forbidden");
                },
                getApiKey: () => {
                    throw Error("credentials forbidden");
                },
            },
        );
        runner.getModel = () => ({ provider: "openai", api: "openai-responses", id: "fixture" });
        await runner.emit({ type: "session_start", reason: "startup" });
        const tools = runner.getAllRegisteredTools().map((tool) =>
            wrapRegisteredTool(tool, runner)
        );
        assert.deepEqual(tools.map((tool) => tool.name).sort(), ["openai_search", "web_action"]);

        const invoke = (tool) =>
            tool.execute(
                "fixture",
                tool.name === "openai_search"
                    ? { queries: ["fixture"] }
                    : { action: "open", url: "https://example.com" },
                new AbortController().signal,
            );

        for (const transition of ["shutdown", "replacement"]) {
            const pending = tools.map(invoke); // Both executions are awaiting filesystem reload.
            const change = transition === "shutdown"
                ? runner.emit({ type: "session_shutdown", reason: "quit" })
                : runner.emit({ type: "session_start", reason: "new" });
            const cancelled = await Promise.all(pending);
            await change;
            for (const output of cancelled) {
                assert.equal(output.details.error.kind, "cancelled");
                assert.equal(Value.Check(PacketSchema, output.details), true);
                assert.equal(output.usage, undefined);
            }
            assert.equal(calls, transition === "shutdown" ? 0 : 2);
            if (transition === "shutdown") {
                for (const output of await Promise.all(tools.map(invoke))) {
                    assert.equal(output.details.error.kind, "cancelled");
                }
                assert.equal(calls, 0);
            }
            await runner.emit({ type: "session_start", reason: "resume" });
            const outputs = await Promise.all(tools.map(invoke));
            for (const [index, output] of outputs.entries()) {
                assert.equal(output.details.status, "success");
                assert.equal(output.details.tool, tools[index].name);
                assert.equal(Value.Check(PacketSchema, output.details), true);
            }
        }
        assert.equal(calls, 4);
        const pageTool = tools.find((tool) => tool.name === "web_action");
        const found = await pageTool.execute(
            "find-fixture",
            { action: "find", url: "https://example.com", pattern: "fixture" },
            new AbortController().signal,
        );
        assert.equal(found.structuredContent.tool, "web_action");
        assert.equal(found.structuredContent.request.action, "find");
        assert.equal(Value.Check(PacketSchema, found.structuredContent), true);
        assert.equal(calls, 5);
        await runner.emit({ type: "session_shutdown", reason: "quit" });
    } finally {
        if (previous === undefined) delete process.env.PI_OPENAI_WEB_ENABLED;
        else process.env.PI_OPENAI_WEB_ENABLED = previous;
    }
});
