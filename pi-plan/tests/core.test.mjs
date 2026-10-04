import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { jiti } from "./helpers.mjs";

const completion = await jiti.import("../src/completion-tool.ts");
const contracts = await jiti.import("../src/mode-contract.ts");
const { restorePlanModeState } = await jiti.import("../src/state.ts");
const { parseProposedPlan } = await jiti.import("../src/message-transform.ts");
const policy = await jiti.import("../src/tool-policy.ts");
const settings = await jiti.import("../src/settings.ts");
const { exportPlanToFile } = await jiti.import("../src/plan-export.ts");
const { createFinalizationRequestCoordinator } = await jiti.import(
    "../src/finalization-request.ts",
);
const { createImplementationRetentionCoordinator } = await jiti.import(
    "../src/implementation-retention.ts",
);
const { WorkflowMutex } = await jiti.import("../src/workflow-mutex.ts");

const stateEntry = (data) => ({ type: "custom", customType: "plan-mode-state", data });

async function temporary(t, prefix) {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

test(
    "the discovery entry loads with the local Pi loader and "
        + "registers the original API",
    async () => {
        const { loadExtensions } = await import(
            new URL(
                "./core/extensions/loader.js",
                import.meta.resolve("@earendil-works/pi-coding-agent"),
            ).href
        );
        const entry = fileURLToPath(new URL("../index.ts", import.meta.url));
        const loaded = await loadExtensions(
            [entry],
            fileURLToPath(new URL("../", import.meta.url)),
        );
        assert.deepEqual(loaded.errors, []);
        assert.equal(loaded.extensions.length, 1);
        const extension = loaded.extensions[0];
        assert.deepEqual([...extension.commands.keys()], ["plan"]);
        assert.deepEqual([...extension.tools.keys()], ["plan_mode_question", "plan_mode_complete"]);
        for (
            const event of [
                "session_start",
                "session_shutdown",
                "tool_call",
                "context",
                "agent_settled",
            ]
        ) {
            assert.ok(extension.handlers.has(event), event);
        }
        const entryExports = await jiti.import("../index.ts");
        assert.deepEqual(Object.keys(entryExports).sort(), [
            "default",
            "renderPlanModeWidget",
            "sanitizePlanModeWidgetLine",
        ]);
    },
);

test("completion details and legacy proposed-plan parsing retain their persisted formats", () => {
    const completed = completion.planModeCompleted("Approved plan");
    assert.deepEqual(completed.details, {
        version: 1,
        source: "plan_mode_complete",
        plan: "Approved plan",
    });
    assert.equal(completed.terminate, true);
    assert.equal(completion.planFromCompletionDetails(completed.details), "Approved plan");
    assert.equal(
        completion.planFromCompletionDetails({ ...completed.details, version: 2 }),
        undefined,
    );
    assert.deepEqual(completion.normalizePlanModeCompletion({ plan: "  approved  " }), {
        ok: true,
        plan: "approved",
    });
    assert.equal(completion.normalizePlanModeCompletion({ plan: " " }).ok, false);
    assert.equal(completion.normalizePlanModeCompletion({ plan: "x".repeat(50_001) }).ok, false);
    assert.deepEqual(parseProposedPlan("<proposed_plan>\nlegacy plan\n</proposed_plan>"), {
        kind: "valid",
        plan: "legacy plan",
    });
    assert.equal(parseProposedPlan("<proposed_plan>\nunfinished").kind, "unclosed");
    assert.equal(parseProposedPlan("No plan here").kind, "absent");
});

test(
    "session restoration recovers completions and preserves "
        + "saved/fresh implementation state",
    () => {
        const restored = restorePlanModeState([
            stateEntry({
                enabled: true,
                selectedToolNames: ["read", "read"],
                previousThinkingLevel: "high",
            }),
            {
                type: "message",
                message: {
                    role: "toolResult",
                    toolName: "plan_mode_complete",
                    details: completion.planModeCompleted("Recovered plan").details,
                },
            },
        ], "plan-mode-state");
        assert.equal(restored.latestPlan, "Recovered plan");
        assert.equal(restored.latestPlanSource, "plan_mode_complete");
        assert.equal(restored.awaitingAction, true);
        assert.deepEqual(restored.selectedToolNames, ["read"]);
        assert.equal(restored.previousThinkingLevel, "high");
        const saved = { plan: "Saved plan", source: "legacy_proposed_plan" };
        assert.deepEqual(
            restorePlanModeState([stateEntry({ savedPlan: saved })], "plan-mode-state").savedPlan,
            saved,
        );
        const active = {
            id: "implementation:1",
            plan: "Fresh plan",
            source: "plan_mode_complete",
            startedAt: 10,
            retention: "clear-after-first-run",
        };
        const pending = {
            version: 1,
            model: { provider: "provider", modelId: "model" },
            thinkingLevel: "max",
        };
        const fresh = restorePlanModeState([stateEntry({
            enabled: false,
            activeImplementation: active,
            savedPlan: saved,
            pendingImplementationRuntime: pending,
        })], "plan-mode-state");
        assert.deepEqual(fresh.activeImplementation, active);
        assert.deepEqual(fresh.pendingImplementationRuntime, pending);
        assert.equal(fresh.savedPlan, undefined);
        const denied = restorePlanModeState([stateEntry({
            enabled: true,
            workflowToolPolicy: { kind: "unexpected" },
        })], "plan-mode-state");
        assert.deepEqual(denied.workflowToolPolicy, {
            kind: "automatic",
            allowedNames: [],
            resolved: true,
        });
    },
);

test("mode contracts remain compatible, idempotent and follow leading summaries", () => {
    const messages = [{ role: "system" }, { role: "compactionSummary" }, {
        role: "user",
        content: "Hello",
    }];
    const planning = contracts.reconcileModeContract(messages, "plan");
    assert.equal(planning[2].customType, "plan-mode-transition");
    assert.match(planning[2].content, /^\[PI PLAN MODE CONTRACT v1: PLAN\]/u);
    assert.equal(contracts.reconcileModeContract(planning, "plan"), planning);
    const normal = contracts.reconcileModeContract(planning, "normal");
    assert.deepEqual(contracts.latestModeContract(normal), { index: 3, mode: "normal" });
    assert.match(normal[3].content, /Plan Mode is no longer active/u);
});

test("the read-only shell and PowerShell policies still reject mutations and expansion", () => {
    for (const command of ["git status", "git diff --stat", "ls src", "rg needle src"]) {
        assert.equal(
            policy.findBlockedCommandSegment(command, {}, process.cwd()),
            undefined,
            command,
        );
    }
    for (
        const command of [
            "rm -rf src",
            "git checkout main",
            "echo unsafe > file",
            "cat $(touch file)",
        ]
    ) {
        assert.notEqual(
            policy.findBlockedCommandSegment(command, {}, process.cwd()),
            undefined,
            command,
        );
    }
    assert.equal(
        policy.findBlockedPowerShellCommandSegment("Get-Process", {}, process.cwd()),
        undefined,
    );
    assert.notEqual(
        policy.findBlockedPowerShellCommandSegment("Remove-Item file", {}, process.cwd()),
        undefined,
    );
    const sourceInfo = { scope: "builtin", source: "builtin" };
    assert.equal(policy.classifyPlanModeTool({ name: "read", sourceInfo }), "read-only");
    assert.equal(policy.classifyPlanModeTool({ name: "write", sourceInfo }), "blocked");
});

test("settings retain their filename, merge concurrent saves and publish atomically", async (t) => {
    const directory = await temporary(t, "pi-plan-settings-");
    const settingsPath = join(directory, settings.PLAN_MODE_SETTINGS_FILE);
    assert.equal(settings.PLAN_MODE_SETTINGS_FILE, "pi-plan-mode.json");
    await writeFile(
        settingsPath,
        JSON.stringify({ thinkingLevel: "inherit", unrelated: "preserved" }),
    );
    await Promise.all([
        settings.updatePlanModeSettings({ thinkingLevel: "high" }, { settingsPath }),
        settings.updatePlanModeSettings({ defaultPlanTools: ["read", "bash"] }, { settingsPath }),
    ]);
    const document = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(document, {
        thinkingLevel: "high",
        unrelated: "preserved",
        defaultPlanTools: ["read", "bash"],
    });
    const loaded = await settings.readPlanModeSettings(settingsPath);
    assert.equal(loaded.kind, "loaded");
    assert.equal(loaded.settings.thinkingLevel, "high");
    const before = await readFile(settingsPath, "utf8");
    const controller = new AbortController();
    await assert.rejects(
        settings.updatePlanModeSettings({ thinkingLevel: "low" }, {
            settingsPath,
            signal: controller.signal,
            beforeRename: () => controller.abort(),
        }),
        { name: "AbortError" },
    );
    assert.equal(await readFile(settingsPath, "utf8"), before);
});

test(
    "plan export preserves Markdown, refuses overwrite and "
        + "honors owner cancellation",
    async (t) => {
        const directory = await temporary(t, "pi-plan-export-");
        const result = await exportPlanToFile("# Approved plan", "@nested/PLAN.md", directory);
        assert.equal(await readFile(result.path, "utf8"), "# Approved plan\n");
        await assert.rejects(
            exportPlanToFile("Replacement", "nested/PLAN.md", directory),
            /already exists/u,
        );
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            exportPlanToFile("Cancelled", "cancelled.md", directory, controller.signal),
            {
                name: "AbortError",
            },
        );
        await assert.rejects(readFile(join(directory, "cancelled.md")), { code: "ENOENT" });
    },
);

