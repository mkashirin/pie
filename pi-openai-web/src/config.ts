import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface Settings {
    enabled: boolean;
    model?: string;
    freshness: "live" | "cached";
    searchContextSize: "low" | "medium" | "high";
    concurrency: number;
    searchTimeoutMs: number;
    pageTimeoutMs: number;
}
export const defaults: Readonly<Settings> = Object.freeze({
    enabled: true,
    freshness: "live",
    searchContextSize: "medium",
    concurrency: 3,
    searchTimeoutMs: 120_000,
    pageTimeoutMs: 30_000,
});
export const envKeys: Record<keyof Settings, string> = {
    enabled: "PI_OPENAI_WEB_ENABLED",
    model: "PI_OPENAI_WEB_MODEL",
    freshness: "PI_OPENAI_WEB_FRESHNESS",
    searchContextSize: "PI_OPENAI_WEB_SEARCH_CONTEXT_SIZE",
    concurrency: "PI_OPENAI_WEB_CONCURRENCY",
    searchTimeoutMs: "PI_OPENAI_WEB_SEARCH_TIMEOUT_MS",
    pageTimeoutMs: "PI_OPENAI_WEB_PAGE_TIMEOUT_MS",
};
export type Key = keyof Settings;
export interface Configuration {
    settings: Settings;
    provenance: Record<Key, string>;
    user: Partial<Settings>;
    project: Partial<Settings>;
    paths: { user: string; project: string };
    trusted: boolean;
}

export function splitModel(value: string): [string, string] {
    const slash = value.indexOf("/");
    if (slash < 1 || slash === value.length - 1 || /\s|[\x00-\x1f\x7f]/u.test(value)) {
        throw new Error("model must be provider/model-id");
    }
    return [value.slice(0, slash), value.slice(slash + 1)];
}

