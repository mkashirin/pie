import { readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ServerConfig } from "./config.ts";

const normalize = (input: string) => input.startsWith("@") ? input.slice(1) : input;
function confined(root: string, path: string): boolean {
    const rel = relative(root, path);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function canonical(root: string, input: string): Promise<string> {
    const path = resolve(root, normalize(input));
    if (!confined(root, path)) throw new Error(`Path is outside root: ${input}`);
    const actual = await realpath(path);
    if (!confined(root, actual)) throw new Error(`Symlink escapes root: ${input}`);
    return actual;
}
export async function resolveRoot(cwd: string, input?: string): Promise<string> {
    const root = await realpath(resolve(cwd, normalize(input ?? ".")));
    if (!(await stat(root)).isDirectory()) throw new Error(`Root must be a directory: ${root}`);
    return root;
}
export async function resolveFile(root: string, input: string): Promise<string> {
    root = await resolveRoot(root);
    const path = await canonical(root, input);
    if (!(await stat(path)).isFile()) throw new Error(`Expected a regular file: ${input}`);
    return path;
}
const excluded = [
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".cache",
    "target",
    "__pycache__",
    ".venv",
    "venv",
    ".turbo",
    ".output",
    ".mypy_cache",
    ".ruff_cache",
    ".svelte-kit",
    ".tox",
    "out",
];

/** Sequential async traversal bounds filesystem work and keeps ordering stable. */
export async function discoverFiles(
    root: string,
    paths: string[] | undefined,
    server: ServerConfig,
    limit: number,
    signal: AbortSignal,
): Promise<{ files: string[]; limited: boolean; warnings: string[] }> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error("File limit must be a positive integer");
    }
    signal.throwIfAborted();
    root = await resolveRoot(root);
    const files: string[] = [], warnings: string[] = [];
    const seen = new Set<string>();
    const skip = new Set([...excluded, ...server.skipDirectories ?? []]);
    let limited = false;
    const supported = (path: string) =>
        server.extensions.some((e) => extname(path) === (e.startsWith(".") ? e : `.${e}`));
    async function visit(input: string, explicit: boolean): Promise<void> {
        signal.throwIfAborted();
        const path = await canonical(root, input);
        signal.throwIfAborted();
        const info = await stat(path);
        if (info.isDirectory()) {
            if (!explicit && (skip.has(basename(input)) || skip.has(basename(path)))) return;
            if (seen.has(path)) return;
            seen.add(path);
            const entries = (await readdir(path)).sort();
            for (const entry of entries) {
                if (limited) break;
                signal.throwIfAborted();
                try {
                    await visit(join(path, entry), false);
                } catch (error) {
                    signal.throwIfAborted();
                    warnings.push(`Skipped ${join(path, entry)}: ${String(error)}`);
                }
            }
        } else if (info.isFile()) {
            if (!supported(path)) {
                if (explicit) {
                    throw new Error(
                        `Unsupported file ${input} for ${server.name}; configure its extension in pi-lsp.json or select a matching server`,
                    );
                }
                return;
            }
            if (seen.has(path)) return;
            seen.add(path);
            if (files.length === limit) {
                limited = true;
                return;
            }
            files.push(path);
        } else if (explicit) throw new Error(`Expected a regular file or directory: ${input}`);
    }
    for (const input of [...new Set(paths?.length ? paths : ["."])].sort()) {
        if (limited) break;
        await visit(input, true);
    }
    signal.throwIfAborted();
    return { files, limited, warnings };
}

export function languageId(path: string): string {
    const ids: Record<string, string> = {
        ts: "typescript",
        tsx: "typescriptreact",
        js: "javascript",
        jsx: "javascriptreact",
        mjs: "javascript",
        cjs: "javascript",
        mts: "typescript",
        cts: "typescript",
        py: "python",
        rs: "rust",
        go: "go",
        rb: "ruby",
        sh: "shellscript",
        bash: "shellscript",
        yml: "yaml",
        yaml: "yaml",
        md: "markdown",
        json: "json",
        jsonc: "jsonc",
        h: "c",
        c: "c",
        cpp: "cpp",
        hpp: "cpp",
        cs: "csharp",
        java: "java",
        vue: "vue",
        svelte: "svelte",
        html: "html",
        css: "css",
        scss: "scss",
        swift: "swift",
        kt: "kotlin",
        lua: "lua",
        php: "php",
        toml: "toml",
        xml: "xml",
        C: "cpp",
        cc: "cpp",
        cxx: "cpp",
        hh: "cpp",
        hxx: "cpp",
        tex: "latex",
        ex: "elixir",
        exs: "elixir",
        tf: "terraform",
        tfvars: "terraform",
        fs: "fsharp",
        fsx: "fsharp",
        fsi: "fsharp",
        ml: "ocaml",
        mli: "ocaml",
        clj: "clojure",
        cljs: "clojure",
        cljc: "clojure",
        edn: "clojure",
        erl: "erlang",
        hrl: "erlang",
        hs: "haskell",
        lhs: "haskell",
        r: "r",
        R: "r",
        dart: "dart",
        sql: "sql",
        zig: "zig",
        proto: "proto3",
        ps1: "powershell",
        psm1: "powershell",
        less: "less",
        sass: "sass",
        kts: "kotlin",
        pl: "perl",
        pm: "perl",
    };
    const extension = extname(path).slice(1);
    return ids[extension] ?? (extension || "plaintext");
}
