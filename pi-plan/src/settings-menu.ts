import type { ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu, type RunMenuResult } from "@pi-extensions/pi-kit";
import { snapshotAvailableImplementationModels } from "./implementation-models.ts";
import { implementationRetentionPreview } from "./implementation-retention.ts";
import {
    IMPLEMENTATION_PLAN_RETENTIONS,
    IMPLEMENTATION_THINKING_LEVELS,
    normalizeKeyId,
    PLAN_MODE_THINKING_LEVELS,
    type PlanModeSettings,
    type PlanModeSettingsLoadResult,
    type PlanModeSettingsPatch,
    readPlanModeSettings,
    updatePlanModeSettings,
    type UpdatePlanModeSettingsOptions,
} from "./settings.ts";
import { canSelectToolInPlanMode } from "./tool-policy.ts";
import { snapshotPlanModeSelectedNames, toolPolicyLabel } from "./tool-selection.ts";

export interface PlanModeSettingsMenuOptions {
    tools: readonly ToolInfo[];
    activeToolNames?: readonly string[];
    signal: AbortSignal;
    isCurrent(): boolean;
    settingsPath?: string;
    legacySettingsPath?: string;
    startupToggleShortcut?: PlanModeSettings["toggleShortcut"];
    readSettings?: (settingsPath?: string) => Promise<PlanModeSettingsLoadResult>;
    updateSettings?: (
        patch: PlanModeSettingsPatch,
        options?: UpdatePlanModeSettingsOptions,
    ) => Promise<PlanModeSettings>;
    onSaved(settings: PlanModeSettings): void;
}

