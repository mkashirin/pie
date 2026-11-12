import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jiti } from "./helpers.mjs";

const { default: planMode } = await jiti.import("../src/plan-mode.ts");
const { createModeContractMessage, latestModeContract } = await jiti.import(
    "../src/mode-contract.ts",
);
const { showPlanModeSettings } = await jiti.import("../src/settings-menu.ts");

const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
const source = { plan: "# Approved\n\nImplement safely.", source: "plan_mode_complete" };
const stateEntry = (data) => ({ type: "custom", customType: "plan-mode-state", data });
const builtin = (name) => ({ name, description: name, sourceInfo: { source: "builtin" } });
const baseline = { provider: "test", id: "baseline", name: "Baseline" };
const selected = { provider: "test", id: "selected", name: "Selected" };

function harness(t, configuration = {}) {
    const handlers = new Map();
    const commands = new Map();
    const tools = new Map();
    const notifications = [];
    const sent = [];
    const modelCalls = [];
    const thinkingCalls = [];
    let entries = configuration.entries ?? [];
    let activeTools = ["read", "bash", "write", "edit", "custom"];
    let thinking = "medium";
    let id = "session:1";
    let idle = true;
    let pending = false;
    let model = baseline;
    const menus = {};
    const ui = {
        showPlanLaunchMenu: async (_ctx, options) => {
            menus.launch = options;
        },
        showPlanModeMenu: async (_ctx, options) => {
            menus.current = options;
        },
        showReadyPlanMenu: async (_ctx, options) => {
            menus.ready = options;
        },
        showSavedPlanMenu: async (_ctx, options) => {
            menus.saved = options;
        },
        showActiveImplementationMenu: async (_ctx, options) => {
            menus.active = options;
        },
        showPlanModeSettings: async () => ({ kind: "closed", reason: "back" }),
        ...configuration.ui,
    };
    const pi = {
        events: configuration.events ?? new EventEmitter(),
        on(name, handler) {
            const list = handlers.get(name) ?? [];
            list.push(handler);
            handlers.set(name, list);
        },
        registerCommand: (name, definition) => commands.set(name, definition),
        registerTool: (definition) => tools.set(definition.name, definition),
        registerShortcut() {},
        registerMessageRenderer() {},
        getAllTools: () =>
            ["read", "bash", "write", "edit"].map(builtin).concat(
                { name: "custom", description: "Custom" },
                [...tools.values()].map((tool) => ({
                    ...tool,
                    sourceInfo: { source: "extension" },
                })),
            ),
        getActiveTools: () => [...activeTools],
        setActiveTools: (names) => {
            activeTools = [...names];
        },
        getThinkingLevel: () => thinking,
        setThinkingLevel: (value) => {
            thinkingCalls.push(value);
            if (configuration.failThinking === value) throw new Error("thinking rejected");
            thinking = value;
        },
        setModel: async (value) => {
            modelCalls.push(value.id);
            const accepted = configuration.setModel ? await configuration.setModel(value) : true;
            if (accepted) {
                model = value;
                thinking = "off";
            }
            return accepted;
        },
        appendEntry: (customType, data) =>
            entries.push({ type: "custom", customType, data: structuredClone(data) }),
        sendMessage: (message) =>
            entries.push({ type: "message", message: { role: "custom", ...message } }),
        sendUserMessage: (text, options) => {
            sent.push({ text, options });
        },
    };
    const manager = configuration.manager ?? {
        getSessionId: () => id,
        getSessionFile: () => `/sessions/${id}.jsonl`,
        getBranch: () => entries,
    };
    const ctx = {
        mode: configuration.mode ?? "rpc",
        hasUI: configuration.mode !== "print",
        cwd: process.cwd(),
        sessionManager: manager,
        get model() {
            return model;
        },
        modelRegistry: {
            getAvailable: () => [baseline, selected],
            find: (_provider, name) => [baseline, selected].find((value) => value.id === name),
        },
        isIdle: () => idle,
        hasPendingMessages: () => pending,
        waitForIdle: async () => {},
        newSession: configuration.newSession ?? (async () => ({ cancelled: true })),
        ui: {
            notify: (...args) => notifications.push(args),
            setStatus() {},
            setWidget() {},
            select: async () => undefined,
            input: async () => undefined,
        },
    };
    planMode(pi, {
        settingsPath: "/__pi_plan_runtime_test_missing__/pi-plan-mode.json",
        readSettings: configuration.readSettings ?? (async () =>
            configuration.settings
                ? { kind: "loaded", settings: configuration.settings }
                : { kind: "missing" }),
        loadInteractiveUi: configuration.loadInteractiveUi ?? (async () => ui),
    });
    const emit = async (name, event = {}, context = ctx) => {
        let result;
        for (const handler of handlers.get(name) ?? []) {
            result = await handler(event, context) ?? result;
        }
        return result;
    };
    const command = (text) => commands.get("plan").handler(text, ctx);
    const execute = (name, input, signal) =>
        tools.get(name).execute("call:1", input, signal, undefined, ctx);
    const state = () =>
        entries.findLast((entry) =>
            entry.type === "custom" && entry.customType === "plan-mode-state"
        )?.data;
    const replace = async (replacement = []) => {
        await emit("session_shutdown", { reason: "new" });
        entries = replacement;
        id = "session:2";
        await emit("session_start", { reason: "new" });
    };
    t.after(() => emit("session_shutdown", { reason: "quit" }));
    return {
        pi,
        ctx,
        command,
        emit,
        execute,
        state,
        menus,
        sent,
        notifications,
        modelCalls,
        thinkingCalls,
        replace,
        start: () => emit("session_start", { reason: "startup" }),
        setIdle: (value) => {
            idle = value;
        },
        setPending: (value) => {
            pending = value;
        },
        addMessage: (message) => entries.push({ type: "message", message }),
        get activeTools() {
            return activeTools;
        },
        get thinking() {
            return thinking;
        },
    };
}

