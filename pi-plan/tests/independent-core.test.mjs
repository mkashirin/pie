import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jiti } from "./helpers.mjs";

const policy = await jiti.import("../src/tool-policy.ts");
const settings = await jiti.import("../src/settings.ts");
const state = await jiti.import("../src/state.ts");
const completion = await jiti.import("../src/completion-tool.ts");
const contracts = await jiti.import("../src/mode-contract.ts");
const transforms = await jiti.import("../src/message-transform.ts");
const exports = await jiti.import("../src/plan-export.ts");
const fresh = await jiti.import("../src/fresh-implementation.ts");
const { createDeferredFreshHandoffCoordinator } = await jiti.import(
    "../src/fresh-handoff-coordinator.ts",
);
const { createImplementationRetentionCoordinator } = await jiti.import(
    "../src/implementation-retention.ts",
);
const { createFinalizationRequestCoordinator } = await jiti.import(
    "../src/finalization-request.ts",
);
const { WorkflowMutex } = await jiti.import("../src/workflow-mutex.ts");
const selection = await jiti.import("../src/tool-selection.ts");
const models = await jiti.import("../src/implementation-models.ts");

const blocked = (command, safe = {}) =>
    policy.findBlockedCommandSegment(command, safe, "/", "linux");
const psBlocked = (command, safe = {}) =>
    policy.findBlockedPowerShellCommandSegment(command, safe, "/");
