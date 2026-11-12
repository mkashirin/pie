import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { basename, dirname } from "node:path";
import {
    renderPlanCompletionCall,
    renderPlanMessage,
    renderPlanQuestionCall,
    renderPlanQuestionResult,
} from "./chat.ts";
import { completePlanArguments } from "./command.ts";
import {
    normalizePlanModeCompletion,
    PLAN_MODE_COMPLETE_PARAMS,
    PLAN_MODE_COMPLETE_TOOL_NAME,
    planModeCompleted,
    renderPlanModeCompletion,
} from "./completion-tool.ts";
import { isStaleExtensionContextError } from "./extension-runtime.ts";
import {
    createFinalizationRequestCoordinator,
    FINALIZE_PLAN_PROMPT,
    RETRY_FINALIZE_PLAN_PROMPT,
} from "./finalization-request.ts";
import { createDeferredFreshHandoffCoordinator } from "./fresh-handoff-coordinator.ts";
import {
    formatHistoryImplementationPrompt,
    startFreshImplementationFromState,
} from "./fresh-implementation.ts";
import {
    createImplementationRetentionCoordinator,
    implementationRetentionPreview,
} from "./implementation-retention.ts";
import {
    latestAssistantStopReason,
    latestAssistantText,
    parseProposedPlan,
} from "./message-transform.ts";
import {
    createModeContractMessage,
    hasModeContractArtifact,
    latestModeContract,
    reconcileModeContract,
} from "./mode-contract.ts";
import {
    createPlanActionController,
    type FreshImplementationTiming,
} from "./plan-action-controller.ts";
import { createPlanExportController } from "./plan-export-controller.ts";
import {
    clearPlanModeUi,
    planModeStatusText,
    showStoredPlan,
    updatePlanModeUi,
} from "./presentation.ts";
import { buildPlanModePrompt } from "./prompt.ts";
import {
    answerPlanModeQuestions,
    normalizePlanModeQuestionParams,
    PLAN_MODE_QUESTION_PARAMS,
    PLAN_MODE_QUESTION_TOOL_NAME,
    planModeQuestionCancelled,
} from "./question-tool.ts";
import {
    assertPlanModeHelperToolsAvailable,
    REQUIRED_PLAN_MODE_TOOL_NAMES,
} from "./required-tools.ts";
import {
    preflightSavedPlanImplementation,
    savedPlanBlocksNewWorkflow,
} from "./saved-plan-preflight.ts";
import {
    configuredImplementationModel,
    configuredImplementationPlanRetention,
    configuredImplementationThinkingLevel,
    configuredPlanModeToggleShortcut,
    configuredThinkingLevel,
    type PlanModeFixedThinkingLevel,
    type PlanModeSettings,
    type PlanModeSettingsPatch,
    planModeSettingsPath,
    readPlanModeSettings,
    updatePlanModeSettings,
    type UpdatePlanModeSettingsOptions,
} from "./settings.ts";
import {
    type ImplementationRuntimeSelection,
    type PlanModeState,
    restorePlanModeState,
} from "./state.ts";
import {
    canSelectToolInPlanMode,
    classifyPlanModeTool,
    findBlockedCommandSegment,
    findBlockedPowerShellCommandSegment,
    readCommand,
} from "./tool-policy.ts";
import { snapshotPlanModeSelectedNames, toolPolicyLabel } from "./tool-selection.ts";
import { WorkflowMutex, type WorkflowMutexOwner } from "./workflow-mutex.ts";

type InteractiveUi = typeof import("./interactive-ui.ts");
interface PlanModeDependencies {
    readSettings?(): ReturnType<typeof readPlanModeSettings>;
    updateSettings?(
        patch: PlanModeSettingsPatch,
        options?: UpdatePlanModeSettingsOptions,
    ): ReturnType<typeof updatePlanModeSettings>;
    settingsPath?: string;
    loadInteractiveUi?(): Promise<InteractiveUi>;
}
const STATE_ENTRY = "plan-mode-state";
const helper = (name: string) =>
    (REQUIRED_PLAN_MODE_TOOL_NAMES as readonly string[]).includes(name);

