import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export interface ServerConfig {
    name: string;
    command: string[];
    extensions: string[];
    env?: Record<string, string>;
    initialization?: Record<string, unknown>;
    skipDirectories?: string[];
    diagnosticsSettleMs?: number;
    pushDiagnosticsGraceMs?: number;
    pullDiagnosticsGraceMs?: number;
}
export interface Configuration {
    servers: ServerConfig[];
    timeout: number;
    source?: string;
    trusted: boolean;
    warnings: string[];
}
const record = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim().length > 0);
function parse(value: unknown): { servers: ServerConfig[]; timeout: number } {
    if (!record(value)) throw new Error("Expected a server map or { servers, timeout }");
    const wrapped = Object.hasOwn(value, "servers");
    if (wrapped && Object.keys(value).some((k) => !["servers", "timeout"].includes(k))) {
        throw new Error("Unknown configuration field");
    }
    const map = wrapped ? value.servers : value;
    const timeout = wrapped ? (value.timeout === undefined ? 20000 : value.timeout) : 20000;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
        throw new Error("timeout must be a positive finite number");
    }
    if (!record(map)) throw new Error("servers must be an object map");
    const servers = Object.entries(map).map(([name, entry]) => {
        if (!name.trim() || !record(entry)) throw new Error(`Invalid server ${name}`);
        const allowed = [
            "command",
            "extensions",
            "env",
            "initialization",
            "skipDirectories",
            "diagnosticsSettleMs",
            "pushDiagnosticsGraceMs",
            "pullDiagnosticsGraceMs",
        ];
        if (Object.keys(entry).some((k) => !allowed.includes(k))) {
            throw new Error(`Unknown field in server ${name}`);
        }
        if (
            !Array.isArray(entry.command) || !entry.command.length
            || typeof entry.command[0] !== "string" || !entry.command[0].trim()
            || !entry.command.every((v) => typeof v === "string") || !strings(entry.extensions)
            || !entry.extensions.length
        ) throw new Error(`${name}: command and extensions must be nonempty string arrays`);
        if (
            entry.env !== undefined
            && (!record(entry.env) || Object.values(entry.env).some((v) => typeof v !== "string"))
        ) throw new Error(`${name}: env must contain strings`);
        if (entry.initialization !== undefined && !record(entry.initialization)) {
            throw new Error(`${name}: initialization must be an object`);
        }
        if (
            entry.skipDirectories !== undefined
            && (!strings(entry.skipDirectories)
                || entry.skipDirectories.some((v) =>
                    v === "." || v === ".." || /[/\\]/.test(v) || v.includes("\0")
                ))
        ) {
            throw new Error(
                `${name}: skipDirectories must contain nonblank directory names without separators, . or ..`,
            );
        }
        for (const key of allowed.filter((k) => k.endsWith("Ms"))) {
            const v = entry[key];
            if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v <= 0)) {
                throw new Error(`${name}: ${key} must be a positive finite number`);
            }
        }
        return {
            ...entry,
            name,
            extensions: entry.extensions.map((e) => e.startsWith(".") ? e : `.${e}`),
        } as ServerConfig;
    });
    return { servers, timeout };
}

/** The first existing configuration wins, including when it is invalid. */
export async function loadConfiguration(
    agentDir: string,
    cwd: string,
    trusted: boolean,
): Promise<Configuration> {
    const result: Configuration = { servers: [], timeout: 20000, trusted, warnings: [] };
    for (const dir of trusted ? [join(cwd, CONFIG_DIR_NAME), agentDir] : [agentDir]) {
        for (const name of ["pi-lsp.json", "lsp.json"]) {
            const source = join(dir, name);
            let text: string;
            try {
                text = await readFile(source, "utf8");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
                return { ...result, source, warnings: [`Cannot read ${source}: ${String(error)}`] };
            }
            result.source = source;
            if (name === "pi-lsp.json") {
                const legacy = join(dir, "lsp.json");
                try {
                    await lstat(legacy);
                    result.warnings.push(
                        `Canonical configuration ${source} takes precedence over legacy configuration ${legacy}`,
                    );
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                        result.warnings.push(
                            `Cannot inspect legacy configuration ${legacy}: ${String(error)}`,
                        );
                    }
                }
            }
            if (name === "lsp.json") {
                result.warnings.push(`Legacy configuration ${source}; rename it to pi-lsp.json`);
            }
            try {
                return { ...result, ...parse(JSON.parse(text)) };
            } catch (error) {
                result.warnings.push(`Invalid configuration ${source}: ${String(error)}`);
                return result;
            }
        }
    }
    return result;
}