export function validateSettings(value: unknown, label = "configuration"): Partial<Settings> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label}: expected an object`);
    }
    const fields = value as Record<string, unknown>;
    for (const [key, field] of Object.entries(fields)) {
        if (!Object.hasOwn(envKeys, key)) throw new Error(`${label}: unknown key ${key}`);
        let valid = false;
        switch (key) {
            case "enabled":
                valid = typeof field === "boolean";
                break;
            case "model":
                valid = typeof field === "string";
                if (valid) splitModel(field as string);
                break;
            case "freshness":
                valid = field === "live" || field === "cached";
                break;
            case "searchContextSize":
                valid = ["low", "medium", "high"].includes(field as string);
                break;
            case "concurrency":
                valid = Number.isInteger(field) && Number(field) >= 1 && Number(field) <= 8;
                break;
            case "searchTimeoutMs":
                valid = Number.isInteger(field) && Number(field) >= 1000
                    && Number(field) <= 600_000;
                break;
            case "pageTimeoutMs":
                valid = Number.isInteger(field) && Number(field) >= 1000
                    && Number(field) <= 120_000;
                break;
        }
        if (!valid) throw new Error(`${label}.${key}: invalid value`);
    }
    return { ...fields } as Partial<Settings>;
}

export function parseValue(key: Key, value: string): Partial<Settings> {
    let parsed: unknown = value;
    if (key === "enabled") parsed = value === "true" ? true : value === "false" ? false : value;
    if (["concurrency", "searchTimeoutMs", "pageTimeoutMs"].includes(key)) {
        parsed = /^\d+$/u.test(value) ? Number(value) : value;
    }
    return validateSettings({ [key]: parsed });
}

async function readSettings(path: string): Promise<Partial<Settings>> {
    try {
        return validateSettings(JSON.parse(await readFile(path, "utf8")), path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
    }
}

export async function loadConfiguration(
    agentDir: string,
    cwd: string,
    trusted: boolean,
    env: NodeJS.ProcessEnv = process.env,
): Promise<Configuration> {
    const paths = {
        user: join(agentDir, "pi-openai-web.json"),
        project: join(cwd, ".pi", "pi-openai-web.json"),
    };
    const user = await readSettings(paths.user);
    const project = trusted ? await readSettings(paths.project) : {};
    const environment: Partial<Settings> = {};
    for (const name of Object.keys(env)) {
        if (name.startsWith("PI_OPENAI_WEB_") && !Object.values(envKeys).includes(name)) {
            throw new Error(`Unknown environment configuration ${name}`);
        }
    }
    for (const key of Object.keys(envKeys) as Key[]) {
        const value = env[envKeys[key]];
        if (value !== undefined) Object.assign(environment, parseValue(key, value));
    }
    const settings: Settings = { ...defaults, ...user, ...project, ...environment };
    const provenance = {} as Record<Key, string>;
    for (const key of Object.keys(envKeys) as Key[]) {
        provenance[key] = Object.hasOwn(environment, key)
            ? envKeys[key]
            : Object.hasOwn(project, key)
            ? paths.project
            : Object.hasOwn(user, key)
            ? paths.user
            : "default";
    }
    return { settings, provenance, user, project, paths, trusted };
}

export function eligible(model: Model<Api> | undefined): model is Model<Api> {
    return !!model && ["openai", "openai-multi"].includes(model.provider)
        && model.api === "openai-responses";
}

export function resolveModel(
    settings: Settings,
    ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
): Model<Api> {
    const selected = settings.model
        ? ctx.modelRegistry.find(...splitModel(settings.model))
        : ctx.model;
    if (!eligible(selected)) {
        throw new Error(
            settings.model
                ? `Configured model ${settings.model} is unavailable or not a physical openai or openai-multi model using openai-responses; no fallback is allowed`
                : "Select a physical openai or openai-multi model using openai-responses or set /openai-web set model provider/<model-id>",
        );
    }
    // Plain snapshot: a batch never consults a later foreground selection.
    return structuredClone(selected);
}

export async function mutateConfiguration(
    agentDir: string,
    ctx: Pick<ExtensionContext, "cwd" | "isIdle" | "isProjectTrusted">,
    args: string,
    busy: boolean,
    env: NodeJS.ProcessEnv = process.env,
): Promise<Configuration> {
    if (!ctx.isIdle() || busy) throw new Error("Configuration changes require an idle session");
    const words = args.trim().split(/\s+/u);
    const project = words.at(-1) === "--project";
    if (project) words.pop();
    if (project && !ctx.isProjectTrusted()) {
        throw new Error("Project configuration requires project trust");
    }
    const [operation, key, value] = words;
    if (
        !(["set", "reset"].includes(operation)) || (key && !Object.hasOwn(envKeys, key))
        || (operation === "set" && words.length !== 3)
        || (operation === "reset" && words.length > 2)
    ) {
        throw new Error(
            "Usage: /openai-web [status] | set key value [--project] | reset [key] [--project]",
        );
    }
    // Serialize commands in the caller. Validate every participating layer before touching disk.
    const current = await loadConfiguration(agentDir, ctx.cwd, ctx.isProjectTrusted(), env);
    const next = { ...(project ? current.project : current.user) };
    if (operation === "reset") {
        if (key) delete next[key as Key];
        else for (const field of Object.keys(next)) delete next[field as Key];
    } else Object.assign(next, parseValue(key as Key, value));
    validateSettings(next);
    const path = project ? current.paths.project : current.paths.user;
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        await rename(tmp, path);
    } finally {
        await rm(tmp, { force: true });
    }
    return loadConfiguration(agentDir, ctx.cwd, ctx.isProjectTrusted(), env);
}

export function status(
    config: Configuration,
    ctx: Pick<ExtensionContext, "model" | "modelRegistry">,
): string {
    const lines = (Object.keys(envKeys) as Key[]).map((key) =>
        `${key}=${config.settings[key] ?? "unset"} (${config.provenance[key]})`
    );
    try {
        const model = resolveModel(config.settings, ctx);
        lines.push(`resolvedModel=${model.provider}/${model.id}`);
        lines.push(
            `auth=${
                ctx.modelRegistry.hasConfiguredAuth(model)
                    ? "configured (not verified)"
                    : "not configured"
            }`,
        );
    } catch (error) {
        lines.push(`model error: ${(error as Error).message}`);
    }
    lines.push(`project=${config.trusted ? "trusted" : "untrusted; ignored"}`);
    return lines.join("\n");
}