test("actual calls enforce the locked policy, including nested calls and newly activated tools", async (t) => {
    const h = harness(t);
    await h.start();
    assert.ok((await h.emit("tool_call", { toolName: "plan_mode_question", input: {} })).block);
    await assert.rejects(h.execute("plan_mode_complete", { plan: "Not authorized" }), /not active/);
    await h.command("start");
    assert.ok(h.activeTools.includes("plan_mode_complete"));
    assert.ok(!h.activeTools.includes("write"));
    assert.equal(await h.emit("tool_call", { toolName: "read", input: {} }), undefined);
    h.pi.setActiveTools([...h.activeTools, "write", "custom"]);
    for (const toolName of ["write", "edit", "custom"]) {
        assert.ok(
            (await h.emit("tool_call", { toolName, parentToolCallId: "parent", input: {} })).block,
        );
    }
    assert.equal(
        await h.emit("tool_call", { toolName: "bash", input: { command: "git status" } }),
        undefined,
    );
    assert.ok(
        (await h.emit("tool_call", { toolName: "bash", input: { command: "git checkout main" } }))
            .block,
    );
    await h.command("exit");
    assert.ok(!h.activeTools.includes("plan_mode_complete"));
    assert.equal(await h.emit("tool_call", { toolName: "write", input: {} }), undefined);
});

test("a completed plan rejects late helper calls, can be saved, and blocks accidental replacement", async (t) => {
    const h = harness(t);
    await h.start();
    await h.command("start");
    const result = await h.execute("plan_mode_complete", { plan: source.plan });
    assert.equal(result.terminate, true);
    assert.equal(h.state().awaitingAction, true);
    await assert.rejects(h.execute("plan_mode_complete", { plan: "Late overwrite" }), /not active/);
    await h.command("save");
    assert.deepEqual(h.state().savedPlan, source);
    await h.command("Replace the saved plan");
    assert.deepEqual(h.state().savedPlan, source);
    assert.equal(h.sent.length, 0);
    await h.command("implement");
    assert.equal(h.state().enabled, false);
    assert.equal(h.state().savedPlan, undefined);
    assert.equal(h.state().activeImplementation.plan, source.plan);
    assert.equal(h.sent.at(-1).text, "Implement the plan.");
});