export async function showPlanModeSettings(
    ctx: ExtensionContext,
    options: PlanModeSettingsMenuOptions,
): Promise<RunMenuResult> {
    const current = () => !options.signal.aborted && options.isCurrent();
    const stale = { kind: "stale" as const };
    if (!current()) return stale;
    const loaded = await (options.readSettings ?? readPlanModeSettings)(options.settingsPath);
    if (!current()) return stale;
    if (loaded.kind === "invalid") {
        ctx.ui.notify(
            `Plan settings are invalid: ${loaded.reason}. Repair the settings file before saving.`,
            "error",
        );
        return { kind: "closed", reason: "back" };
    }
    let settings: PlanModeSettings = loaded.kind === "loaded"
        ? loaded.settings
        : { thinkingLevel: "inherit" };
    if (loaded.notice) ctx.ui.notify(loaded.notice, "warning");
    const models = snapshotAvailableImplementationModels(ctx);
    const tools = [...options.tools].filter((tool) => !tool.name.startsWith("plan_mode_"));
    const selected = snapshotPlanModeSelectedNames(tools, {
        defaultPlanTools: settings.defaultPlanTools,
    });
    const save = async (patch: PlanModeSettingsPatch) => {
        if (!current()) return { kind: "rejected" as const };
        try {
            const saved = await (options.updateSettings ?? updatePlanModeSettings)(patch, {
                settingsPath: options.settingsPath,
                legacySettingsPath: options.legacySettingsPath,
                signal: options.signal,
                beforeRename: async () => {
                    if (!current()) throw new DOMException("Settings owner is stale", "AbortError");
                },
            });
            if (!current()) return { kind: "rejected" as const };
            settings = saved;
            options.onSaved(saved);
            return { kind: "back" as const };
        } catch (error) {
            if (current() && (error as Error).name !== "AbortError") {
                ctx.ui.notify(
                    `Could not save Plan settings: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    "error",
                );
            }
            return { kind: "rejected" as const };
        }
    };
    const choice = (
        title: string,
        action: string,
        values: readonly string[],
        inherit?: string,
    ) => ({
        kind: "choice" as const,
        title,
        action,
        items: [
            ...(inherit ? [{ id: "inherit", label: inherit }] : []),
            ...values.map((value) => ({ id: value, label: value })),
        ],
    });
    return runMenu(
        ctx,
        defineMenu({
            start: "main",
            screens: {
                main: () => ({
                    kind: "actions" as const,
                    title: "Plan mode settings",
                    lines: [
                        options.settingsPath ?? "Preferences are stored in pi-plan-mode.json.",
                        "Planning tools are locked during a workflow; defaults apply to the next plan.",
                        "Shortcut changes require /reload or restart.",
                    ],
                    items: [
                        {
                            id: "thinking",
                            label: "Planning thinking",
                            description: settings.thinkingLevel,
                            to: "thinking",
                        },
                        {
                            id: "tools",
                            label: "Default planning tools",
                            description: settings.defaultPlanTools?.join(", ")
                                ?? "Automatic read-only tools",
                            to: "tools",
                        },
                        {
                            id: "retention",
                            label: "Implementation plan retention",
                            description: settings.implementationPlanRetention
                                ?? "clear-after-first-run",
                            to: "retention",
                        },
                        {
                            id: "model",
                            label: "Implementation model",
                            description: settings.defaultImplementationModel
                                ? `${settings.defaultImplementationModel.provider}/${settings.defaultImplementationModel.modelId}`
                                : "Current model",
                            to: "models",
                        },
                        {
                            id: "implementationThinking",
                            label: "Implementation thinking",
                            description: settings.defaultImplementationThinkingLevel ?? "Inherit",
                            to: "implementationThinking",
                        },
                        {
                            id: "exportPath",
                            label: "Default export path",
                            description: settings.defaultPlanExportPath ?? "PLAN.md",
                            to: "exportPath",
                        },
                        {
                            id: "shortcut",
                            label: "Toggle shortcut",
                            description: `${settings.toggleShortcut ?? "None"} (runtime: ${
                                options.startupToggleShortcut ?? "None"
                            })`,
                            to: "shortcut",
                        },
                        { id: "policy", label: "Trusted shell policy exceptions", to: "policy" },
                    ],
                }),
                thinking: () => choice("Planning thinking", "thinking", PLAN_MODE_THINKING_LEVELS),
                implementationThinking: () =>
                    choice(
                        "Implementation thinking",
                        "implementationThinking",
                        IMPLEMENTATION_THINKING_LEVELS,
                        "Inherit current thinking",
                    ),
                retention: () => ({
                    kind: "choice" as const,
                    title: "Implementation retention",
                    action: "retention",
                    items: IMPLEMENTATION_PLAN_RETENTIONS.map((value) => ({
                        id: value,
                        label: value,
                        description: implementationRetentionPreview(value),
                    })),
                }),
                models: () => ({
                    kind: "choice" as const,
                    title: "Implementation model",
                    action: "model",
                    enableSearch: true,
                    items: [
                        { id: "inherit", label: "Current model" },
                        ...models.map((model, index) => ({
                            id: String(index),
                            label: model.name ?? model.id,
                            description: `${model.provider}/${model.id}`,
                        })),
                    ],
                }),
                tools: () => ({
                    kind: "multiSelect" as const,
                    title: "Default planning tools",
                    action: "tool",
                    enableSearch: true,
                    lines: [
                        "Selected custom tools may mutate data. Tool selection is not a sandbox.",
                    ],
                    items: tools.map((tool) => ({
                        id: tool.name,
                        label: tool.name,
                        description: toolPolicyLabel(tool),
                        selected: selected.has(tool.name),
                        disabled: !canSelectToolInPlanMode(tool),
                    })),
                    actions: [{ id: "save", label: "Save tool defaults", action: "tools" }, {
                        id: "automatic",
                        label: "Use automatic defaults",
                        action: "automatic",
                    }],
                }),
                exportPath: () => ({
                    kind: "input" as const,
                    title: "Default export path",
                    action: "exportPath",
                    initialValue: settings.defaultPlanExportPath ?? "PLAN.md",
                    lines: [
                        "Exports create a new Markdown file and never overwrite an existing file.",
                    ],
                }),
                shortcut: () => ({
                    kind: "input" as const,
                    title: "Toggle shortcut",
                    action: "shortcut",
                    initialValue: settings.toggleShortcut ?? "",
                    lines: [
                        "Enter a Pi key binding, or leave blank to disable. Takes effect after /reload.",
                    ],
                }),
                policy: () => ({
                    kind: "detail" as const,
                    title: "Trusted shell exceptions",
                    lines: [
                        "These exceptions are trusted configuration, not a sandbox. Edit safeSubcommands in pi-plan-mode.json to change them.",
                        ...Object.entries(settings.safeSubcommands ?? {}).map(([command, paths]) =>
                            `${command}: ${paths?.join(", ") ?? "none"}`
                        ),
                    ],
                }),
            },
            actions: {
                thinking: ({ itemId }) =>
                    PLAN_MODE_THINKING_LEVELS.includes(itemId as PlanModeSettings["thinkingLevel"])
                        ? save({ thinkingLevel: itemId as PlanModeSettings["thinkingLevel"] })
                        : { kind: "rejected" },
                implementationThinking: ({ itemId }) =>
                    itemId === "inherit"
                        ? save({ defaultImplementationThinkingLevel: null })
                        : IMPLEMENTATION_THINKING_LEVELS.includes(
                                itemId as typeof IMPLEMENTATION_THINKING_LEVELS[number],
                            )
                        ? save({
                            defaultImplementationThinkingLevel:
                                itemId as typeof IMPLEMENTATION_THINKING_LEVELS[number],
                        })
                        : { kind: "rejected" },
                retention: ({ itemId }) =>
                    IMPLEMENTATION_PLAN_RETENTIONS.includes(
                            itemId as typeof IMPLEMENTATION_PLAN_RETENTIONS[number],
                        )
                        ? save({
                            implementationPlanRetention:
                                itemId as typeof IMPLEMENTATION_PLAN_RETENTIONS[number],
                        })
                        : { kind: "rejected" },
                model: ({ itemId }) => {
                    const model = itemId === "inherit"
                        ? undefined
                        : models.find((_model, index) => String(index) === itemId);
                    return itemId === "inherit" || model
                        ? save({
                            defaultImplementationModel: model
                                ? { provider: model.provider, modelId: model.id }
                                : null,
                        })
                        : { kind: "rejected" };
                },
                tool: ({ itemId, selected: checked }) => {
                    if (
                        !current() || !itemId
                        || !tools.some((tool) =>
                            tool.name === itemId && canSelectToolInPlanMode(tool)
                        )
                    ) return { kind: "rejected" };
                    if (checked) selected.add(itemId);
                    else selected.delete(itemId);
                    return { kind: "stay" };
                },
                tools: () => save({ defaultPlanTools: [...selected] }),
                automatic: () => save({ defaultPlanTools: null }),
                exportPath: ({ value }) => {
                    if (value?.includes("\0")) return { kind: "rejected" };
                    return save({ defaultPlanExportPath: value?.trim() || null });
                },
                shortcut: ({ value }) => {
                    const key = value?.trim() ? normalizeKeyId(value.trim()) : undefined;
                    if (value?.trim() && !key) {
                        ctx.ui.notify("Invalid Pi shortcut.", "warning");
                        return { kind: "rejected" };
                    }
                    return save({ toggleShortcut: key ?? null });
                },
            },
        }),
        { getState: () => settings, signal: options.signal, isCurrent: current },
    );
}