const entry = (data) => ({ type: "custom", customType: "plan-mode-state", data });
const active = (id, retention = "clear-after-first-run") => ({
    id,
    retention,
    plan: `Plan ${id}`,
    source: "plan_mode_complete",
    startedAt: 1,
});
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
async function temporary(t) {
    const directory = await mkdtemp(join(tmpdir(), "pi-plan-independent-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

// These tests inspect the policy; they never execute the hostile shell text.
test("Git write/execute flags fail closed, including abbreviated and attached options", () => {
    for (
        const command of [
            "git diff --out=FILE",
            "git log --out FILE",
            "git show --o=FILE",
            "git diff --output=FILE",
            "git diff --ext",
            "git show --textc",
            "git log --exec=touch",
            "git diff --config=evil",
            "git diff --conf=evil",
            "git grep --open=sh",
            "git grep -Osh needle",
            "git grep -nOsh needle",
            "git grep -G --open=sh needle",
            "git grep -G --textconv needle",
            "git grep --ext-g=program needle",
            "git diff --src-prefix -- --out=FILE",
            "git log --grep -- --output=FILE",
            "git log --pretty -- --output=FILE",
            "git diff --no-no-textconv",
            "git -c alias.status=evil status",
            "git --exec-path=evil status",
            "git diff -G",
            "git diff -S",
            "git grep -e",
            "git diff -G needle --out=FILE",
            "git diff -Sneedle --textc",
            "git diff -G -S --out=FILE",
            "git diff --out=FILE -- harmless",
            "git branch new-branch",
            "git branch -D main",
            "git branch --delete main",
            "git branch --edit-desc",
            "git branch --set-up main",
            "git branch --move x",
            "git branch --list --del main",
            "git branch --list --cre=main",
            "git remote add origin evil",
            "git remote set-url origin evil",
            "git remote remove origin",
        ]
    ) assert.notEqual(blocked(command), undefined, command);
});

test("Git option operands and terminators remain literal rather than fake dangerous flags", () => {
    for (
        const command of [
            "git diff -G '--output=literal'",
            "git log -S '--exec=literal'",
            "git diff -G'$(literal)'",
            "git grep -e '--open-files-in-pager=literal'",
            "git diff -- '--output=filename'",
            "git grep -e needle -- '--open-files-in-pager'",
            "git branch --list 'feature/*'",
            "git branch --contains main",
            "git remote --verbose",
            "git diff --stat -- '--output=file'",
            "git grep -G -- '--open-files-in-pager'",
            "git log -S '--' -- '--output=file'",
            "git log -c",
        ]
    ) assert.equal(blocked(command), undefined, command);
});

test("trusted configured exceptions cannot expand into unparsed shell execution", () => {
    const safe = { git: ["checkout"], custom: ["inspect deep"], rm: ["approved"] };
    assert.equal(blocked("git checkout main", safe), undefined);
    assert.equal(blocked("custom inspect deep --output=chosen", safe), undefined);
    assert.equal(blocked("rm approved explicit-file", safe), undefined);
    assert.notEqual(blocked("custom inspect deeper", safe), undefined);
    for (const suffix of ["$(touch file)", "`touch file`", "> file", "*.txt", "${PATH}", "<(ls)"]) {
        assert.notEqual(blocked(`custom inspect deep ${suffix}`, safe), undefined, suffix);
    }
    assert.notEqual(blocked("custom inspect deep; rm other", safe), undefined);
    assert.notEqual(blocked("custom inspect deep && rm other", safe), undefined);
    assert.equal(blocked("custom inspect deep '$(literal) `literal` > literal'", safe), undefined);
    assert.notEqual(
        blocked("custom inspect deep", Object.create({ custom: ["inspect deep"] })),
        undefined,
    );
    assert.notEqual(blocked("custom inspect deep", { custom: ["inspect; rm"] }), undefined);
});

test("shell syntax fails closed without mistaking single-quoted data for expansion", () => {
    for (const command of ["echo '$() `literal` > file'", "echo 'a;b|c&d'", "echo hi | wc -c"]) {
        assert.equal(blocked(command), undefined, command);
    }
    for (
        const command of [
            "echo \"$(touch file)\"",
            "echo `touch file`",
            "echo hi > file",
            "echo hi & rm x",
            "echo hi ||",
            "echo 'unfinished",
            "echo foo\\;rm x",
            "cat *.txt",
            "echo {a,b}",
        ]
    ) assert.notEqual(blocked(command), undefined, command);
    assert.notEqual(policy.findBlockedCommandSegment("git status", {}, "/", "win32"), undefined);
});

test("other writable options and uniq's second operand cannot hide in flag forms", () => {
    for (
        const command of [
            "sort --out=FILE input",
            "sort -roFILE input",
            "sort --compress=program input",
            "sort --files0-from -- --output=FILE",
            "sort -k -- --output=FILE",
            "file -C",
            "file --comp",
            "uniq -- input -output",
            "uniq -f 1 input output",
            "rg --pre=program needle",
            "rg --hostname-b=program needle",
            "find . -delete",
        ]
    ) assert.notEqual(blocked(command), undefined, command);
    for (const command of ["sort -- --out=filename", "uniq -f 1 input", "uniq -- -filename"]) {
        assert.equal(blocked(command), undefined, command);
    }
});

test("PowerShell rejects invocation/expansion and honors trusted literal exception arguments", () => {
    for (
        const command of [
            "Get-Content -Path file",
            "Get-Process | Select-Object Name",
            "Write-Output '$literal'",
        ]
    ) {
        assert.equal(psBlocked(command), undefined, command);
    }
    for (
        const command of [
            "& evil",
            "Get-Content $(evil)",
            "Get-Content file > output",
            "Get-Help git -Online",
            "git diff --out=FILE",
            "git diff --% --output=FILE",
            "Write-Output \"$env:PATH\"",
        ]
    ) assert.notEqual(psBlocked(command), undefined, command);
    assert.equal(psBlocked("Custom inspect '-OutFile:chosen'", { custom: ["inspect"] }), undefined);
    assert.notEqual(psBlocked("Custom inspect $(evil)", { custom: ["inspect"] }), undefined);
    assert.notEqual(
        psBlocked("Custom inspect --% '%EXPANSION%'", { custom: ["inspect"] }),
        undefined,
    );
});

test("queued settings saves preserve unknown legacy data and clean up aborted publication", async (t) => {
    const directory = await temporary(t);
    const settingsPath = join(directory, settings.PLAN_MODE_SETTINGS_FILE);
    const legacy = {
        thinkingLevel: "inherit",
        future: { nested: [1, "untouched"] },
        safeSubcommands: { custom: ["inspect"] },
    };
    await writeFile(join(directory, "plan-mode.json"), JSON.stringify(legacy));
    const loaded = await settings.readPlanModeSettings(settingsPath);
    assert.equal(loaded.kind, "loaded");
    assert.match(loaded.notice, /legacy/u);
    const entered = deferred();
    const release = deferred();
    const controller = new AbortController();
    const cancelled = settings.updatePlanModeSettings({ thinkingLevel: "low" }, {
        settingsPath,
        signal: controller.signal,
        beforeRename: async () => {
            entered.resolve();
            await release.promise;
        },
    });
    // Attach the rejection observer before releasing the first queued operation.
    const observed = assert.rejects(cancelled, { name: "AbortError" });
    await entered.promise;
    const saved = settings.updatePlanModeSettings({ defaultPlanTools: ["read"] }, { settingsPath });
    let drained = false;
    const draining = settings.awaitPlanModeSettingsWrites(settingsPath).then(() => {
        drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    controller.abort();
    release.resolve();
    await observed;
    await saved;
    await draining;
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
        ...legacy,
        defaultPlanTools: ["read"],
    });
    assert.deepEqual((await readdir(directory)).sort(), ["pi-plan-mode.json", "plan-mode.json"]);
});

test("settings reject corrupt primary files rather than falling back or overwriting", async (t) => {
    const directory = await temporary(t);
    const settingsPath = join(directory, settings.PLAN_MODE_SETTINGS_FILE);
    await writeFile(settingsPath, "{broken");
    await writeFile(join(directory, "plan-mode.json"), JSON.stringify({ thinkingLevel: "high" }));
    assert.equal((await settings.readPlanModeSettings(settingsPath)).kind, "invalid");
    await assert.rejects(
        settings.updatePlanModeSettings({ thinkingLevel: "low" }, { settingsPath }),
    );
    assert.equal(await readFile(settingsPath, "utf8"), "{broken");
    const controller = new AbortController();
    controller.abort();
    const missing = join(directory, "absent", "settings.json");
    await assert.rejects(
        settings.updatePlanModeSettings({}, { settingsPath: missing, signal: controller.signal }),
        { name: "AbortError" },
    );
    await assert.rejects(readdir(join(directory, "absent")), { code: "ENOENT" });
});

test("settings null patches remove defaults without losing unrelated fields", async (t) => {
    const directory = await temporary(t);
    const settingsPath = join(directory, settings.PLAN_MODE_SETTINGS_FILE);
    await writeFile(
        settingsPath,
        JSON.stringify({
            thinkingLevel: "high",
            defaultPlanTools: ["read"],
            defaultImplementationModel: { provider: "p", modelId: "m" },
            future: true,
        }),
    );
    await settings.updatePlanModeSettings({
        defaultPlanTools: null,
        defaultImplementationModel: null,
    }, { settingsPath });
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
        thinkingLevel: "high",
        future: true,
    });
});

test("export is exclusive across concurrent attempts and refuses existing symlinks", async (t) => {
    const directory = await temporary(t);
    const results = await Promise.allSettled([
        exports.exportPlanToFile("First", "PLAN.md", directory),
        exports.exportPlanToFile("Second", "PLAN.md", directory),
    ]);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
    assert.equal(await readFile(join(directory, "PLAN.md"), "utf8"), "First\n");
    await symlink(join(directory, "PLAN.md"), join(directory, "link.md"));
    await assert.rejects(
        exports.exportPlanToFile("Unsafe", "link.md", directory),
        /already exists/u,
    );
    assert.equal(await readFile(join(directory, "PLAN.md"), "utf8"), "First\n");
});

test("export rolls back a newly created file when its lifecycle goes stale", async (t) => {
    const directory = await temporary(t);
    let checks = 0;
    await assert.rejects(
        exports.exportPlanToFile(
            "Do not publish",
            "cancel.md",
            directory,
            undefined,
            () => ++checks < 5,
        ),
        { name: "AbortError" },
    );
    await assert.rejects(readFile(join(directory, "cancel.md")), { code: "ENOENT" });
    assert.deepEqual(await readdir(directory), []);
});

test("restoration rejects malformed latest state and ignores failed completions", () => {
    const enabled = entry({ enabled: true });
    const result = {
        type: "message",
        message: {
            role: "toolResult",
            toolName: "plan_mode_complete",
            details: completion.planModeCompleted("Approved").details,
        },
    };
    assert.equal(
        state.restorePlanModeState([enabled, result], "plan-mode-state").awaitingAction,
        true,
    );
    assert.equal(
        state.restorePlanModeState([enabled, {
            ...result,
            message: { ...result.message, isError: true },
        }], "plan-mode-state").awaitingAction,
        false,
    );
    assert.deepEqual(
        state.restorePlanModeState([enabled, result, entry(null)], "plan-mode-state"),
        { enabled: false, awaitingAction: false },
    );
    const restored = state.restorePlanModeState([
        entry({ enabled: true, latestPlan: "Legacy", awaitingAction: true }),
    ], "plan-mode-state");
    assert.equal(restored.latestPlanSource, "legacy_proposed_plan");
    assert.equal(restored.awaitingAction, true);
    const invalid = state.restorePlanModeState([
        entry({
            enabled: true,
            workflowToolPolicy: { kind: "explicit", allowedNames: ["read", null], resolved: true },
        }),
    ], "plan-mode-state");
    assert.deepEqual(invalid.workflowToolPolicy.allowedNames, []);
});

test("newer invalid contracts cannot revive an older Plan activation", () => {
    const planning = contracts.createModeContractMessage("plan", 1);
    const forged = { ...planning, details: { version: 2, mode: "plan" } };
    assert.equal(contracts.latestModeContract([planning, forged]), undefined);
    assert.equal(contracts.modeContractFromMessage({ ...planning, role: "user" }), undefined);
    assert.equal(
        contracts.modeContractFromMessage({ ...planning, content: "modified" }),
        undefined,
    );
    const messages = contracts.reconcileModeContract([planning, forged], "normal");
    assert.equal(contracts.latestModeContract(messages).mode, "normal");
    assert.equal(contracts.reconcileModeContract(messages, "normal"), messages);
});

test("retention ignores stale settlements rather than resetting the replacement lifecycle", () => {
    const coordinator = createImplementationRetentionCoordinator();
    const first = active("old");
    const second = active("new");
    coordinator.restore(first);
    coordinator.restore(second);
    assert.equal(coordinator.implementationSettled(first), undefined);
    assert.equal(coordinator.implementationSettled(second), second.id);
    assert.equal(coordinator.implementationSettled(second), undefined);
    coordinator.reset();
    assert.equal(coordinator.implementationSettled(second), undefined);
});

test("retention supplies one clear-on-start context, preserving unrelated tool calls", () => {
    const coordinator = createImplementationRetentionCoordinator();
    const implementation = active("one", "clear-on-start");
    coordinator.restore(implementation);
    const messages = [{
        role: "assistant",
        content: [
            { type: "toolCall", name: "plan_mode_complete", id: "completion" },
            { type: "toolCall", name: "read", id: "read" },
        ],
    }, { role: "user", content: fresh.formatImplementationHandoff(implementation.plan) }];
    const workflow = {
        enabled: false,
        awaitingAction: false,
        activeImplementation: implementation,
    };
    const result = coordinator.transformContext(messages, workflow);
    assert.equal(result.clearActiveImplementationId, implementation.id);
    assert.equal(
        result.messages.filter(transforms.messageContainsPlanModeImplementationContextArtifact)
            .length,
        1,
    );
    assert.deepEqual(result.messages.find((message) => message.role === "assistant").content, [{
        type: "toolCall",
        name: "read",
        id: "read",
    }]);
    assert.equal(
        coordinator.transformContext(messages, workflow).clearActiveImplementationId,
        undefined,
    );
    assert.equal(messages[0].content.length, 2);
});

function freshFixture(overrides = {}) {
    const records = { entries: [], messages: [], notifications: [], sessions: 0 };
    let current = true;
    const replacement = {
        isIdle: () => true,
        hasPendingMessages: () => false,
        sendUserMessage: async (message) => {
            records.messages.push(message);
        },
    };
    const ctx = {
        ui: {
            notify: (...args) => {
                records.notifications.push(args);
            },
        },
        isIdle: () => true,
        hasPendingMessages: () => false,
        waitForIdle: async () => {},
        sessionManager: { getSessionFile: () => "parent.jsonl" },
        newSession: async (options) => {
            records.sessions++;
            assert.equal(options.parentSession, "parent.jsonl");
            await options.setup({
                appendCustomEntry: (...args) => {
                    records.entries.push(args);
                },
            });
            current = false; // session_shutdown invalidates old workflow ownership.
            await options.withSession(replacement);
            return { cancelled: false };
        },
        ...overrides,
    };
    const request = {
        plan: "Approved",
        source: "plan_mode_complete",
        retention: "keep",
        stateEntryType: "plan-mode-state",
        isCurrent: () => current,
    };
    return {
        records,
        ctx,
        request,
        replacement,
        invalidate: () => {
            current = false;
        },
    };
}

test("fresh handoff survives expected old-owner invalidation and transfers runtime state", async () => {
    const fixture = freshFixture();
    const runtime = { model: { provider: "provider", modelId: "model" }, thinkingLevel: "high" };
    const result = await fresh.startFreshImplementationSession(fixture.ctx, {
        ...fixture.request,
        runtime,
    });
    assert.deepEqual(result, { kind: "started" });
    assert.deepEqual(fixture.records.messages, [fresh.formatImplementationHandoff("Approved")]);
    const transferred = fixture.records.entries[0][1];
    assert.equal(transferred.enabled, false);
    assert.equal(transferred.activeImplementation.plan, "Approved");
    assert.deepEqual(transferred.pendingImplementationRuntime, { version: 1, ...runtime });
    assert.notEqual(transferred.pendingImplementationRuntime.model, runtime.model);
});

test("fresh handoff checks admission again after waiting and cancels stale setup", async () => {
    const waiting = deferred();
    const fixture = freshFixture({ waitForIdle: () => waiting.promise });
    const task = fresh.startFreshImplementationSession(fixture.ctx, fixture.request);
    fixture.invalidate();
    waiting.resolve();
    assert.deepEqual(await task, { kind: "stale" });
    assert.equal(fixture.records.sessions, 0);
    const setup = freshFixture();
    setup.ctx.newSession = async (options) => {
        setup.invalidate();
        await options.setup({
            appendCustomEntry: () => assert.fail("stale setup must not persist"),
        });
    };
    assert.deepEqual(await fresh.startFreshImplementationSession(setup.ctx, setup.request), {
        kind: "stale",
    });
});

test("fresh handoff snapshots mutable runtime data before waiting", async () => {
    const waiting = deferred();
    const fixture = freshFixture({ waitForIdle: () => waiting.promise });
    const runtime = { model: { provider: "original", modelId: "original" }, thinkingLevel: "high" };
    const task = fresh.startFreshImplementationSession(fixture.ctx, {
        ...fixture.request,
        runtime,
    });
    runtime.model.modelId = "changed";
    runtime.thinkingLevel = "low";
    waiting.resolve();
    assert.deepEqual(await task, { kind: "started" });
    assert.deepEqual(fixture.records.entries[0][1].pendingImplementationRuntime, {
        version: 1,
        model: { provider: "original", modelId: "original" },
        thinkingLevel: "high",
    });
});

test("fresh handoff refuses queued work, host cancellation and invalid runtime", async () => {
    for (const overrides of [{ hasPendingMessages: () => true }, { isIdle: () => false }]) {
        const fixture = freshFixture(overrides);
        assert.deepEqual(
            await fresh.startFreshImplementationSession(fixture.ctx, fixture.request),
            { kind: "rejected" },
        );
        assert.equal(fixture.records.sessions, 0);
    }
    const cancelled = freshFixture({ newSession: async () => ({ cancelled: true }) });
    assert.deepEqual(
        await fresh.startFreshImplementationSession(cancelled.ctx, cancelled.request),
        { kind: "cancelled" },
    );
    const invalid = freshFixture();
    assert.deepEqual(
        await fresh.startFreshImplementationSession(invalid.ctx, {
            ...invalid.request,
            runtime: { model: { provider: "bad\nprovider", modelId: "m" } },
        }),
        { kind: "rejected" },
    );
    assert.equal(invalid.records.sessions, 0);
});

test("fresh handoff never sends into a busy/aborted replacement and reports partial failures", async () => {
    for (
        const change of [
            { hasPendingMessages: () => true },
            { isIdle: () => false },
            { signal: AbortSignal.abort() },
            {
                sendUserMessage: async () => {
                    throw new Error("delivery failed");
                },
            },
        ]
    ) {
        const fixture = freshFixture();
        Object.assign(fixture.replacement, change);
        assert.deepEqual(
            await fresh.startFreshImplementationSession(fixture.ctx, fixture.request),
            { kind: "partial" },
        );
        assert.deepEqual(fixture.records.messages, []);
        assert.deepEqual(fixture.records.notifications, []);
    }
});

test("failure after fresh setup does not invoke stale old-session reporting APIs", async () => {
    const fixture = freshFixture();
    fixture.ctx.newSession = async (options) => {
        await options.setup({ appendCustomEntry: () => {} });
        fixture.invalidate();
        fixture.ctx.ui.notify = () => assert.fail("old context is stale");
        throw new Error("replacement session_start failed");
    };
    assert.deepEqual(await fresh.startFreshImplementationSession(fixture.ctx, fixture.request), {
        kind: "partial",
    });
});

test("deferred handoff cancellation invalidates scheduled and already-running callbacks", async () => {
    const callbacks = [];
    const cancelled = [];
    const coordinator = createDeferredFreshHandoffCoordinator({
        schedule: (callback) => {
            callbacks.push(callback);
            return callbacks.length;
        },
        cancel: (handle) => {
            cancelled.push(handle);
        },
    });
    let calls = 0;
    coordinator.schedule(async () => {
        calls++;
    }, () => assert.fail("stale error"));
    coordinator.cancel();
    callbacks[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 0);
    assert.deepEqual(cancelled, [1]);
    const entered = deferred();
    const release = deferred();
    coordinator.schedule(async (isCurrent) => {
        entered.resolve();
        await release.promise;
        assert.equal(isCurrent(), false);
        throw new Error("stale failure");
    }, () => assert.fail("cancelled task must not notify"));
    callbacks[1]();
    await entered.promise;
    coordinator.cancel();
    release.resolve();
    await new Promise((resolve) => setImmediate(resolve));
});

test("finalization settlement cannot act before run end or after reset", () => {
    const coordinator = createFinalizationRequestCoordinator();
    coordinator.request(1);
    assert.equal(coordinator.settle(1), undefined);
    coordinator.observeRunEnd(1, "normal");
    assert.equal(coordinator.settle(1), "retry");
    assert.equal(coordinator.settle(1), undefined);
    coordinator.request(2);
    coordinator.observeRunEnd(1, "normal");
    assert.equal(coordinator.settle(2), undefined);
    coordinator.observeRunEnd(2, "error");
    assert.equal(coordinator.hasPendingRequest(), false);
});

test("workflow mutex isolates sessions/groups and ignores stale unbind/release", () => {
    const events = new EventEmitter();
    const first = new WorkflowMutex({ events });
    const second = new WorkflowMutex({ events });
    const oldSession = {};
    const replacement = {};
    first.bindSession(oldSession);
    second.bindSession(oldSession);
    const oldOwner = first.acquire();
    assert.equal(second.acquire(), undefined);
    assert.ok(second.acquire("other-group"));
    first.bindSession(replacement);
    const owner = first.acquire();
    first.unbindSession(oldSession);
    first.release(oldOwner);
    assert.equal(first.isOwner(owner), true);
    assert.ok(second.acquire());
});

test("tool defaults honor explicit empty choices and never opt into third-party tools", () => {
    const builtin = { sourceInfo: { source: "builtin", scope: "builtin" } };
    const tools = [{ ...builtin, name: "read" }, { ...builtin, name: "write" }, { name: "remote" }];
    assert.deepEqual(selection.defaultPlanModeToolNames(tools, undefined), ["read"]);
    assert.deepEqual(selection.defaultPlanModeToolNames(tools, []), []);
    assert.deepEqual(selection.defaultPlanModeToolNames(tools, ["remote", "write", "missing"]), [
        "remote",
    ]);
    assert.deepEqual([
        ...selection.snapshotPlanModeSelectedNames(tools, {
            selectedToolNames: [],
            defaultPlanTools: ["read"],
        }),
    ], []);
});

test("implementation model snapshots respect scoped eligibility and do not alias registry data", () => {
    const available = [{ provider: "p", id: "one", name: "One" }, { provider: "p", id: "two" }];
    const snapshot = models.snapshotAvailableImplementationModels({
        modelRegistry: { getAvailable: () => available },
        scopedModels: [{ model: available[1] }],
    });
    assert.deepEqual(snapshot, [{ provider: "p", id: "two", name: undefined }]);
    snapshot[0].id = "changed";
    assert.equal(available[1].id, "two");
    assert.equal(
        models.findAvailableImplementationModel(available, { provider: "other", modelId: "one" }),
        undefined,
    );
});