test("finalization retries once, ignores stale runs and clears cancelled requests", () => {
    const coordinator = createFinalizationRequestCoordinator();
    coordinator.request(1);
    coordinator.observeRunEnd(2, "normal");
    assert.equal(coordinator.settle(2), undefined);
    coordinator.observeRunEnd(1, "normal");
    assert.equal(coordinator.settle(1), "retry");
    coordinator.observeRunEnd(1, "normal");
    assert.equal(coordinator.settle(1), "failed");
    coordinator.request(3);
    coordinator.observeRunEnd(3, "cancelled");
    assert.equal(coordinator.hasPendingRequest(), false);
});

test("restored implementation retention clears only at its original lifecycle boundary", () => {
    for (const retention of ["clear-on-start", "clear-after-first-run", "keep"]) {
        const active = {
            id: "impl:1",
            plan: "Approved",
            source: "plan_mode_complete",
            startedAt: 1,
            retention,
        };
        const coordinator = createImplementationRetentionCoordinator();
        coordinator.restore(active);
        const transformed = coordinator.transformContext([{ role: "user", content: "Implement" }], {
            enabled: false,
            awaitingAction: false,
            activeImplementation: active,
        });
        assert.equal(
            transformed.clearActiveImplementationId,
            retention === "clear-on-start" ? active.id : undefined,
        );
        assert.equal(
            coordinator.implementationSettled(active),
            retention === "clear-after-first-run" ? active.id : undefined,
        );
        assert.equal(coordinator.implementationSettled(active), undefined);
    }
});

test(
    "workflow ownership remains session-scoped and stale owners "
        + "cannot release a new claim",
    () => {
        const events = new EventEmitter();
        const first = new WorkflowMutex({ events });
        const second = new WorkflowMutex({ events });
        const session = {};
        first.bindSession(session);
        second.bindSession(session);
        const owner = first.acquire();
        assert.ok(owner);
        assert.equal(second.acquire(), undefined);
        first.bindSession(session);
        const replacement = first.acquire();
        first.release(owner);
        assert.equal(first.isOwner(replacement), true);
        first.release(replacement);
        assert.ok(second.acquire());
    },
);
