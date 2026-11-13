import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@pi-extensions/pi-kit";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
    type ImplementationModelOverride,
    isPendingImplementationModelIdentifier,
} from "./implementation-models.ts";
import type { SafeSubcommands } from "./tool-policy.ts";

export const PLAN_MODE_SETTINGS_FILE = "pi-plan-mode.json";
export const PLAN_MODE_THINKING_LEVELS = [
    "inherit",
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
] as const;
export const IMPLEMENTATION_THINKING_LEVELS = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
] as const;
export const IMPLEMENTATION_PLAN_RETENTIONS = [
    "clear-on-start",
    "clear-after-first-run",
    "keep",
] as const;
export const DEFAULT_PLAN_EXPORT_PATH = "PLAN.md";
export type PlanModeThinkingLevel = (typeof PLAN_MODE_THINKING_LEVELS)[number];
export type ImplementationPlanRetention = (typeof IMPLEMENTATION_PLAN_RETENTIONS)[number];
export type PlanModeFixedThinkingLevel = (typeof IMPLEMENTATION_THINKING_LEVELS)[number];

export interface PlanModeSettings {
    thinkingLevel: PlanModeThinkingLevel;
    defaultPlanTools?: string[];
    implementationPlanRetention?: ImplementationPlanRetention;
    defaultImplementationModel?: ImplementationModelOverride;
    defaultImplementationThinkingLevel?: PlanModeFixedThinkingLevel;
    defaultPlanExportPath?: string;
    safeSubcommands?: SafeSubcommands;
    toggleShortcut?: KeyId;
}
export interface PlanModeSettingsPatch {
    thinkingLevel?: PlanModeThinkingLevel;
    defaultPlanTools?: readonly string[] | null;
    implementationPlanRetention?: ImplementationPlanRetention;
    defaultImplementationModel?: ImplementationModelOverride | null;
    defaultImplementationThinkingLevel?: PlanModeFixedThinkingLevel | null;
    defaultPlanExportPath?: string | null;
    toggleShortcut?: KeyId | null;
}
export interface UpdatePlanModeSettingsOptions {
    settingsPath?: string;
    legacySettingsPath?: string;
    signal?: AbortSignal;
    beforeRename?: (temporaryPath: string, settingsPath: string) => Promise<void>;
}
export type PlanModeSettingsLoadResult =
    | { kind: "missing"; notice?: string }
    | { kind: "invalid"; reason: string; notice?: string }
    | { kind: "loaded"; settings: PlanModeSettings; notice?: string };

const MAX_DOCUMENT_BYTES = 1024 * 1024;
const writes = new Map<string, Promise<unknown>>();
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const member = <T extends string>(values: readonly T[], value: unknown): value is T =>
    typeof value === "string" && values.includes(value as T);

export function planModeSettingsPath(): string {
    return join(getAgentDir(), PLAN_MODE_SETTINGS_FILE);
}