test("delayed launch loading and old menu callbacks cannot commit after replacement or plan completion", async (t) => {
    const loading = deferred();
    let captured;
    const h = harness(t, { loadInteractiveUi: () => loading.promise });
    await h.start();
    const opening = h.command("");
    await h.replace();
    loading.resolve({
        showPlanLaunchMenu: async (_ctx, options) => {
            captured = options;
        },
    });
    await opening;
    assert.equal(captured, undefined);
    const live = harness(t);
    await live.start();
    await live.command("");
    const launch = live.menus.launch;
    await live.replace();
    launch.start(launch.signal);
    assert.equal(live.state(), undefined);
    await live.command("start");
    await live.command("");
    const old = live.menus.current;
    await live.execute("plan_mode_complete", { plan: source.plan });
    old.exit();
    old.save();
    assert.equal(live.state().awaitingAction, true);
    assert.equal(live.state().savedPlan, undefined);
});

test("question cancellation and replacement reject late answers without replacing workflow state", async (t) => {
    const response = deferred();
    const h = harness(t);
    await h.start();
    await h.command("start");
    h.ctx.ui.select = () => response.promise;
    const controller = new AbortController();
    const question = {
        id: "scope",
        header: "Scope",
        question: "Which scope?",
        options: [{ label: "Small", description: "Focused" }, {
            label: "Large",
            description: "Broad",
        }],
    };
    const answering = h.execute("plan_mode_question", { questions: [question] }, controller.signal);
    controller.abort();
    response.resolve("1. Small");
    const result = await answering;
    assert.equal(result.details.cancelled, true);
    assert.equal(h.state().enabled, true);
    const second = deferred();
    h.ctx.ui.select = () => second.promise;
    const stale = h.execute("plan_mode_question", { questions: [question] });
    await h.replace([stateEntry({ enabled: false, awaitingAction: false, savedPlan: source })]);
    second.resolve("1. Small");
    assert.equal((await stale).details.reason, "plan_mode_inactive");
    assert.deepEqual(h.state().savedPlan, source);
});

test("latest normal contract blocks helper calls and context reconciliation never activates an idle workflow", async (t) => {
    const h = harness(t);
    await h.start();
    const idle = await h.emit("context", { messages: [createModeContractMessage("plan")] });
    assert.equal(latestModeContract(idle.messages).mode, "normal");
    await h.command("start");
    h.addMessage(createModeContractMessage("normal"));
    assert.ok(
        (await h.emit("tool_call", {
            toolName: "plan_mode_complete",
            input: { plan: source.plan },
        })).block,
    );
    await assert.rejects(h.execute("plan_mode_complete", { plan: source.plan }), /not active/);
});

test("unknown newer contract artifacts fail closed instead of resurrecting activation", async (t) => {
    const h = harness(t);
    await h.start();
    await h.command("start");
    h.addMessage({
        ...createModeContractMessage("plan"),
        details: { version: 2, mode: "plan" },
    });
    assert.ok(
        (await h.emit("tool_call", {
            toolName: "plan_mode_complete",
            input: { plan: source.plan },
        })).block,
    );
    await assert.rejects(h.execute("plan_mode_complete", { plan: source.plan }), /not active/);
    await h.command("exit");
    await h.command("start");
    assert.equal(
        await h.emit("tool_call", {
            toolName: "plan_mode_complete",
            input: { plan: source.plan },
        }),
        undefined,
    );
});

test("version-one persisted contract headers survive explanatory wording changes", async (t) => {
    const h = harness(t);
    await h.start();
    await h.command("start");
    h.addMessage({
        ...createModeContractMessage("normal"),
        content: "[PI PLAN MODE CONTRACT v1: NORMAL]\nEarlier explanation of normal mode.",
    });
    await assert.rejects(h.execute("plan_mode_complete", { plan: source.plan }), /not active/);
    assert.equal(
        latestModeContract([{
            ...createModeContractMessage("plan"),
            content: "[PI PLAN MODE CONTRACT v1: PLAN]\nEarlier explanation of planning mode.",
        }]).mode,
        "plan",
    );
    assert.equal(
        latestModeContract([{
            ...createModeContractMessage("normal"),
            content: "[PI PLAN MODE CONTRACT v1: PLAN]\nMismatched structured mode.",
        }]),
        undefined,
    );
});

