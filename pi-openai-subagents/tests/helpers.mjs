import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createJiti } from "jiti";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, { fsCache: false });
export const cfg = await jiti.import("../src/config.ts");
export const policies = await jiti.import("../src/policy.ts");
export const state = await jiti.import("../src/state.ts");
export const scheduling = await jiti.import("../src/scheduler.ts");
export const runtime = await jiti.import("../src/runtime.ts");
export const promptInputs = await jiti.import("../src/prompt-inputs.ts");
export const commands = await jiti.import("../src/commands.ts");
export const ui = await jiti.import("../src/ui.ts");
export const activity = await jiti.import("../src/activity.ts");
export const presentation = await jiti.import("../src/presentation.ts");
export const extension = await jiti.import("../index.ts", { default: true });

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export const report = (overrides = {}) => ({
    summary: "Task inspected",
    changeStatus: "none",
    changes: [],
    verification: [],
    findings: [],
    limitations: [],
    claims: [],
    checks: [],
    ...overrides,
});

export function model(provider = "openai", id = "gpt-6.1-sol") {
    return {
        id,
        name: id,
        api: "openai-responses",
        provider,
        baseUrl: "https://example.invalid",
        reasoning: true,
        thinkingLevelMap: { xhigh: null, max: null },
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 8192,
    };
}

export function tool(
    name,
    execute = async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
    fields = {},
) {
    return {
        name,
        label: name,
        description: name,
        parameters: Type.Object({}, { additionalProperties: true }),
        execute,
        exposure: "direct",
        ...fields,
    };
}

export function stream(
    model,
    content,
    stopReason = content.some((c) => c.type === "toolCall") ? "toolUse" : "stop",
) {
    const s = createAssistantMessageEventStream();
    const message = {
        role: "assistant",
        content,
        api: model.api,
        model: model.id,
        provider: model.provider,
        usage: { ...state.emptyUsage(), input: 3, output: 2, totalTokens: 5 },
        stopReason,
        timestamp: Date.now(),
    };
    queueMicrotask(() => {
        s.push({ type: "start", partial: message });
        s.push({ type: "done", reason: stopReason, message });
        s.end(message);
    });
    return s;
}

let nextCall = 0;

export const call = (name, args) => ({
    type: "toolCall",
    id: `fake-${++nextCall}`,
    name,
    arguments: args,
});

export const text = (value) => [{ type: "text", text: value }];

// A realistic pi-openai-web v1 packet, including completed native search and answer.
export function searchPacket(overrides = {}) {
    const identity = { provider: "openai", id: "gpt-6.1-sol", api: "openai-responses" };
    return {
        version: 1,
        tool: "openai_search",
        status: "success",
        request: {
            id: "request-test",
            startedAt: 1,
            finishedAt: 2,
            model: identity,
            freshness: "live",
            searchContextSize: "medium",
            queries: ["primary source"],
        },
        results: [{
            id: "query-test",
            query: "primary source",
            model: identity,
            freshness: "live",
            searchContextSize: "medium",
            startedAt: 1,
            finishedAt: 2,
            ok: true,
            status: "success",
            answerSegments: [{
                origin: { outputIndex: 1, contentIndex: 0 },
                text: "Independent source",
                complete: true,
                truncated: false,
                provenance: "provider",
            }],
            citations: [{
                type: "url_citation",
                url: "https://source.example",
                title: "Primary",
                origin: { outputIndex: 1, contentIndex: 0 },
                startIndex: 0,
                endIndex: 18,
            }],
            actions: [{
                id: "search-test",
                outputIndex: 0,
                status: "completed",
                type: "search",
                queries: ["primary source"],
            }],
            sources: [{
                type: "url",
                url: "https://source.example",
                actionId: "search-test",
                outputIndex: 0,
            }],
            warnings: [],
            truncation: { answer: false, evidence: false, answerBytes: 18, answerLines: 1 },
        }],
        evidence: [{
            id: "native-source-test",
            queryId: "query-test",
            kind: "source",
            url: "https://source.example",
        }],
        nativeSearchFees: "unknown",
        warnings: [],
        truncation: { text: false, structured: false, omissions: [] },
        ...overrides,
    };
}

const isolatedTests = new WeakSet();

export async function environment(t, opts = {}) {
    const dir = await mkdtemp(fileURLToPath(new URL("../.test-", import.meta.url)));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const agentDir = join(dir, "user");
    const cwd = join(dir, "project");
    if (!isolatedTests.has(t)) {
        isolatedTests.add(t);
        const previous = { ...process.env };
        // Only OS execution/locale variables survive. No inherited provider tokens or user paths.
        const keep = new Set([
            "PATH",
            "TMPDIR",
            "LANG",
            "LC_ALL",
            "SystemRoot",
            "ComSpec",
            "PATHEXT",
        ]);
        for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key];
        t.after(() => {
            for (const key of Object.keys(process.env)) delete process.env[key];
            Object.assign(process.env, previous);
        });
    }
    process.env.HOME = dir;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_OFFLINE = "1";
    process.env.JITI_FS_CACHE = "false";
    const { mkdir } = await import("node:fs/promises");
    await mkdir(cwd, { recursive: true });
    const config = await cfg.loadConfiguration(agentDir, cwd, false);
    const models = [model(), model("other", "family/model"), model("openai", "old")];
    const ctx = {
        cwd,
        model: models[2],
        thinkingLevel: "low",
        hasUI: opts.hasUI ?? false,
        mode: opts.mode ?? "print",
        isIdle: () => true,
        isProjectTrusted: () => false,
        ui: { notify() {}, setStatus() {}, confirm: async () => false },
        sessionManager: { getSessionId: () => "fake-parent", getBranch: () => [] },
        modelRegistry: {
            find: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
            getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "fake" }),
            streamSimple: opts.stream ?? ((m) => stream(m, [call("agent_report", report())])),
        },
    };
    return { dir, agentDir, cwd, config, models, ctx };
}

