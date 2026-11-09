import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export function effectiveEnvironment(overrides?: Record<string, string>): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const [key, value] of Object.entries(overrides ?? {})) {
        if (process.platform === "win32") {
            for (const old of Object.keys(env)) {
                if (old.toLowerCase() === key.toLowerCase()) delete env[old];
            }
        }
        env[key] = value;
    }
    return env;
}

/** Resolve argv[0] without running a shell or interpreting command arguments. */
export async function resolveCommand(
    command: string,
    root: string,
    env?: Record<string, string>,
    platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
    if (!command || command.includes("\0")) return undefined;
    const windows = platform === "win32";
    const environment = effectiveEnvironment(env);
    const get = (key: string) => {
        const override = Object.keys(env ?? {}).find((k) =>
            windows ? k.toLowerCase() === key.toLowerCase() : k === key
        );
        if (override) return env![override];
        return environment[
            Object.keys(environment).find((k) =>
                windows ? k.toLowerCase() === key.toLowerCase() : k === key
            ) ?? key
        ];
    };
    const explicit = isAbsolute(command) || /[/\\]/.test(command);
    const bases = explicit
        ? [resolve(root, command)]
        : (get("PATH") ?? "").split(windows ? ";" : ":").filter(Boolean).map((p) =>
            resolve(root, p.replace(/^"|"$/g, ""), command)
        );
    const extensions = windows
        ? (get("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
        : [];
    for (const base of bases) {
        const candidates = windows
            ? (extensions.some((e) => base.toLowerCase().endsWith(e.toLowerCase()))
                ? [base]
                : extensions.map((e) => base + e))
            : [base];
        for (let candidate of candidates) {
            try {
                if (windows) {
                    const entries = await readdir(dirname(candidate));
                    const actual = entries.find((e) =>
                        e.toLowerCase() === basename(candidate).toLowerCase()
                    );
                    if (!actual) continue;
                    candidate = join(dirname(candidate), actual);
                }
                if (!(await stat(candidate)).isFile()) continue;
                await access(candidate, windows ? constants.F_OK : constants.X_OK);
                return candidate;
            } catch { /* Try the next PATH candidate. */ }
        }
    }
    return undefined;
}