test("runtime failure preserves saved plans and rolls back model-induced thinking changes", async (t) => {
    const h = harness(t, {
        entries: [stateEntry({ enabled: false, awaitingAction: false, savedPlan: source })],
        settings: {
            thinkingLevel: "inherit",
            defaultImplementationModel: { provider: "test", modelId: "selected" },
            defaultImplementationThinkingLevel: "high",
        },
        failThinking: "high",
    });
    await h.start();
    await h.command("implement");
    assert.deepEqual(h.modelCalls, ["selected", "baseline"]);
    assert.equal(h.thinking, "medium");
    assert.deepEqual(h.state().savedPlan, source);
    assert.equal(h.sent.length, 0);
});

test("session replacement during model selection never rolls back or sends into the replacement", async (t) => {
    const applying = deferred();
    const h = harness(t, {
        entries: [stateEntry({ enabled: false, awaitingAction: false, savedPlan: source })],
        settings: {
            thinkingLevel: "inherit",
            defaultImplementationModel: { provider: "test", modelId: "selected" },
        },
        setModel: (model) => model.id === "selected" ? applying.promise : true,
    });
    await h.start();
    const implementing = h.command("implement");
    await new Promise((done) => setImmediate(done));
    await h.replace();
    applying.resolve(true);
    await implementing;
    assert.deepEqual(h.modelCalls, ["selected"]);
    assert.equal(h.state(), undefined);
    assert.equal(h.sent.length, 0);
});

test("same-session cancellation during runtime selection restores the prior model without consuming the plan", async (t) => {
    const applying = deferred();
    const h = harness(t, {
        entries: [stateEntry({ enabled: false, awaitingAction: false, savedPlan: source })],
        settings: {
            thinkingLevel: "inherit",
            defaultImplementationModel: { provider: "test", modelId: "selected" },
        },
        setModel: (model) => model.id === "selected" ? applying.promise : true,
    });
    await h.start();
    const implementing = h.command("implement");
    await new Promise((done) => setImmediate(done));
    await h.emit("agent_settled", { aborted: true });
    applying.resolve(true);
    await implementing;
    assert.deepEqual(h.modelCalls, ["selected", "baseline"]);
    assert.equal(h.thinking, "medium");
    assert.deepEqual(h.state().savedPlan, source);
    assert.equal(h.sent.length, 0);
});

test("a rollback already awaiting model restoration cannot restore thinking or commit after replacement", async (t) => {
    const rollback = deferred();
    const rollbackStarted = deferred();
    const h = harness(t, {
        entries: [stateEntry({ enabled: false, awaitingAction: false, savedPlan: source })],
        settings: {
            thinkingLevel: "inherit",
            defaultImplementationModel: { provider: "test", modelId: "selected" },
            defaultImplementationThinkingLevel: "high",
        },
        failThinking: "high",
        setModel: (model) => {
            if (model.id === "baseline") {
                rollbackStarted.resolve();
                return rollback.promise;
            }
            return true;
        },
    });
    await h.start();
    const implementing = h.command("implement");
    await rollbackStarted.promise;
    await h.replace([stateEntry({ enabled: false, awaitingAction: false, savedPlan: source })]);
    const thinkingCallsAtReplacement = [...h.thinkingCalls];
    const notificationsAtReplacement = [...h.notifications];
    rollback.resolve(true);
    await implementing;
    assert.deepEqual(h.modelCalls, ["selected", "baseline"]);
    assert.deepEqual(h.thinkingCalls, thinkingCallsAtReplacement);
    assert.deepEqual(h.notifications, notificationsAtReplacement);
    assert.deepEqual(h.state().savedPlan, source);
    assert.equal(h.state().activeImplementation, undefined);
    assert.equal(h.sent.length, 0);
});

test("a delayed old restoration cannot publish settings or activate tools in its replacement", async (t) => {
    const oldRead = deferred();
    let reads = 0;
    const h = harness(t, {
        entries: [stateEntry({ enabled: true, awaitingAction: false })],
        readSettings: () =>
            ++reads === 1
                ? oldRead.promise
                : Promise.resolve({ kind: "loaded", settings: { thinkingLevel: "low" } }),
    });
    const starting = h.start();
    await h.replace();
    oldRead.resolve({ kind: "loaded", settings: { thinkingLevel: "high" } });
    await starting;
    assert.equal(h.state(), undefined);
    assert.ok(!h.activeTools.includes("plan_mode_complete"));
    assert.deepEqual(h.thinkingCalls, []);
    await h.command("start");
    assert.equal(h.thinking, "low");
});