export default function planMode(pi: ExtensionAPI, dependencies: PlanModeDependencies = {}): void {
    let state: PlanModeState = { enabled: false, awaitingAction: false };
    let settings: PlanModeSettings = { thinkingLevel: "inherit" };
    let session: object | undefined;
    let sessionId: string | undefined;
    let epoch = 0;
    let generation = 0;
    let lifecycle = new AbortController();
    let owner: WorkflowMutexOwner | undefined;
    let previousTools: string[] | undefined;
    let effectiveContract: "plan" | "normal" = "normal";
    let reconciledNormalContract: string | undefined;
    let ownThinkingChange = false;
    let runtimePending = false;
    let latestModel: ExtensionContext["model"];
    let startupShortcut: PlanModeSettings["toggleShortcut"];
    let shortcutRegistered = false;
    let watcher: FSWatcher | undefined;
    let queuedFresh: { isCurrent(): boolean; runtime: ImplementationRuntimeSelection } | undefined;
    let settingsRead = 0;
    const mutex = new WorkflowMutex(pi);
    const retention = createImplementationRetentionCoordinator();
    const finalization = createFinalizationRequestCoordinator();
    const deferred = createDeferredFreshHandoffCoordinator();
    const loadInteractiveUi = dependencies.loadInteractiveUi
        ?? (() => import("./interactive-ui.ts"));
    const settingsPath = dependencies.settingsPath ?? planModeSettingsPath();
    const readSettings = dependencies.readSettings ?? (() => readPlanModeSettings(settingsPath));
    const updateSettings = dependencies.updateSettings ?? updatePlanModeSettings;
    const notify = (
        ctx: ExtensionContext,
        text: string,
        kind: "info" | "warning" | "error" = "info",
    ) => ctx.ui.notify(text, kind);
    const matchesSession = (ctx: ExtensionContext) =>
        !!session && ctx.sessionManager.getSessionId() === sessionId;
    const owned = () => !!session && mutex.isOwner(owner);
    const toolSummary = () =>
        `${
            state.workflowToolPolicy?.allowedNames.filter((name) => !helper(name)).length ?? 0
        } exploration tools`;
    const refresh = (ctx: ExtensionContext) => updatePlanModeUi(ctx, state, toolSummary);
    function invalidate(): void {
        generation++;
        lifecycle.abort();
        lifecycle = new AbortController();
        deferred.cancel();
        queuedFresh = undefined;
    }
    function captureLifecycle() {
        const captured = generation;
        const signal = lifecycle.signal;
        return { signal, isCurrent: () => !!session && captured === generation && !signal.aborted };
    }
    function commit(next: PlanModeState, ctx: ExtensionContext): void {
        pi.appendEntry(STATE_ENTRY, next);
        state = next;
        invalidate();
        refresh(ctx);
    }
    function setThinking(level: PlanModeFixedThinkingLevel): void {
        ownThinkingChange = true;
        try {
            pi.setThinkingLevel(level);
        } finally {
            ownThinkingChange = false;
        }
    }
    function restoreThinking(): void {
        if (
            state.previousThinkingLevel && state.appliedThinkingLevel
            && !state.manualThinkingLevel && pi.getThinkingLevel() === state.appliedThinkingLevel
        ) {
            setThinking(state.previousThinkingLevel);
        }
    }
    function restoreTools(): void {
        if (previousTools) {
            const available = new Set(pi.getAllTools().map((tool) => tool.name));
            pi.setActiveTools(previousTools.filter((name) => available.has(name) && !helper(name)));
        }
        previousTools = undefined;
    }
    function transitionNormal(): void {
        effectiveContract = "normal";
        const message = createModeContractMessage("normal");
        pi.sendMessage(message, { triggerTurn: false });
    }
    function finish(ctx: ExtensionContext, next: PlanModeState): void {
        restoreThinking();
        restoreTools();
        mutex.release(owner);
        owner = undefined;
        finalization.reset();
        transitionNormal();
        commit(next, ctx);
    }
    function clear(ctx: ExtensionContext): void {
        if (!matchesSession(ctx)) return;
        finish(ctx, {
            enabled: false,
            awaitingAction: false,
            selectedToolNames: state.selectedToolNames,
        });
        retention.reset();
    }
    function selectedTools() {
        return snapshotPlanModeSelectedNames(pi.getAllTools(), {
            ...state,
            defaultPlanTools: settings.defaultPlanTools,
        });
    }
    function start(ctx: ExtensionContext, names?: string[], prompt?: string): boolean {
        if (!matchesSession(ctx) || runtimePending) return false;
        if (state.enabled) {
            if (prompt && owned()) {
                pi.sendUserMessage(prompt, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
            }
            return owned();
        }
        if (savedPlanBlocksNewWorkflow(ctx, !!state.savedPlan)) return false;
        if (!ctx.isIdle() || ctx.hasPendingMessages()) {
            notify(
                ctx,
                "Wait for the agent and queued input before starting Plan Mode.",
                "warning",
            );
            return false;
        }
        const tools = pi.getAllTools();
        try {
            assertPlanModeHelperToolsAvailable(tools.map((tool) => tool.name));
        } catch (error) {
            notify(ctx, (error as Error).message, "error");
            return false;
        }
        const claim = mutex.acquire();
        if (!claim) {
            notify(ctx, "Another workflow owns this session.", "warning");
            return false;
        }
        const desired = names ? new Set(names) : selectedTools();
        const allowed = tools.filter((tool) =>
            desired.has(tool.name) && !helper(tool.name) && canSelectToolInPlanMode(tool)
        ).map((tool) => tool.name);
        const beforeTools = pi.getActiveTools();
        const beforeThinking = pi.getThinkingLevel();
        const requestedThinking = configuredThinkingLevel(settings);
        try {
            pi.setActiveTools([...allowed, ...REQUIRED_PLAN_MODE_TOOL_NAMES]);
            if (requestedThinking) setThinking(requestedThinking);
            owner = claim;
            previousTools = beforeTools;
            effectiveContract = "plan";
            pi.sendMessage(createModeContractMessage("plan"), { triggerTurn: false });
            commit({
                enabled: true,
                awaitingAction: false,
                selectedToolNames: names ? [...desired] : state.selectedToolNames,
                workflowToolPolicy: {
                    kind: names || state.selectedToolNames || settings.defaultPlanTools
                        ? "explicit"
                        : "automatic",
                    desiredNames: [...desired],
                    allowedNames: [...allowed, ...REQUIRED_PLAN_MODE_TOOL_NAMES],
                    resolved: true,
                },
                previousThinkingLevel: beforeThinking,
                appliedThinkingLevel: requestedThinking ? pi.getThinkingLevel() : undefined,
            }, ctx);
        } catch (error) {
            pi.setActiveTools(beforeTools);
            setThinking(beforeThinking);
            mutex.release(claim);
            owner = undefined;
            previousTools = undefined;
            effectiveContract = "normal";
            notify(ctx, `Could not start Plan Mode: ${(error as Error).message}`, "error");
            return false;
        }
        if (prompt) pi.sendUserMessage(prompt);
        return true;
    }
    function activeForTools(ctx: ExtensionContext): boolean {
        if (
            !matchesSession(ctx) || !state.enabled || state.awaitingAction || !owned()
            || effectiveContract !== "plan"
        ) return false;
        // Check persisted transitions too: visibility and an old PLAN artifact are not activation.
        const messages = ctx.sessionManager.getBranch().flatMap((entry) =>
            entry.type === "message" ? [entry.message] : []
        );
        const latest = latestModeContract(messages);
        if (!latest && hasModeContractArtifact(messages)) return false;
        return latest?.mode !== "normal"
            || `${latest.index}:${JSON.stringify(messages[latest.index])}`
                === reconciledNormalContract;
    }
    function completionIsAlone(ctx: ExtensionContext): boolean {
        const branch = ctx.sessionManager.getBranch();
        const assistant = branch.findLast((entry) =>
            entry.type === "message" && entry.message.role === "assistant"
        );
        if (!assistant || assistant.type !== "message" || assistant.message.role !== "assistant") {
            return true;
        }
        const calls = assistant.message.content.filter((part) => part.type === "toolCall");
        return calls.length === 1 && calls[0].name === PLAN_MODE_COMPLETE_TOOL_NAME;
    }
    function ready(
        plan: string,
        source: "plan_mode_complete" | "legacy_proposed_plan",
        ctx: ExtensionContext,
    ): void {
        finalization.satisfy();
        commit({ ...state, latestPlan: plan, latestPlanSource: source, awaitingAction: true }, ctx);
    }
    function finalize(ctx: ExtensionContext): void {
        if (!state.enabled || !owned() || state.awaitingAction) return;
        finalization.request(generation);
        pi.sendUserMessage(
            FINALIZE_PLAN_PROMPT,
            ctx.isIdle() ? undefined : { deliverAs: "followUp" },
        );
    }
    function save(ctx: ExtensionContext): void {
        if (
            !state.enabled || !state.awaitingAction || !state.latestPlan || !state.latestPlanSource
            || !owned()
        ) return;
        finish(ctx, {
            enabled: false,
            awaitingAction: false,
            savedPlan: { plan: state.latestPlan, source: state.latestPlanSource },
            selectedToolNames: state.selectedToolNames,
        });
    }
    function stay(ctx: ExtensionContext): void {
        if (!state.enabled || !owned()) return;
        commit({
            ...state,
            awaitingAction: false,
            latestPlan: undefined,
            latestPlanSource: undefined,
        }, ctx);
    }
    const exports = createPlanExportController({
        getState: () => state,
        getSettings: () => settings,
        finishReady: (ctx) =>
            finish(ctx, {
                enabled: false,
                awaitingAction: false,
                selectedToolNames: state.selectedToolNames,
            }),
    });
    async function showSettings(
        ctx: ExtensionContext,
        signal: AbortSignal,
        isCurrent: () => boolean,
    ): Promise<boolean> {
        if (!ctx.hasUI || !["tui", "rpc"].includes(ctx.mode) || signal.aborted || !isCurrent()) {
            return false;
        }
        const ui = await loadInteractiveUi();
        if (signal.aborted || !isCurrent()) return false;
        await ui.showPlanModeSettings(ctx, {
            tools: pi.getAllTools(),
            activeToolNames: pi.getActiveTools(),
            signal,
            isCurrent,
            settingsPath,
            startupToggleShortcut: startupShortcut,
            readSettings,
            updateSettings,
            onSaved: (saved) => {
                if (!signal.aborted && isCurrent()) {
                    settings = saved;
                    refresh(ctx);
                }
            },
        });
        return !signal.aborted && isCurrent();
    }
    const defaults = (): ImplementationRuntimeSelection => ({
        model: configuredImplementationModel(settings),
        thinkingLevel: configuredImplementationThinkingLevel(settings),
    });
    async function applyRuntime(
        ctx: ExtensionContext,
        runtime: ImplementationRuntimeSelection,
        isCurrent: () => boolean,
    ): Promise<boolean> {
        if (!isCurrent() || runtimePending) return false;
        const capturedEpoch = epoch;
        const beforeModel = latestModel ?? ctx.model;
        const beforeThinking = pi.getThinkingLevel();
        let changedModel = false;
        let changedThinking = false;
        runtimePending = true;
        try {
            if (runtime.model) {
                const available = ctx.scopedModels?.length
                    ? ctx.scopedModels.map((entry) => entry.model)
                    : ctx.modelRegistry.getAvailable();
                const model = available.find((candidate) =>
                    candidate.provider === runtime.model!.provider
                    && candidate.id === runtime.model!.modelId
                );
                if (!model) throw new Error("The selected implementation model is unavailable.");
                if (!isCurrent()) return false;
                // A model selection can clamp thinking even if the later commit fails.
                changedModel = true;
                const accepted = await pi.setModel(model);
                if (!accepted) {
                    changedModel = false;
                    throw new Error(
                        "The selected implementation model has no configured authentication.",
                    );
                }
                if (capturedEpoch !== epoch || !session) return false;
                latestModel = model;
            }
            if (!isCurrent()) {
                throw new DOMException("Implementation selection is stale", "AbortError");
            }
            const thinking = runtime.thinkingLevel ?? state.manualThinkingLevel
                ?? state.previousThinkingLevel;
            if (thinking) {
                setThinking(thinking);
                changedThinking = true;
            }
            if (!isCurrent()) {
                throw new DOMException("Implementation selection is stale", "AbortError");
            }
            return true;
        } catch (error) {
            // A replaced runtime owns its own model/thinking. Never roll back through an old API.
            if (capturedEpoch === epoch && session) {
                try {
                    if (changedModel && beforeModel) {
                        if (!(await pi.setModel(beforeModel))) {
                            throw new Error("Previous model could not be restored.");
                        }
                        if (capturedEpoch !== epoch || !session) return false;
                        latestModel = beforeModel;
                    }
                    if (capturedEpoch === epoch && session && (changedModel || changedThinking)) {
                        setThinking(beforeThinking);
                    }
                } catch (rollbackError) {
                    if (capturedEpoch === epoch && session) {
                        notify(
                            ctx,
                            `Implementation runtime rollback failed: ${
                                (rollbackError as Error).message
                            }`,
                            "error",
                        );
                    }
                }
                if (isCurrent() && (error as Error).name !== "AbortError") {
                    notify(
                        ctx,
                        `Could not select implementation runtime: ${(error as Error).message}`,
                        "error",
                    );
                }
            }
            return false;
        } finally {
            if (capturedEpoch === epoch) runtimePending = false;
        }
    }
    async function implementHere(ctx: ExtensionContext): Promise<void> {
        const life = captureLifecycle();
        const initial = state;
        const current = () => life.isCurrent() && state === initial && matchesSession(ctx);
        const chosen = state.awaitingAction && state.latestPlan && state.latestPlanSource
            ? { plan: state.latestPlan, source: state.latestPlanSource }
            : state.savedPlan
                ?? (state.pendingImplementationRuntime ? state.activeImplementation : undefined);
        if (!chosen || !current() || !(await preflightSavedPlanImplementation(ctx, current))) {
            return;
        }
        let claim = owner;
        if (!state.enabled) claim = mutex.acquire();
        if (!claim || !mutex.isOwner(claim)) {
            notify(ctx, "Another workflow owns this session.", "warning");
            return;
        }
        if (!(await applyRuntime(ctx, state.pendingImplementationRuntime ?? defaults(), current))) {
            if (claim !== owner) mutex.release(claim);
            return;
        }
        if (!current()) {
            if (claim !== owner) mutex.release(claim);
            return;
        }
        const activeImplementation = {
            id: `implementation:${randomUUID()}`,
            ...chosen,
            startedAt: Date.now(),
            retention: configuredImplementationPlanRetention(settings),
        };
        // Runtime has been accepted; only now consume the approved plan and release planning policy.
        restoreTools();
        mutex.release(claim);
        owner = undefined;
        finalization.reset();
        transitionNormal();
        retention.restore(activeImplementation);
        commit({
            enabled: false,
            awaitingAction: false,
            activeImplementation,
            selectedToolNames: state.selectedToolNames,
        }, ctx);
        pi.sendUserMessage(formatHistoryImplementationPrompt());
    }
    async function implementFresh(
        ctx: ExtensionContext,
        isCurrent: () => boolean,
        runtime: ImplementationRuntimeSelection | undefined,
        timing: FreshImplementationTiming,
    ): Promise<void> {
        const selection = runtime ?? defaults();
        const inheritedRuntime: ImplementationRuntimeSelection = {
            model: selection.model
                ?? (ctx.model
                    ? { provider: ctx.model.provider, modelId: ctx.model.id }
                    : undefined),
            thinkingLevel: selection.thinkingLevel ?? state.manualThinkingLevel
                ?? state.previousThinkingLevel ?? pi.getThinkingLevel(),
        };
        // Event contexts cannot replace a session. Reenter through a command only after all
        // settled handlers have finished, retaining the original menu's ownership predicate.
        if (!("newSession" in ctx) || !("waitForIdle" in ctx)) {
            queuedFresh = { isCurrent, runtime: inheritedRuntime };
            deferred.schedule(async (scheduledCurrent) => {
                if (scheduledCurrent() && isCurrent() && queuedFresh) {
                    pi.sendUserMessage("/plan _fresh", { expandPromptTemplates: true });
                }
            }, (error) => {
                if (isCurrent()) notify(ctx, String(error), "error");
            });
            return;
        }
        const run = async (scheduledCurrent: () => boolean) => {
            const current = () => scheduledCurrent() && isCurrent() && !!session;
            if (!current()) return;
            const claim = state.enabled ? owner : mutex.acquire();
            if (!claim || !mutex.isOwner(claim)) {
                notify(ctx, "Another workflow owns this session.", "warning");
                return;
            }
            let result;
            try {
                result = await startFreshImplementationFromState(ctx, {
                    getState: () => state,
                    menuIsCurrent: current,
                    retention: configuredImplementationPlanRetention(settings),
                    stateEntryType: STATE_ENTRY,
                    runtime: inheritedRuntime,
                });
            } finally {
                if (claim !== owner) mutex.release(claim);
            }
            if (current() && result.kind !== "started") {
                notify(
                    ctx,
                    `Fresh implementation ${result.kind}; the plan remains available.`,
                    "warning",
                );
            }
        };
        if (timing === "after-settled") {
            deferred.schedule(run, (error) => {
                if (isCurrent()) notify(ctx, String(error), "error");
            });
        } else await run(() => true);
    }
    const actions = createPlanActionController({
        loadInteractiveUi,
        getState: () => state,
        captureLifecycle,
        statusText: () => planModeStatusText(state, toolSummary),
        getThinkingLevel: () => pi.getThinkingLevel(),
        getSettings: () => settings,
        implementationOutcome: () =>
            implementationRetentionPreview(configuredImplementationPlanRetention(settings)),
        getExportDestination: exports.getDestination,
        show: (ctx) => showStoredPlan(pi, ctx, state),
        finalize,
        implementHere,
        implementFresh,
        exportPlan: (ctx, path, signal, isCurrent) => exports.export(path, ctx, signal, isCurrent),
        settings: showSettings,
        save,
        stay,
        exitReady: clear,
        clearSaved: clear,
    });
    async function menu(ctx: ExtensionContext, toolsOnly = false): Promise<void> {
        if (!ctx.hasUI || !["tui", "rpc"].includes(ctx.mode)) {
            notify(ctx, "Use /plan start or /plan <request> in non-interactive modes.", "warning");
            return;
        }
        if (state.enabled) {
            if (toolsOnly) {
                notify(
                    ctx,
                    "Planning tools are locked. Exit Plan Mode before choosing again.",
                    "warning",
                );
            } else await actions.showCurrent(ctx);
            return;
        }
        if (state.savedPlan) {
            await actions.showSaved(ctx);
            return;
        }
        const life = captureLifecycle();
        const ui = await loadInteractiveUi();
        if (!life.isCurrent()) return;
        if (state.activeImplementation) {
            await ui.showActiveImplementationMenu(ctx, {
                ...life,
                statusText: planModeStatusText(state, toolSummary),
                getExportDestination: () => exports.getDestination(ctx),
                show: () => {
                    if (life.isCurrent()) showStoredPlan(pi, ctx, state);
                },
                exportPlan: (path, signal) => exports.export(path, ctx, signal, life.isCurrent),
                settings: (signal) => showSettings(ctx, signal, life.isCurrent),
                startNew: () => {
                    if (life.isCurrent()) start(ctx);
                },
                clear: () => {
                    if (life.isCurrent()) clear(ctx);
                },
            });
            return;
        }
        const tools = pi.getAllTools().filter((tool) => !helper(tool.name));
        await ui.showPlanLaunchMenu(ctx, {
            ...life,
            statusText: "Explore first, then approve implementation.",
            toolSummary: (names) => `${names.size} selected tools`,
            getSelectedNames: selectedTools,
            tools: tools.map((tool) => ({
                name: tool.name,
                description: toolPolicyLabel(tool),
                searchText: `${tool.name} ${tool.description}`,
                disabled: !canSelectToolInPlanMode(tool),
            })),
            initialScreen: toolsOnly ? "tools" : "main",
            start: () => {
                if (life.isCurrent()) start(ctx);
            },
            startWithTools: (names) => {
                if (life.isCurrent()) start(ctx, names);
            },
            settings: (signal) => showSettings(ctx, signal, life.isCurrent),
        });
    }
    async function command(args: string, ctx: ExtensionContext): Promise<void> {
        if (!matchesSession(ctx)) return;
        const text = args.trim();
        const [action] = text.split(/\s/u);
        const life = captureLifecycle();
        try {
            switch (action) {
                case "":
                    await menu(ctx);
                    break;
                case "tools":
                    await menu(ctx, true);
                    break;
                case "start":
                    start(ctx);
                    break;
                case "off":
                case "exit":
                    clear(ctx);
                    break;
                case "show":
                    showStoredPlan(pi, ctx, state);
                    break;
                case "finalize":
                    finalize(ctx);
                    break;
                case "save":
                    save(ctx);
                    break;
                case "implement":
                    await implementHere(ctx);
                    break;
                case "_fresh": {
                    const request = queuedFresh;
                    queuedFresh = undefined;
                    if (request?.isCurrent()) {
                        await implementFresh(ctx, request.isCurrent, request.runtime, "immediate");
                    }
                    break;
                }
                case "export":
                    await exports.export(
                        text.length > 6 ? text.slice(6).trim() : undefined,
                        ctx,
                        life.signal,
                        life.isCurrent,
                    );
                    break;
                case "settings":
                    await showSettings(ctx, life.signal, life.isCurrent);
                    break;
                default:
                    start(ctx, undefined, text);
            }
        } catch (error) {
            if (
                life.isCurrent() && !isStaleExtensionContextError(error)
                && (error as Error).name !== "AbortError"
            ) notify(ctx, `Plan action failed: ${(error as Error).message}`, "error");
        }
    }
    async function reloadSettings(ctx: ExtensionContext): Promise<void> {
        const capturedEpoch = epoch;
        const request = ++settingsRead;
        try {
            const result = await readSettings();
            if (!session || capturedEpoch !== epoch || request !== settingsRead) return;
            if (result.kind === "loaded") settings = result.settings;
            else if (result.kind === "missing") settings = { thinkingLevel: "inherit" };
            else notify(ctx, `Invalid Plan settings: ${result.reason}`, "warning");
            if (result.notice) notify(ctx, result.notice, "warning");
            refresh(ctx);
        } catch (error) {
            if (session && capturedEpoch === epoch) {
                notify(ctx, `Could not read Plan settings: ${(error as Error).message}`, "warning");
            }
        }
    }
    async function restore(ctx: ExtensionContext): Promise<void> {
        invalidate();
        epoch++;
        watcher?.close();
        watcher = undefined;
        if (session) mutex.unbindSession(session);
        session = ctx.sessionManager;
        sessionId = ctx.sessionManager.getSessionId();
        mutex.bindSession(session);
        owner = undefined;
        runtimePending = false;
        latestModel = ctx.model;
        state = restorePlanModeState(ctx.sessionManager.getBranch(), STATE_ENTRY);
        retention.restore(state.activeImplementation);
        finalization.reset();
        const life = captureLifecycle();
        const restoringEpoch = epoch;
        await reloadSettings(ctx);
        if (!life.isCurrent()) return;
        if (!shortcutRegistered) {
            startupShortcut = configuredPlanModeToggleShortcut(settings);
            shortcutRegistered = true;
            if (startupShortcut) {
                pi.registerShortcut(startupShortcut, {
                    description: "Toggle Plan Mode",
                    handler: async (shortcutCtx) => {
                        if (state.enabled) clear(shortcutCtx);
                        else start(shortcutCtx);
                    },
                });
            }
        }
        if (state.enabled) {
            owner = mutex.acquire();
            if (!owner) {
                state = { ...state, enabled: false, awaitingAction: false };
                effectiveContract = "normal";
                notify(ctx, "Restored Plan Mode could not acquire workflow ownership.", "warning");
            } else {
                previousTools = pi.getActiveTools().filter((name) => !helper(name));
                const tools = pi.getAllTools();
                const desired = state.workflowToolPolicy?.allowedNames
                    ?? [...selectedTools(), ...REQUIRED_PLAN_MODE_TOOL_NAMES];
                const allowed = desired.filter((name) =>
                    tools.some((tool) =>
                        tool.name === name && (helper(name) || canSelectToolInPlanMode(tool))
                    )
                );
                state = {
                    ...state,
                    workflowToolPolicy: {
                        kind: state.workflowToolPolicy?.kind ?? "automatic",
                        desiredNames: state.workflowToolPolicy?.desiredNames,
                        allowedNames: allowed,
                        resolved: true,
                    },
                };
                pi.setActiveTools(allowed);
                effectiveContract = "plan";
                if (!state.manualThinkingLevel) {
                    const thinking = state.appliedThinkingLevel
                        ?? configuredThinkingLevel(settings);
                    if (thinking) setThinking(thinking);
                }
            }
        } else {
            effectiveContract = "normal";
            previousTools = undefined;
            pi.setActiveTools(pi.getActiveTools().filter((name) => !helper(name)));
        }
        if (state.pendingImplementationRuntime) {
            const pending = state.pendingImplementationRuntime;
            if (await applyRuntime(ctx, pending, life.isCurrent) && life.isCurrent()) {
                commit({ ...state, pendingImplementationRuntime: undefined }, ctx);
            }
        }
        if (!session || restoringEpoch !== epoch) return;
        refresh(ctx);
        // Watch the directory, not the replaced inode used by atomic settings saves.
        try {
            const capturedEpoch = epoch;
            watcher = watch(dirname(settingsPath), (_event, filename) => {
                if (
                    session && capturedEpoch === epoch
                    && (!filename || String(filename) === basename(settingsPath))
                ) void reloadSettings(ctx);
            });
            watcher.unref();
        } catch { /* A missing agent directory is valid; commands still reload settings. */ }
    }
    pi.registerCommand("plan", {
        description: "Plan before implementing",
        getArgumentCompletions: completePlanArguments,
        handler: command,
    });
    pi.registerMessageRenderer("plan-mode-plan", renderPlanMessage);
    pi.registerTool({
        name: PLAN_MODE_QUESTION_TOOL_NAME,
        label: "Plan questions",
        description: "Ask 1–3 structured questions only in explicitly active /plan workflows.",
        defaultActive: false,
        exposure: "model-only",
        executionMode: "sequential",
        parameters: PLAN_MODE_QUESTION_PARAMS,
        renderCall: renderPlanQuestionCall,
        renderResult: renderPlanQuestionResult,
        async execute(_id, input, signal, _update, ctx) {
            const normalized = normalizePlanModeQuestionParams(input);
            if (!normalized.ok) {
                return planModeQuestionCancelled([], "invalid_input", normalized.error);
            }
            const life = captureLifecycle();
            const current = () => life.isCurrent() && !signal?.aborted;
            return answerPlanModeQuestions(normalized.questions, {
                ...ctx,
                signal: signal ? AbortSignal.any([signal, life.signal]) : life.signal,
            }, {
                isCurrent: current,
                isEnabled: () => current() && activeForTools(ctx),
            });
        },
    });
    pi.registerTool({
        name: PLAN_MODE_COMPLETE_TOOL_NAME,
        label: "Complete plan",
        description:
            "Submit the complete Markdown plan for review. Active /plan only; call alone as the final action.",
        defaultActive: false,
        exposure: "model-only",
        executionMode: "sequential",
        parameters: PLAN_MODE_COMPLETE_PARAMS,
        renderCall: renderPlanCompletionCall,
        renderResult: renderPlanModeCompletion,
        async execute(_id, input, signal, _update, ctx) {
            if (signal?.aborted || !activeForTools(ctx)) {
                throw new Error("Plan Mode is not active under the current owned Plan contract.");
            }
            const normalized = normalizePlanModeCompletion(input);
            if (!normalized.ok) throw new Error(normalized.error);
            if (!completionIsAlone(ctx)) {
                throw new Error("Call plan_mode_complete alone as the final action.");
            }
            ready(normalized.plan, "plan_mode_complete", ctx);
            return planModeCompleted(normalized.plan);
        },
    });
    pi.on("session_start", async (_event, ctx) => restore(ctx));
    pi.on("session_tree", async (_event, ctx) => {
        restoreThinking();
        restoreTools();
        await restore(ctx);
    });
    pi.on("session_shutdown", (_event, ctx) => {
        invalidate();
        epoch++;
        watcher?.close();
        watcher = undefined;
        restoreThinking();
        restoreTools();
        mutex.release(owner);
        owner = undefined;
        if (session) mutex.unbindSession(session);
        session = undefined;
        sessionId = undefined;
        runtimePending = false;
        finalization.reset();
        retention.reset();
        clearPlanModeUi(ctx);
    });
    pi.on("tool_call", (event, ctx) => {
        if (helper(event.toolName)) {
            if (!activeForTools(ctx)) {
                return {
                    block: true,
                    reason: "Plan helpers require the current active owned Plan contract.",
                };
            }
            if (event.toolName === PLAN_MODE_COMPLETE_TOOL_NAME && !completionIsAlone(ctx)) {
                return {
                    block: true,
                    reason: "Call plan_mode_complete alone as the final action.",
                };
            }
            return;
        }
        if (!state.enabled || !matchesSession(ctx)) return;
        if (
            !owned() || !state.workflowToolPolicy?.resolved
            || !state.workflowToolPolicy.allowedNames.includes(event.toolName)
        ) return { block: true, reason: "Tool is outside this workflow's locked planning policy." };
        const tool = pi.getAllTools().find((candidate) => candidate.name === event.toolName);
        if (!tool || classifyPlanModeTool(tool) === "blocked") {
            return { block: true, reason: "This tool is blocked during planning." };
        }
        const policy = classifyPlanModeTool(tool);
        if (policy === "limited") {
            const command = readCommand(event.input);
            const blocked = event.toolName === "powershell"
                ? findBlockedPowerShellCommandSegment(command, settings.safeSubcommands, ctx.cwd)
                : findBlockedCommandSegment(command, settings.safeSubcommands, ctx.cwd);
            if (!command.trim() || blocked) {
                return {
                    block: true,
                    reason: `Planning shell policy blocked: ${blocked ?? "empty command"}`,
                };
            }
        }
    });
    pi.on("input", (_event, ctx) => {
        if (matchesSession(ctx) && state.pendingImplementationRuntime) {
            notify(
                ctx,
                "Implementation runtime selection is still pending. Use /plan implement to retry, or /plan exit to clear the handoff.",
                "warning",
            );
            return { action: "handled" };
        }
    });
    pi.on("before_agent_start", (event, ctx) => {
        if (matchesSession(ctx) && state.enabled && owned()) {
            return { systemPrompt: `${event.systemPrompt}\n\n${buildPlanModePrompt()}` };
        }
    });
    pi.on("context", (event, ctx) => {
        if (!matchesSession(ctx)) return;
        const expected = state.enabled && owned() ? "plan" : "normal";
        const result = retention.transformContext(event.messages, state);
        if (
            result.clearActiveImplementationId
            && state.activeImplementation?.id === result.clearActiveImplementationId
        ) commit({ ...state, activeImplementation: undefined }, ctx);
        const messages = reconcileModeContract(result.messages, expected);
        const branchMessages = ctx.sessionManager.getBranch().flatMap((entry) =>
            entry.type === "message" ? [entry.message] : []
        );
        const latest = latestModeContract(branchMessages);
        reconciledNormalContract = expected === "plan" && latest?.mode === "normal"
            ? `${latest.index}:${JSON.stringify(branchMessages[latest.index])}`
            : undefined;
        effectiveContract = expected;
        return { messages: messages as typeof event.messages };
    });
    pi.on("model_select", (event) => {
        latestModel = event.model;
    });
    pi.on("thinking_level_select", (event, ctx) => {
        if (matchesSession(ctx) && state.enabled && !ownThinkingChange) {
            commit({ ...state, manualThinkingLevel: event.level }, ctx);
        }
    });
    pi.on("agent_end", (event, ctx) => {
        if (!matchesSession(ctx) || !state.enabled || !owned()) return;
        const reason = latestAssistantStopReason(event.messages);
        finalization.observeRunEnd(
            generation,
            reason === "aborted" ? "cancelled" : reason === "error" ? "error" : "normal",
        );
        if (state.awaitingAction) return;
        const proposed = parseProposedPlan(latestAssistantText(event.messages));
        if (proposed.kind === "valid") ready(proposed.plan, "legacy_proposed_plan", ctx);
    });
    pi.on("agent_settled", async (event, ctx) => {
        if (!matchesSession(ctx)) return;
        if (event.aborted) {
            finalization.reset();
            invalidate();
            if (!state.enabled) {
                const clearId = retention.implementationSettled(state.activeImplementation);
                if (clearId && clearId === state.activeImplementation?.id) {
                    commit({ ...state, activeImplementation: undefined }, ctx);
                }
            }
            return;
        }
        if (state.enabled && owned()) {
            if (state.awaitingAction) {
                if (ctx.hasUI && ["tui", "rpc"].includes(ctx.mode)) await actions.showReady(ctx);
                else notify(ctx, "Plan ready. Use /plan implement, save, export, or exit.");
            } else {
                const action = finalization.settle(generation);
                if (action === "retry") pi.sendUserMessage(RETRY_FINALIZE_PLAN_PROMPT);
                else if (action === "failed") {
                    notify(
                        ctx,
                        "The agent did not complete a plan. Continue planning or retry /plan finalize.",
                        "warning",
                    );
                }
            }
        } else {
            const clearId = retention.implementationSettled(state.activeImplementation);
            if (clearId && clearId === state.activeImplementation?.id) {
                commit({ ...state, activeImplementation: undefined }, ctx);
            }
        }
    });
}