export function normalizeKeyId(value: unknown): KeyId | undefined {
    if (typeof value !== "string" || value.length > 100) return undefined;
    const parts = value.toLowerCase().split("+");
    const key = parts.pop();
    const modifiers = new Set(parts);
    if (
        modifiers.size !== parts.length
        || parts.some((part) => !["ctrl", "alt", "shift", "super", "meta", "hyper"].includes(part))
    ) return undefined;
    if (
        !key
        || !/^(?:[a-z0-9]|f(?:[1-9]|1[0-9]|2[0-4])|escape|enter|tab|space|backspace|delete|insert|home|end|pageup|pagedown|up|down|left|right|[\[\]\\/.,;='`\-])$/u
            .test(key)
    ) {
        return undefined;
    }
    return [...parts, key].join("+") as KeyId;
}

export function normalizePlanModeSettings(value: unknown): PlanModeSettings | undefined {
    if (!record(value)) return undefined;
    const result: PlanModeSettings = { thinkingLevel: "inherit" };
    if (value.thinkingLevel !== undefined) {
        if (!member(PLAN_MODE_THINKING_LEVELS, value.thinkingLevel)) return undefined;
        result.thinkingLevel = value.thinkingLevel;
    }
    if (value.defaultPlanTools !== undefined) {
        if (
            !Array.isArray(value.defaultPlanTools) || value.defaultPlanTools.length > 10000
            || value.defaultPlanTools.some((name) =>
                typeof name !== "string" || !name.trim() || name.length > 1024
                || /[\x00-\x1f\x7f]/u.test(name)
            )
        ) return undefined;
        result.defaultPlanTools = [...new Set(value.defaultPlanTools as string[])];
    }
    if (value.implementationPlanRetention !== undefined) {
        if (!member(IMPLEMENTATION_PLAN_RETENTIONS, value.implementationPlanRetention)) {
            return undefined;
        }
        result.implementationPlanRetention = value.implementationPlanRetention;
    }
    if (value.defaultImplementationModel !== undefined) {
        const model = value.defaultImplementationModel;
        if (
            !record(model) || !isPendingImplementationModelIdentifier(model.provider)
            || !isPendingImplementationModelIdentifier(model.modelId)
        ) return undefined;
        result.defaultImplementationModel = { provider: model.provider, modelId: model.modelId };
    }
    if (value.defaultImplementationThinkingLevel !== undefined) {
        if (!member(IMPLEMENTATION_THINKING_LEVELS, value.defaultImplementationThinkingLevel)) {
            return undefined;
        }
        result.defaultImplementationThinkingLevel = value.defaultImplementationThinkingLevel;
    }
    if (value.defaultPlanExportPath !== undefined) {
        if (
            typeof value.defaultPlanExportPath !== "string" || !value.defaultPlanExportPath.trim()
            || value.defaultPlanExportPath.length > 4096
            || value.defaultPlanExportPath.includes("\0")
        ) return undefined;
        result.defaultPlanExportPath = value.defaultPlanExportPath.trim();
    }
    if (value.toggleShortcut !== undefined) {
        const key = normalizeKeyId(value.toggleShortcut);
        if (!key) return undefined;
        result.toggleShortcut = key;
    }
    if (value.safeSubcommands !== undefined) {
        if (!record(value.safeSubcommands)) return undefined;
        const safe: SafeSubcommands = Object.create(null);
        for (const [command, paths] of Object.entries(value.safeSubcommands)) {
            if (
                !/^[a-zA-Z0-9_-]+$/u.test(command) || !Array.isArray(paths)
                || paths.some((path) =>
                    typeof path !== "string" || !/^[a-zA-Z0-9_-]+(?: [a-zA-Z0-9_-]+)*$/u.test(path)
                )
            ) return undefined;
            safe[command] = [...new Set(paths as string[])];
        }
        result.safeSubcommands = safe;
    }
    return result;
}

async function documentAt(path: string): Promise<Record<string, unknown> | undefined> {
    try {
        if ((await stat(path)).size > MAX_DOCUMENT_BYTES) {
            throw new Error("Settings file is too large");
        }
        const text = await readFile(path, "utf8");
        if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) {
            throw new Error("Settings file is too large");
        }
        const value: unknown = JSON.parse(text);
        if (!record(value) || !normalizePlanModeSettings(value)) {
            throw new Error("Invalid Plan Mode settings document");
        }
        return value;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

export async function readPlanModeSettings(
    settingsPath = planModeSettingsPath(),
): Promise<PlanModeSettingsLoadResult> {
    try {
        let document = await documentAt(settingsPath);
        let notice: string | undefined;
        if (!document) {
            document = await documentAt(join(dirname(settingsPath), "plan-mode.json"));
            if (document) notice = "Using legacy plan-mode.json settings.";
        }
        return document
            ? { kind: "loaded", settings: normalizePlanModeSettings(document)!, notice }
            : { kind: "missing" };
    } catch (error) {
        return { kind: "invalid", reason: error instanceof Error ? error.message : String(error) };
    }
}

export function updatePlanModeSettings(
    patch: PlanModeSettingsPatch,
    options: UpdatePlanModeSettingsOptions = {},
): Promise<PlanModeSettings> {
    const path = resolve(options.settingsPath ?? planModeSettingsPath());
    // The local queue also makes awaitPlanModeSettingsWrites observe reads and pre-publication work.
    const operation = (writes.get(path) ?? Promise.resolve()).catch(() => {}).then(() =>
        withFileMutationQueue(path, async () => {
            options.signal?.throwIfAborted();
            const previous = await documentAt(path)
                ?? await documentAt(
                    options.legacySettingsPath ?? join(dirname(path), "plan-mode.json"),
                )
                ?? {};
            const next = { ...previous };
            const keys = [
                "thinkingLevel",
                "defaultPlanTools",
                "implementationPlanRetention",
                "defaultImplementationModel",
                "defaultImplementationThinkingLevel",
                "defaultPlanExportPath",
                "toggleShortcut",
            ] as const;
            for (const key of keys) {
                if (!Object.hasOwn(patch, key) || patch[key] === undefined) continue;
                if (patch[key] === null) delete next[key];
                else next[key] = patch[key];
            }
            const normalized = normalizePlanModeSettings(next);
            if (!normalized) throw new Error("Invalid Plan Mode settings update");
            const serialized = JSON.stringify(next, null, 4) + "\n";
            if (Buffer.byteLength(serialized) > MAX_DOCUMENT_BYTES) {
                throw new Error("Settings file is too large");
            }
            options.signal?.throwIfAborted();
            await mkdir(dirname(path), { recursive: true });
            const temporary = join(
                dirname(path),
                `.${PLAN_MODE_SETTINGS_FILE}.${randomUUID()}.tmp`,
            );
            try {
                const file = await open(temporary, "wx", 0o600);
                try {
                    await file.writeFile(serialized, "utf8");
                    await file.sync();
                } finally {
                    await file.close();
                }
                await options.beforeRename?.(temporary, path);
                options.signal?.throwIfAborted();
                await rename(temporary, path);
                return normalized;
            } finally {
                await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
                    if (error.code !== "ENOENT") throw error;
                });
            }
        })
    );
    writes.set(path, operation);
    void operation.finally(() => {
        if (writes.get(path) === operation) writes.delete(path);
    }).catch(() => {});
    return operation;
}

export async function awaitPlanModeSettingsWrites(
    settingsPath = planModeSettingsPath(),
): Promise<void> {
    await writes.get(resolve(settingsPath));
}
export function configuredThinkingLevel(
    settings: PlanModeSettings,
): PlanModeFixedThinkingLevel | undefined {
    return settings.thinkingLevel === "inherit" ? undefined : settings.thinkingLevel;
}
export function configuredImplementationPlanRetention(
    settings: PlanModeSettings,
): ImplementationPlanRetention {
    return settings.implementationPlanRetention ?? "clear-after-first-run";
}
export function configuredImplementationModel(
    settings: PlanModeSettings,
): ImplementationModelOverride | undefined {
    return settings.defaultImplementationModel;
}
export function configuredImplementationThinkingLevel(
    settings: PlanModeSettings,
): PlanModeFixedThinkingLevel | undefined {
    return settings.defaultImplementationThinkingLevel;
}
export function configuredPlanExportPath(settings: PlanModeSettings): string {
    return settings.defaultPlanExportPath ?? DEFAULT_PLAN_EXPORT_PATH;
}
export function configuredPlanModeToggleShortcut(settings: PlanModeSettings): KeyId | undefined {
    return settings.toggleShortcut;
}