test("implementation retention is applied at context/run boundaries, including aborted first runs", async (t) => {
    for (const retention of ["clear-on-start", "clear-after-first-run", "keep"]) {
        const h = harness(t, {
            settings: { thinkingLevel: "inherit", implementationPlanRetention: retention },
        });
        await h.start();
        await h.command("start");
        await h.execute("plan_mode_complete", { plan: source.plan });
        await h.command("implement");
        const context = await h.emit("context", {
            messages: [{ role: "user", content: "Implement" }],
        });
        assert.ok(JSON.stringify(context.messages).includes("Approved"));
        assert.equal(!!h.state().activeImplementation, retention !== "clear-on-start");
        await h.emit("agent_settled", { aborted: true });
        assert.equal(!!h.state().activeImplementation, retention === "keep");
    }
});

test("cancelled fresh-session admission retains the saved plan and queued input prevents admission", async (t) => {
    let admissions = 0;
    const h = harness(t, {
        entries: [stateEntry({ enabled: false, awaitingAction: false, savedPlan: source })],
        newSession: async () => {
            admissions++;
            return { cancelled: true };
        },
    });
    await h.start();
    await h.command("");
    const saved = h.menus.saved;
    await saved.implementFresh(saved.signal);
    assert.equal(admissions, 1);
    assert.deepEqual(h.state().savedPlan, source);
    h.setPending(true);
    await saved.implementFresh(saved.signal);
    assert.equal(admissions, 1);
    assert.equal(h.sent.length, 0);
});

test("ready-menu fresh handoff reenters a command and uses only the replacement context", async (t) => {
    let replacementPrompt;
    let transferred;
    const h = harness(t, {
        newSession: async (options) => {
            await options.setup({
                appendCustomEntry: (_type, data) => {
                    transferred = data;
                },
            });
            await h.emit("session_shutdown", { reason: "new" });
            await options.withSession({
                isIdle: () => true,
                hasPendingMessages: () => false,
                sendUserMessage: async (text) => {
                    replacementPrompt = text;
                },
            });
            return { cancelled: false };
        },
    });
    await h.start();
    await h.command("start");
    await h.execute("plan_mode_complete", { plan: source.plan });
    const eventCtx = { ...h.ctx };
    delete eventCtx.newSession;
    delete eventCtx.waitForIdle;
    await h.emit("agent_settled", { aborted: false }, eventCtx);
    await h.menus.ready.implementFresh({}, h.menus.ready.signal);
    await new Promise((done) => setTimeout(done, 10));
    assert.deepEqual(h.sent.at(-1), {
        text: "/plan _fresh",
        options: { expandPromptTemplates: true },
    });
    await h.command("_fresh");
    assert.match(replacementPrompt, /Approved/);
    assert.equal(transferred.activeImplementation.plan, source.plan);
    assert.deepEqual(transferred.pendingImplementationRuntime.model, {
        provider: "test",
        modelId: "baseline",
    });
    assert.equal(h.sent.filter(({ text }) => text !== "/plan _fresh").length, 0);
});

test("fresh replacement applies transferred model/thinking before delivery and only consumes its pending runtime", async (t) => {
    let delivered;
    let transferred;
    const h = harness(t, {
        entries: [stateEntry({ enabled: false, awaitingAction: false, savedPlan: source })],
        settings: {
            thinkingLevel: "inherit",
            defaultImplementationModel: { provider: "test", modelId: "selected" },
            defaultImplementationThinkingLevel: "high",
        },
        newSession: async (options) => {
            await options.setup({
                appendCustomEntry: (_type, data) => {
                    transferred = data;
                },
            });
            await h.replace([stateEntry(transferred)]);
            await options.withSession({
                isIdle: () => true,
                hasPendingMessages: () => false,
                sendUserMessage: async (text) => {
                    assert.equal(h.state().pendingImplementationRuntime, undefined);
                    assert.equal(h.thinking, "high");
                    delivered = text;
                },
            });
            return { cancelled: false };
        },
    });
    await h.start();
    await h.command("");
    await h.menus.saved.implementFresh(h.menus.saved.signal);
    assert.deepEqual(h.modelCalls, ["selected"]);
    assert.match(delivered, /Approved/);
    assert.equal(h.state().activeImplementation.plan, source.plan);
    assert.equal(h.state().savedPlan, undefined);
    assert.equal(h.sent.length, 0);
});

