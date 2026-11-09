import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
    defineTool,
    type ExtensionAPI,
    type ExtensionContext,
    type ExtensionToolContext,
    getAgentDir,
    type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { safeCallback } from "./src/callbacks.ts";
import { command } from "./src/commands.ts";
import {
    classifications,
    type Configuration,
    loadConfiguration,
    resolveAssignment,
    splitModel,
} from "./src/config.ts";
import { classify, Consent, type Identity, identity, policyDecision } from "./src/policy.ts";
import { AgentCards } from "./src/presentation.ts";
import {
    callable,
    checkMutationPaths,
    RunSchema,
    Runtime,
    type RuntimeHost,
} from "./src/runtime.ts";
import {
    addUsage,
    type Batch,
    capText,
    emptyUsage,
    EVIDENCE_ENTRY,
    initialState,
    Ledger,
    reportText,
    restore,
    RUN_ENTRY,
    STATE_ENTRY,
    webPacket,
} from "./src/state.ts";

import { compactText, FleetUI } from "./src/ui.ts";

export default function OpenAISubagents(pi: ExtensionAPI) {
    let config: Configuration | undefined;
    let mode = initialState();
    let ledger = new Ledger();
    const internalSelection = new AsyncLocalStorage<boolean>();
    const consent = new Consent();
    const webIds = new Map<string, string>();
    const executionArgs = new Map<string, unknown>();

    const requireConfig = () => {
        if (!config) {
            throw new Error(
                "Agent configuration is unavailable; correct diagnostics then /subagents reload",
            );
        }
        return config;
    };

    const persist = () => pi.appendEntry(STATE_ENTRY, structuredClone(mode));

    const refresh = () => pi.setActiveTools(pi.getActiveTools()); // rebuild declarations, never activate unavailable tools

    const indicator = (ctx: ExtensionContext) => {
        if (ctx.mode === "tui") {
            ctx.ui.setStatus(
                "pi-openai-subagents",
                mode.enabled ? "subagents: orchestrator" : undefined,
            );
        }
    };

    const foreground = (): Identity => ({
        agent: "orchestrator",
        runId: ledger.workflow,
        definition: requireConfig().definitions.get("orchestrator")!,
        writePaths: [],
    });

    const authorize = async (
        who: Identity,
        tool: ToolInfo,
        args: unknown,
        ctx: ExtensionContext,
        signal?: AbortSignal,
    ) => {
        if (signal?.aborted) return "Agent execution cancelled";
        const current = pi.getAllTools().find((t) => t.name === tool.name);
        if (!current) return `${tool.name} is no longer registered`;
        const child = who.runId.startsWith("run-");
        const available = callable(host, tool.name)
            || (!child && current.exposure === "model-only"
                && pi.getActiveTools().includes(tool.name));
        if (!available) {
            return `${tool.name} is not callable/active in the parent session; this extension never activates tools`;
        }
        const d = requireConfig().definitions.get(who.agent);
        if (!d) return `Agent ${who.agent} is no longer defined`;
        const decision = policyDecision(requireConfig(), mode.settings, d, current, child, args);
        if (decision.reason) return decision.reason;
        if (
            decision.capability === "unknown"
            && !await consent.approve(who.agent, current, args, ctx, signal)
        ) {
            return `${tool.name}: unknown side effects were not approved for ${who.agent}. Use /subagents classify ${tool.name} <capability> in trusted configuration, or interactive/RPC approval.`;
        }
        if (signal?.aborted) return "Agent execution cancelled";
        try {
            await checkMutationPaths(who, tool.name, args, ctx.cwd);
        } catch (error) {
            return String(error);
        }
        return undefined;
    };

    const host: RuntimeHost = {
        pi,
        config: requireConfig,
        settings: () => mode.settings,
        ledger: () => ledger,
        authorize: (who, tool, args, ctx, signal) => authorize(who, tool, args, ctx, signal),
    };
    const runtime = new Runtime(host);
    const fleet = new FleetUI();

    const reload = async (ctx: ExtensionContext) => {
        fleet.reset();
        const candidate = await loadConfiguration(getAgentDir(), ctx.cwd, ctx.isProjectTrusted());
        // Commit only fully parsed/validated configuration. A failed reload retains the previous configuration.
        config = candidate;
        consent.clear();
        refresh();
        indicator(ctx);
    };

    const apply = async (ctx: ExtensionContext, restoring = false) =>
        internalSelection.run(true, async () => {
            if (restoring) {
                if (!mode.previous) return;
                const restoreThinking = !mode.manualThinking
                    && pi.getThinkingLevel() === mode.applied?.thinking;
                if (
                    !mode.manualModel
                    && mode.applied?.model
                        === (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined)
                ) {
                    const [provider, id] = splitModel(mode.previous.model);
                    const model = ctx.modelRegistry.find(provider, id);
                    if (!model || !await pi.setModel(model)) {
                        throw new Error(
                            `Cannot restore ${mode.previous.model}; choose a model manually before disabling`,
                        );
                    }
                }
                if (restoreThinking) pi.setThinkingLevel(mode.previous.thinking as ThinkingLevel);
            } else {
                const assignment = await resolveAssignment(
                    requireConfig(),
                    mode.settings,
                    "orchestrator",
                    ctx,
                );
                if (!await pi.setModel(assignment.model)) {
                    throw new Error(
                        `Cannot select ${assignment.ref}; use /login ${assignment.model.provider}`,
                    );
                }
                pi.setThinkingLevel(assignment.thinking);
                mode.applied = { model: assignment.ref, thinking: pi.getThinkingLevel() };
                if (assignment.normalization && ctx.hasUI) {
                    ctx.ui.notify(assignment.normalization, "info");
                }
            }
            indicator(ctx);
        });

    const rebuild = async (ctx: ExtensionContext) => {
        fleet.reset();
        runtime.stop();
        consent.clear();
        webIds.clear();
        executionArgs.clear();
        const restored = restore(ctx.sessionManager.getBranch());
        mode = restored.mode;
        ledger = restored.ledger;
        await reload(ctx);
        indicator(ctx);
    };

    pi.on("session_start", async (_event, ctx) => {
        try {
            await rebuild(ctx);
        } catch (error) {
            ctx.ui.notify(`pi-openai-subagents: ${String(error)}`, "error");
        }
    });
    pi.on("session_tree", async (_event, ctx) => {
        await rebuild(ctx);
    });
    pi.on("session_shutdown", () => {
        fleet.reset();
        runtime.stop();
        consent.clear();
        webIds.clear();
        executionArgs.clear();
    });
    pi.on("model_select", (event, ctx) => {
        if (!mode.enabled || internalSelection.getStore() || event.source === "restore") return;
        const entry = ((mode.settings.agents ??= {}).orchestrator ??= {});
        entry.model = `${event.model.provider}/${event.model.id}`;
        mode.manualModel = true;
        persist();
        indicator(ctx);
    });
    pi.on("thinking_level_select", (event) => {
        if (!mode.enabled || internalSelection.getStore()) return;
        ((mode.settings.agents ??= {}).orchestrator ??= {}).thinking = event.level;
        mode.manualThinking = true;
        persist();
    });
    pi.registerCommand("subagents", {
        description: "Orchestration, specialist models, definitions and tool policies",
        handler: async (args, ctx) => {
            try {
                if (args.trim() === "reload" && !config) {
                    if (!ctx.isIdle() || runtime.busy) {
                        throw new Error("Reload requires an idle session");
                    }
                    await reload(ctx);
                    return;
                }
                await command(
                    {
                        pi,
                        config: requireConfig,
                        setConfig: (next) => {
                            config = next;
                        },
                        mode: () => mode,
                        persist,
                        refresh,
                        clearConsent: () => consent.clear(),
                        reload,
                        busy: () => runtime.busy,
                        apply,
                    },
                    args,
                    ctx,
                );
                indicator(ctx);
            } catch (error) {
                pi.sendMessage({
                    customType: "pi-openai-subagents-info",
                    content: `Subagents: ${String(error)}`,
                    display: true,
                }, { triggerTurn: false });
            }
        },
    });
    pi.on("before_agent_start", (event) => {
        ledger.newWorkflow();
        if (!mode.enabled) return;
        const d = requireConfig().definitions.get("orchestrator")!;
        event.systemPromptOptions.sections.openai_subagents =
            `${d.core}\n${d.prompt}\n\nAvailable specialist definitions:\n${
                [...requireConfig().definitions.values()].filter((x) => x.name !== "orchestrator")
                    .map((x) => `${x.name} [${x.profile}]: ${x.description}`).join("\n")
            }\n\nKeep normal conversation and user steering. The extension enforces tool policies, not a scripted workflow. Use returned run/evidence IDs in inputs for relevant review and validation.`;
    });
    pi.on("tool_call", async (event, ctx) => {
        const who = identity.getStore() ?? (mode.enabled ? foreground() : undefined);
        if (!who) return;
        runtime.activity(who.runId, event.toolCallId, event.toolName, event.input, "pending");
        const info = pi.getAllTools().find((t) => t.name === event.toolName);
        if (!info) {
            runtime.activity(who.runId, event.toolCallId, event.toolName, event.input, "blocked");
            return { block: true, reason: `Unknown tool ${event.toolName}` };
        }
        const reason = await authorize(who, info, event.input, ctx, who.signal ?? ctx.signal);
        if (reason) {
            runtime.activity(who.runId, event.toolCallId, event.toolName, event.input, "blocked");
            return { block: true, reason };
        }
    });
    pi.on("tool_result", (event) => {
        if (!["openai_search", "web_action"].includes(event.toolName)) return;
        const who = identity.getStore();
        if (!who && !mode.enabled) return;
        const id = `evidence-${randomUUID()}`;
        webIds.set(event.toolCallId, id);
        return {
            content: [...event.content, {
                type: "text" as const,
                text:
                    `Evidence packet ID: ${id}. Retrieval is not proof or full-page inspection; preserve limitations.`,
            }],
            ...(event.structuredContent === undefined
                ? {}
                : { structuredContent: event.structuredContent }),
        };
    });
    pi.on("tool_execution_start", (event) => {
        const who = identity.getStore();
        if (who) {
            executionArgs.set(event.toolCallId, event.args);
            runtime.activity(who.runId, event.toolCallId, event.toolName, event.args, "running");
        }
    });
    pi.on("tool_execution_end", (event) => {
        const executed = executionArgs.has(event.toolCallId);
        const args = executionArgs.get(event.toolCallId);
        executionArgs.delete(event.toolCallId);
        const who = identity.getStore();
        const run = who ? ledger.runs.get(who.runId) : undefined;
        if (who) {
            runtime.activity(
                who.runId,
                event.toolCallId,
                event.toolName,
                args,
                event.isError ? (executed ? "failed" : "blocked") : "succeeded",
            );
        }
        if (who && run) {
            const info = pi.getAllTools().find((t) => t.name === event.toolName);
            const capability = info
                ? classify(info, classifications(requireConfig(), mode.settings), args)
                : "unknown";
            run.toolActivity.push({ tool: event.toolName, capability, isError: event.isError });
            if (run.profile === "worker") {
                if (capability === "write" && (executed || !event.isError)) ledger.mutation(run);
                if (executed && (capability === "execute" || capability === "unknown")) {
                    run.uncertainShell = true;
                    ledger.mutation(run);
                }
            }
        }
        if (
            !["openai_search", "web_action"].includes(event.toolName)
            || (!who && !mode.enabled)
        ) return;
        const packet = webPacket(
            who?.runId ?? ledger.workflow,
            event.toolName,
            event.result,
            event.isError,
        );
        packet.id = webIds.get(event.toolCallId) ?? packet.id;
        webIds.delete(event.toolCallId);
        ledger.evidence.set(packet.id, packet);
        if (run) run.evidence.push(packet);
        else pi.appendEntry(EVIDENCE_ENTRY, packet);
    });
    pi.on("agent_before_settle", (event) => {
        if (!mode.enabled || event.outcome !== "completed") return;
        const gaps = ledger.gaps();
        if (!gaps.length) return;
        const content = `Agent quality checks remain unresolved:\n${
            gaps.map((x) => `- ${x}`).join("\n")
        }\n${
            ledger.reminderUsed
                ? "No further automatic continuation will be requested. Do not claim clean review or grounded certainty; disclose these limitations."
                : "Perform relevant run-linked review/independent validation, repair, qualify, or explain the limitation. This is the only automatic reminder for this user workflow."
        }`;
        const continued = !ledger.reminderUsed;
        ledger.reminderUsed = true;
        return {
            entries: [{
                type: "custom_message" as const,
                customType: "pi-openai-subagents-warning",
                content,
                display: true,
                details: { gaps },
            }],
            continue: continued,
        };
    });
    const tool = defineTool({
        name: "subagents_run",
        label: "Subagents",
        exposure: "model-only",
        description:
            "Run isolated specialists with role policies. By default, children inherit active direct parent tools; task.tools replaces that set with an exact allowlist and can include callable deferred/codemode tools by name. One task is a single run; multiple tasks form a bounded parallel batch. Sequence calls yourself. Parallel workers need disjoint writePaths; supply prior run/evidence IDs in inputs for review/validation. No recursion, background work or tool activation.",
        promptSnippet:
            "subagents_run: delegate scoped specialist tasks with isolated model contexts.",
        parameters: RunSchema,
        outputSchema: Type.Object({ results: Type.Array(Type.Any()), partial: Type.Boolean() }),
        prepareLoadout(loadout) {
            if (!config) return;
            const descriptions: Record<string, string> = {};
            const original = loadout.registered.find((t) => t.name === "subagents_run")?.description
                ?? "Delegate specialist tasks.";
            descriptions.subagents_run = `${original}\nAvailable specialists:\n${
                [...config.definitions.values()].filter((d) => d.name !== "orchestrator").map((d) =>
                    `${d.name} [${d.profile}]: ${d.description}`
                ).join("\n")
            }`;
            if (!mode.enabled) return { descriptions };
            const d = config.definitions.get("orchestrator")!;
            const hiddenDeclarations: string[] = [];
            for (const t of loadout.declared) {
                const info = pi.getAllTools().find((x) => x.name === t.name);
                if (!info) continue;
                const decision = policyDecision(config, mode.settings, d, info, false);
                if (decision.reason) hiddenDeclarations.push(t.name);
                else if (decision.capability === "unknown") {
                    descriptions[t.name] =
                        `${t.description} Explicit user approval is required because side effects are unknown.`;
                }
            }
            return { hiddenDeclarations, descriptions };
        },
        async execute(id, args, signal, onUpdate, ctx: ExtensionToolContext) {
            const lease = fleet.begin(id, ctx);

            const cancel = () => lease.finish("cancelled");

            const publish = safeCallback("subagents_run partial onUpdate", onUpdate);
            signal?.addEventListener("abort", cancel, { once: true });
            try {
                if (signal?.aborted) cancel();
                const batch = await runtime.run(
                    args.tasks,
                    ctx,
                    signal,
                    (partial) => {
                        lease.update(partial);
                        publish({
                            content: [{
                                type: "text",
                                text: partial.results.map((r) =>
                                    `${r.agent} ${r.status} ${r.model} ${r.lastActivity ?? ""}`
                                ).join("\n"),
                            }],
                            details: partial,
                        });
                    },
                    lease.subscribeHeartbeat,
                );
                lease.update(batch);
                pi.appendEntry(RUN_ENTRY, batch.results);
                const usage = emptyUsage();
                batch.results.forEach((r) => addUsage(usage, r.usage));
                try {
                    return {
                        content: batch.results.map((r) => ({
                            type: "text" as const,
                            text: capText(reportText(r)).text,
                        })),
                        details: batch,
                        structuredContent: JSON.parse(JSON.stringify(batch)),
                        usage,
                        isError: batch.results.every((r) => r.status !== "complete"),
                    };
                } catch (error) {
                    throw new Error(`Agent result serialization failed: ${String(error)}`);
                }
            } finally {
                signal?.removeEventListener("abort", cancel);
                lease.finish();
            }
        },
        renderCall(args, theme) {
            return new Text(
                theme.fg(
                    "accent",
                    `Subagents: ${
                        Array.isArray(args?.tasks)
                            ? args.tasks.flatMap((t) =>
                                typeof t?.agent === "string" ? [compactText(t.agent)] : []
                            ).join(", ") || "..."
                            : "..."
                    }`,
                ),
                0,
                0,
            );
        },
        renderResult(result, { expanded }, theme) {
            const batch = result.details as Batch | undefined;
            if (!Array.isArray(batch?.results)) {
                return new Text(
                    compactText(
                        result.content.filter((p) => p.type === "text").map((p) => p.text).join(
                            "\n",
                        ),
                    ),
                    0,
                    0,
                );
            }
            return new AgentCards(batch.results, theme, expanded);
        },
    });
    pi.registerTool(tool);
    for (
        const type of [
            "pi-openai-subagents-info",
            "pi-openai-subagents-warning",
        ]
    ) {
        pi.registerMessageRenderer(
            type,
            (message, options) =>
                new Text(
                    typeof message.content === "string"
                        ? message.content
                        : JSON.stringify(message.content),
                    options?.outputPad ?? 1,
                    0,
                ),
        );
    }
}
