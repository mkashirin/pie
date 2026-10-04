import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import { type ExtensionContext, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROFILES = [
    "orchestrator",
    "scout",
    "worker",
    "reviewer",
    "researcher",
    "research-validator",
] as const;
export type Profile = typeof PROFILES[number];
export const CLASSES = ["read", "write", "execute", "delegate", "control", "unknown"] as const;
export type Capability = typeof CLASSES[number];
export const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export interface Assignment {
    model?: string;
    thinking?: ThinkingLevel;
    allowTools?: string[];
    denyTools?: string[];
}
export interface Settings {
    default?: Assignment;
    agents?: Record<string, Assignment>;
    classifications?: Record<string, Capability>;
    maxTasks?: number;
    concurrency?: number;
    maxTurns?: number;
    timeoutMs?: number;
}
export interface Definition extends Assignment {
    name: string;
    description: string;
    profile: Profile;
    prompt: string;
    core: string;
    source: string;
}
export interface Configuration {
    definitions: Map<string, Definition>;
    user: Settings;
    project: Settings;
}
export interface SessionSettings extends Settings {}
export const DEFAULT_LIMITS = { maxTasks: 8, concurrency: 4, maxTurns: 24, timeoutMs: 600_000 };
export const bundledDir = fileURLToPath(new URL("../agents/", import.meta.url));
const NAME = /^[a-z][a-z0-9-]*$/;

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label}: expected object`);
    }
    return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], label: string) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`);
    }
}

export function splitModel(ref: string): [string, string] {
    const slash = ref.indexOf("/");
    if (slash < 1 || slash === ref.length - 1 || /\s/.test(ref)) {
        throw new Error("Model must be provider/model-id");
    }
    return [ref.slice(0, slash), ref.slice(slash + 1)];
}

export function toolList(value: unknown, label: string): string[] {
    const list = typeof value === "string"
        ? value.split(",").map((x) => x.trim()).filter(Boolean)
        : value;
    if (
        !Array.isArray(list) || list.some((x) => typeof x !== "string" || !x.trim() || /\s/.test(x))
    ) {
        throw new Error(`${label}: expected tool names`);
    }
    return [...new Set(list as string[])];
}

export function assignment(value: unknown, label: string): Assignment {
    const v = object(value, label);
    keys(v, ["model", "thinking", "allowTools", "denyTools"], label);
    const result: Assignment = {};
    if (v.model !== undefined) {
        if (typeof v.model !== "string") throw new Error(`${label}.model: expected string`);
        splitModel(v.model);
        result.model = v.model;
    }
    if (v.thinking !== undefined) {
        if (!LEVELS.includes(v.thinking as ThinkingLevel)) {
            throw new Error(`${label}.thinking: invalid level`);
        }
        result.thinking = v.thinking as ThinkingLevel;
    }
    for (const key of ["allowTools", "denyTools"] as const) {
        if (v[key] !== undefined) result[key] = toolList(v[key], `${label}.${key}`);
    }
    return result;
}

export function validateSettings(value: unknown, label = "settings"): Settings {
    const v = object(value, label);
    keys(v, ["default", "agents", "classifications", ...Object.keys(DEFAULT_LIMITS)], label);
    const result: Settings = {};
    if (v.default !== undefined) result.default = assignment(v.default, `${label}.default`);
    if (v.agents !== undefined) {
        result.agents = {};
        for (const [name, entry] of Object.entries(object(v.agents, `${label}.agents`))) {
            if (!NAME.test(name)) throw new Error(`${label}: invalid agent name ${name}`);
            result.agents[name] = assignment(entry, `${label}.agents.${name}`);
        }
    }
    if (v.classifications !== undefined) {
        result.classifications = {};
        for (
            const [name, entry] of Object.entries(
                object(v.classifications, `${label}.classifications`),
            )
        ) {
            if (!name || !CLASSES.includes(entry as Capability)) {
                throw new Error(`${label}: invalid classification ${name}`);
            }
            result.classifications[name] = entry as Capability;
        }
    }
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof typeof DEFAULT_LIMITS)[]) {
        if (v[key] !== undefined) {
            if (!Number.isSafeInteger(v[key]) || (v[key] as number) < 1) {
                throw new Error(`${label}.${key}: expected positive integer`);
            }
            result[key] = v[key] as number;
        }
    }
    return result;
}

export const CONFIG_FILE = "pi-openai-subagents.json";

async function scopedSettings(dir: string): Promise<Settings> {
    const path = join(dir, CONFIG_FILE);
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
    }
    return validateSettings(JSON.parse(text), path);
}