test("failed transferred runtime keeps its plan and blocks input until an explicit retry succeeds", async (t) => {
    let accepted = false;
    const h = harness(t, {
        entries: [stateEntry({
            enabled: false,
            awaitingAction: false,
            activeImplementation: {
                id: "fresh:1",
                ...source,
                startedAt: Date.now(),
                retention: "keep",
            },
            pendingImplementationRuntime: {
                version: 1,
                model: { provider: "test", modelId: "selected" },
                thinkingLevel: "high",
            },
        })],
        setModel: async () => accepted,
    });
    await h.start();
    assert.equal(h.state().pendingImplementationRuntime.version, 1);
    assert.equal((await h.emit("input", { text: "Implement" })).action, "handled");
    assert.equal(h.sent.length, 0);
    accepted = true;
    await h.command("implement");
    assert.equal(h.state().pendingImplementationRuntime, undefined);
    assert.equal(h.state().activeImplementation.plan, source.plan);
    assert.equal(h.thinking, "high");
    assert.equal(h.sent.at(-1).text, "Implement the plan.");
});

test("saved and active plans export without consumption and use the configured default destination", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "pi-plan-runtime-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const h = harness(t, {
        entries: [stateEntry({ enabled: false, awaitingAction: false, savedPlan: source })],
        settings: { thinkingLevel: "inherit", defaultPlanExportPath: "saved.md" },
    });
    h.ctx.cwd = directory;
    await h.start();
    await h.command("export");
    assert.equal(await readFile(join(directory, "saved.md"), "utf8"), source.plan + "\n");
    assert.deepEqual(h.state().savedPlan, source);
    await h.command("implement");
    const active = h.state().activeImplementation;
    await h.command("export active.md");
    assert.equal(await readFile(join(directory, "active.md"), "utf8"), source.plan + "\n");
    assert.deepEqual(h.state().activeImplementation, active);
    await h.command("export active.md");
    assert.equal(await readFile(join(directory, "active.md"), "utf8"), source.plan + "\n");
    assert.ok(h.notifications.some(([message]) => /exist/i.test(message)));
});

test("no-UI helpers report structured unavailability and planning thinking restores only if not manually overridden", async (t) => {
    const h = harness(t, { mode: "print", settings: { thinkingLevel: "high" } });
    await h.start();
    await h.command("start");
    assert.equal(h.thinking, "high");
    const result = await h.execute("plan_mode_question", {
        questions: [{
            id: "one",
            header: "One",
            question: "Choose?",
            options: [{ label: "A" }, { label: "B" }],
        }],
    });
    assert.equal(result.details.reason, "ui_unavailable");
    await h.command("exit");
    assert.equal(h.thinking, "medium");
    await h.command("start");
    h.pi.setThinkingLevel("low");
    await h.emit("thinking_level_select", { level: "low" });
    await h.command("exit");
    assert.equal(h.thinking, "low");
});

test("settings save honors lifecycle cancellation before publishing or notifying the runtime", async () => {
    const controller = new AbortController();
    const saved = [];
    const choices = ["Planning thinking", "high"];
    const ctx = {
        mode: "rpc",
        hasUI: true,
        modelRegistry: { getAvailable: () => [] },
        ui: {
            notify() {},
            select: async (_title, labels) => {
                const choice = choices.shift();
                return labels.find((label) => label === choice);
            },
        },
    };
    const result = await showPlanModeSettings(ctx, {
        tools: [],
        signal: controller.signal,
        isCurrent: () => !controller.signal.aborted,
        readSettings: async () => ({ kind: "loaded", settings: { thinkingLevel: "inherit" } }),
        updateSettings: async (_patch, options) => {
            controller.abort();
            await options.beforeRename();
            throw new Error("unreachable");
        },
        onSaved: (value) => saved.push(value),
    });
    assert.equal(result.kind, "stale");
    assert.deepEqual(saved, []);
});