export async function harness(t, opts = {}) {
    const env = await environment(t, opts);
    const { ctx } = env;
    const hooks = new Map();
    const tools = new Map();
    const entries = [];
    const messages = [];
    const commands = new Map();
    const renderers = new Map();
    const widgets = new Map();
    const widgetEvents = [];
    const widgetFrames = [];
    const theme = opts.theme ?? { fg: (_token, text) => text };

    const captureWidgets = () => {
        widgetFrames.push([...widgets.values()].flatMap((c) => c.render(240)));
    };

    ctx.ui.setWidget = (key, content, options) => {
        widgets.get(key)?.dispose?.();
        widgets.delete(key);
        widgetEvents.push({ key, content, options });
        if (typeof content === "function") {
            widgets.set(key, content({ requestRender: captureWidgets }, theme));
        }
        captureWidgets();
    };
    t.after(async () => {
        await emit("session_shutdown", { reason: "exit" });
    });
    const selections = [];
    let active = [];
    let counter = 0;

    const emit = async (name, event) => {
        const results = [];
        for (const handler of hooks.get(name) ?? []) results.push(await handler(event, ctx));
        return results;
    };

    const pi = {
        on(name, fn) {
            const handlers = hooks.get(name) ?? [];
            handlers.push(fn);
            hooks.set(name, handlers);
        },
        registerTool(t) {
            tools.set(t.name, t);
            if (
                t.defaultActive !== false
                && ["direct", "model-only"].includes(t.exposure ?? "direct")
                && !active.includes(t.name)
            ) active.push(t.name);
        },
        registerCommand(name, c) {
            commands.set(name, c);
        },
        registerMessageRenderer(type, renderer) {
            renderers.set(type, renderer);
        },
        getAllTools: () =>
            [...tools.values()].map((t) => ({
                ...t,
                exposure: t.exposure ?? "direct",
                sourceInfo: { source: "test" },
            })),
        getActiveTools: () => [...active],
        setActiveTools(names) {
            active = [...names];
        },
        appendEntry(customType, data) {
            entries.push({ type: "custom", customType, data: structuredClone(data) });
        },
        sendMessage(m) {
            messages.push(m);
        },
        getThinkingLevel: () => ctx.thinkingLevel,
        setThinkingLevel(level) {
            const previousLevel = ctx.thinkingLevel;
            ctx.thinkingLevel = level;
            void emit("thinking_level_select", { level, previousLevel });
        },
        async setModel(m) {
            const previousModel = ctx.model;
            ctx.model = m;
            selections.push(m);
            await emit("model_select", { model: m, previousModel, source: "set" });
            return true;
        },
    };
    ctx.sessionManager.getBranch = () => entries;
    Object.defineProperty(ctx, "tools", {
        get() {
            return [...tools.values()].filter((t) =>
                t.exposure === "codemode" || t.exposure === "deferred"
                || ((t.exposure ?? "direct") === "direct" && active.includes(t.name))
            );
        },
    });

    const execute = async (name, args = {}, signal, parentToolCallId, onUpdate) => {
        const t = tools.get(name);
        const id = `parent-${++counter}`;
        let reason;
        if (
            !t || (!active.includes(name) && !["codemode", "deferred"].includes(t?.exposure))
            || (parentToolCallId && t?.exposure === "model-only")
        ) reason = "Tool unavailable";
        if (!reason) {
            for (
                const result of await emit("tool_call", {
                    toolName: name,
                    toolCallId: id,
                    parentToolCallId,
                    input: args,
                })
            ) if (result?.block) reason = result.reason;
        }
        let result;
        let isError = !!reason;
        if (reason) result = { content: text(reason), details: undefined };
        else {
            await emit("tool_execution_start", {
                toolName: name,
                toolCallId: id,
                parentToolCallId,
                args,
            });
            try {
                result = await t.execute(id, args, signal, onUpdate, ctx);
                isError = !!result.isError;
            } catch (error) {
                result = { content: text(String(error)), details: undefined };
                isError = true;
            }
        }
        const event = {
            toolName: name,
            toolCallId: id,
            parentToolCallId,
            input: args,
            ...result,
            isError,
        };
        for (const handler of hooks.get("tool_result") ?? []) {
            Object.assign(event, await handler(event, ctx));
        }
        result = {
            ...result,
            content: event.content,
            details: event.details,
            structuredContent: event.structuredContent,
            isError: event.isError,
        };
        await emit("tool_execution_end", {
            toolName: name,
            toolCallId: id,
            parentToolCallId,
            result,
            isError: event.isError,
        });
        return {
            toolCall: { id, type: "toolCall", name, arguments: args },
            result,
            isError: event.isError,
        };
    };

    ctx.executeTool = (name, args, options) =>
        execute(name, args, options?.signal, "outer", options?.onUpdate);
    for (const t of opts.tools ?? [tool("read"), tool("edit"), tool("write"), tool("bash")]) {
        pi.registerTool(t);
    }
    extension(pi);
    await emit("session_start", { reason: "startup" });
    return {
        ...env,
        ctx,
        hooks,
        pi,
        tools,
        commands,
        entries,
        messages,
        selections,
        renderers,
        widgets,
        widgetEvents,
        widgetFrames,
        emit,
        execute,
        command: (args) => commands.get("subagents").handler(args, ctx),
    };
}