async function definitions(dir: string, bundled: Map<string, Definition>): Promise<Definition[]> {
    let entries: string[];
    try {
        entries = (await readdir(dir)).filter((x) => x.endsWith(".md")).sort();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
    const result: Definition[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        const path = join(dir, entry);
        const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(
            await readFile(path, "utf8"),
        );
        const v = object(frontmatter, path);
        keys(
            v,
            ["name", "description", "profile", "model", "thinking", "allowTools", "denyTools"],
            path,
        );
        if (
            typeof v.name !== "string" || !NAME.test(v.name) || typeof v.description !== "string"
            || !v.description.trim() || !body.trim()
        ) throw new Error(`${path}: name, description and instructions are required`);
        if (seen.has(v.name)) throw new Error(`${dir}: duplicate agent ${v.name}`);
        seen.add(v.name);
        const base = bundled.get(v.name);
        const profile = v.profile ?? base?.profile;
        if (!PROFILES.includes(profile as Profile) || (base && base.profile !== profile)) {
            throw new Error(`${path}: invalid or changed base profile`);
        }
        const fields = Object.fromEntries(
            Object.entries(v).filter(([key]) =>
                ["model", "thinking", "allowTools", "denyTools"].includes(key)
            ),
        );
        result.push({
            ...assignment(fields, path),
            name: v.name,
            description: v.description,
            profile: profile as Profile,
            prompt: body.trim(),
            core: base?.core ?? "",
            source: path,
        });
    }
    return result;
}

export async function loadConfiguration(
    agentDir: string,
    cwd: string,
    trusted: boolean,
): Promise<Configuration> {
    const map = new Map<string, Definition>();
    for (const d of await definitions(bundledDir, map)) map.set(d.name, { ...d, core: d.prompt });
    const bundled = new Map(map);
    const dirs = [agentDir, ...(trusted ? [join(cwd, ".pi")] : [])];
    for (const dir of dirs) {
        for (const d of await definitions(join(dir, "pi-openai-subagents", "agents"), bundled)) {
            map.set(d.name, d);
        }
    }
    const user = await scopedSettings(agentDir);
    const project = trusted ? await scopedSettings(join(cwd, ".pi")) : {};
    return { definitions: map, user, project };
}

export async function saveSettings(agentDir: string, settings: Settings): Promise<void> {
    validateSettings(settings);
    await mkdir(agentDir, { recursive: true });
    const path = join(agentDir, CONFIG_FILE);
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
}

export function field<K extends keyof Assignment>(
    config: Configuration,
    session: SessionSettings,
    d: Definition,
    key: K,
): { value: Assignment[K]; source: string } {
    const layers: [Assignment | undefined, string][] = [
        [session.agents?.[d.name], "session agent"],
        [config.project.agents?.[d.name], "project agent"],
        [config.user.agents?.[d.name], "user agent"],
        [d, d.source],
        [session.default, "session default"],
        [config.project.default, "project default"],
        [config.user.default, "user default"],
    ];
    for (const [value, source] of layers) {
        if (value?.[key] !== undefined) return { value: value[key], source };
    }
    return { value: undefined, source: "initial default" };
}

export function limits(config: Configuration) {
    return { ...DEFAULT_LIMITS, ...pickLimits(config.user), ...pickLimits(config.project) };
}

function pickLimits(settings: Settings) {
    return Object.fromEntries(
        Object.keys(DEFAULT_LIMITS).filter((k) => settings[k as keyof Settings] !== undefined).map(
            (k) => [k, settings[k as keyof Settings]],
        ),
    ) as Partial<typeof DEFAULT_LIMITS>;
}

export function classifications(config: Configuration, session: SessionSettings) {
    return {
        ...config.user.classifications,
        ...config.project.classifications,
        ...session.classifications,
    };
}

function eligibleDefault(model: Model<Api>): boolean {
    const helper = (codingAgent as unknown as {
        isVirtualModel?: (model: { api: string }) => boolean;
    }).isVirtualModel;
    const virtual = helper ? helper(model) : model.api === "pi-virtual";
    return !virtual && model.provider === "openai" && model.api === "openai-responses";
}

export function assignmentFor(
    config: Configuration,
    session: SessionSettings,
    name: string,
    parent?: Model<Api>,
) {
    const d = config.definitions.get(name);
    if (!d) throw new Error(`Unknown agent ${name}; use /subagents list`);
    const m = field(config, session, d, "model");
    const t = field(config, session, d, "thinking");
    return {
        definition: d,
        ref: m.value ?? (parent && eligibleDefault(parent)
            ? `${parent.provider}/${parent.id}`
            : "openai/gpt-6.1-sol"),
        modelSource: m.source,
        thinking: t.value ?? "high",
        thinkingSource: t.source,
    };
}

export async function resolveAssignment(
    config: Configuration,
    session: SessionSettings,
    name: string,
    ctx: ExtensionContext,
    strictThinking = false,
) {
    const selected = assignmentFor(config, session, name, ctx.model);
    const [provider, id] = splitModel(selected.ref);
    const model = ctx.modelRegistry.find(provider, id);
    if (!model) {
        throw new Error(
            `Model ${selected.ref} is unavailable. Choose an installed chat model with /subagents model ${name} provider/model-id.`,
        );
    }
    if (selected.modelSource === "initial default" && !eligibleDefault(model)) {
        throw new Error(
            `Default model ${selected.ref} must be a physical openai/openai-responses model. Choose one with /subagents model default openai/model-id --save.`,
        );
    }
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(`Model ${selected.ref}: ${auth.error}. Use /login ${provider}.`);
    const supported = supportedThinking(model);
    const requested = selected.thinking;
    const thinking = supported.includes(requested)
        ? requested
        : supported.filter((x) => LEVELS.indexOf(x) <= LEVELS.indexOf(requested)).at(-1)
            ?? supported[0];
    if (strictThinking && thinking !== requested) {
        throw new Error(
            `${selected.ref} does not support ${requested}; supported: ${supported.join(", ")}`,
        );
    }
    return {
        ...selected,
        model,
        thinking,
        normalization: thinking !== requested
            ? `${requested} → ${thinking} for ${selected.ref}`
            : undefined,
    };
}

export function supportedThinking(model: Model<Api>): ThinkingLevel[] {
    return getSupportedThinkingLevels(model);
}
