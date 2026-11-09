import { open, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Value } from "typebox/value";
import { LspClient } from "./client.ts";
import { loadConfiguration } from "./config.ts";
import { discoverFiles, languageId, resolveFile, resolveRoot } from "./files.ts";
import { computeFix, withSafeFile } from "./fixes.ts";
import { createPacket, DiagnosticParams, finalizeResult, FixParams } from "./results.ts";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export const typedError = (error: unknown) => ({
    kind: error instanceof Error ? error.name : "Error",
    message: message(error),
});
const matches = (path: string, extensions: string[]) =>
    extensions.some((extension) =>
        extname(path) === (extension.startsWith(".") ? extension : `.${extension}`)
    );
// Own the timer so completed/skipped routes leave no idle deadline behind.
function routeDeadline(parent: AbortSignal, timeout: number) {
    const controller = new AbortController();
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dispose = () => {
        clearTimeout(timer);
        parent.removeEventListener("abort", cancel);
    };
    const cancel = () => {
        dispose();
        controller.abort(parent.reason);
    };
    const schedule = (initial = false) => {
        const remaining = initial ? timeout : timeout - (performance.now() - started);
        if (remaining <= 0) {
            dispose();
            controller.abort(new DOMException("The operation timed out", "TimeoutError"));
            return;
        }
        timer = setTimeout(schedule, Math.min(2147483647, Math.ceil(remaining)));
        timer.unref();
    };
    parent.addEventListener("abort", cancel, { once: true });
    if (parent.aborted) cancel();
    else schedule(true);
    return { signal: controller.signal, dispose };
}
export class Runtime {
    private lifecycle = new AbortController();
    private activities = new Map<symbol, Promise<unknown>>();
    private activity?: (count: number) => void;
    private current = new Set<symbol>();
    constructor(
        private readonly createClient = (
            server: ConstructorParameters<typeof LspClient>[0],
            root: string,
            signal: AbortSignal,
        ) => new LspClient(server, root, signal),
    ) {}
    setActivity(callback: (count: number) => void) {
        this.activity = callback;
        this.publish();
    }
    private publish() {
        try {
            this.activity?.(this.current.size);
        } catch { /* UI is noncritical. */ }
    }
    get busy() {
        return this.current.size;
    }
    captureLifecycle() {
        return this.lifecycle.signal;
    }
    beginSession() {
        this.activity = undefined;
        this.lifecycle.abort(new Error("Session replaced"));
        this.lifecycle = new AbortController();
        this.current.clear();
    }
    async stop() {
        this.activity = undefined;
        this.lifecycle.abort(new Error("Session ended"));
        await Promise.allSettled([...this.activities.values()]);
    }
    async execute(
        tool: "lsp_diagnostics" | "lsp_fix",
        id: string,
        args: unknown,
        agentDir: string,
        cwd: string,
        trusted: boolean,
        signal?: AbortSignal,
    ) {
        const lifecycle = this.captureLifecycle();
        const combined = AbortSignal.any([lifecycle, ...(signal ? [signal] : [])]);
        const key = Symbol(id);
        const work = this.run(tool, id, args, agentDir, cwd, trusted, combined);
        this.activities.set(key, work);
        this.current.add(key);
        this.publish();
        try {
            return await work;
        } finally {
            this.activities.delete(key);
            this.current.delete(key);
            if (!lifecycle.aborted) this.publish();
        }
    }
    private async run(
        tool: "lsp_diagnostics" | "lsp_fix",
        id: string,
        input: unknown,
        agentDir: string,
        cwd: string,
        trusted: boolean,
        signal: AbortSignal,
    ) {
        const packet = createPacket(tool, id);
        try {
            signal.throwIfAborted();
            if (!Value.Check(tool === "lsp_fix" ? FixParams : DiagnosticParams, input)) {
                throw new Error("Invalid arguments; inspect the tool schema");
            }
            const args = input as {
                root?: string;
                server?: string | string[];
                paths?: string[];
                path?: string;
                limit?: number;
                kind?: string;
                write?: boolean;
            };
            if (args.limit !== undefined && (args.limit < 1 || args.limit > 1000)) {
                throw new Error("limit must be 1..1000");
            }
            if (tool === "lsp_fix" && Array.isArray(args.server)) {
                throw new Error("Fix server must be a single name");
            }
            const config = await loadConfiguration(agentDir, cwd, trusted);
            signal.throwIfAborted();
            packet.warnings.push(...config.warnings);
            const root = await resolveRoot(cwd, args.root);
            packet.request.root = root;
            const names = args.server === undefined
                ? undefined
                : Array.isArray(args.server)
                ? args.server
                : [args.server];
            if (names?.some((name) => !config.servers.some((s) => s.name === name))) {
                throw new Error(
                    "Unknown server name; use /lsp status to inspect configured servers",
                );
            }
            let servers = config.servers.filter((s) => !names || names.includes(s.name));
            if (!servers.length) {
                throw new Error(
                    "No LSP servers configured; create pi-lsp.json and use /lsp status",
                );
            }
            const target = tool === "lsp_fix" ? await resolveFile(root, args.path!) : undefined;
            if (target) {
                servers = servers.filter((s) => matches(target, s.extensions));
                if (servers.length !== 1) {
                    throw new Error(
                        "Fix requires exactly one matching server; select a configured server explicitly",
                    );
                }
            }
            // Validate all explicit inputs before route filtering, limits, or spawning.
            const requested: { path: string; directory: boolean }[] = [];
            if (!target) {
                for (const input of args.paths ?? ["."]) {
                    signal.throwIfAborted();
                    const normalized = input.startsWith("@") ? input.slice(1) : input;
                    const info = await stat(resolve(root, normalized)).catch((error) => {
                        throw new Error(`Cannot access requested path ${input}: ${message(error)}`);
                    });
                    const path = info.isDirectory()
                        ? await resolveRoot(root, normalized)
                        : await resolveFile(root, input);
                    const rel = relative(root, path);
                    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
                        throw new Error(`Path is outside root: ${input}`);
                    }
                    if (
                        !info.isDirectory()
                        && !servers.some((server) => matches(path, server.extensions))
                    ) {
                        throw new Error(
                            `Unsupported file ${input}; configure its extension in pi-lsp.json or select a matching server`,
                        );
                    }
                    requested.push({ path, directory: info.isDirectory() });
                }
            }
            let budget = 32 * 1024 * 1024;
            for (const server of servers) {
                signal.throwIfAborted();
                const deadline = routeDeadline(signal, config.timeout);
                const routeSignal = deadline.signal;
                const route: Record<string, unknown> = {
                    server: server.name,
                    complete: false,
                    files: [],
                };
                packet.routes.push(route);
                let client: LspClient | undefined;
                try {
                    const paths = requested.filter(({ path, directory }) =>
                        directory || matches(path, server.extensions)
                    ).map(({ path }) => path);
                    const files = target
                        ? { files: [target], limited: false, warnings: [] }
                        : paths.length
                        ? await discoverFiles(root, paths, server, args.limit ?? 50, routeSignal)
                        : { files: [], limited: false, warnings: [] };
                    files.files = files.files.filter((path) => matches(path, server.extensions));
                    routeSignal.throwIfAborted();
                    packet.warnings.push(...files.warnings);
                    if (!files.files.length) {
                        if (names) {
                            throw new Error(
                                "No matching files for selected server; check paths and extensions",
                            );
                        }
                        route.skipped = true;
                        continue;
                    }
                    route.limited = files.limited;
                    const outcomes = route.files as Record<string, unknown>[];
                    if (target) {
                        const operation = withSafeFile(
                            target,
                            args.write ?? false,
                            routeSignal,
                            async (text) => {
                                routeSignal.throwIfAborted();
                                client = this.createClient(server, root, routeSignal);
                                await client.start();
                                const uri = pathToFileURL(target).href;
                                client.open(uri, text, languageId(target));
                                const computed = await (async () => {
                                    try {
                                        return await computeFix(
                                            client!,
                                            uri,
                                            text,
                                            args.kind ?? "source.fixAll",
                                            routeSignal,
                                        );
                                    } finally {
                                        try {
                                            client!.closeDocument(uri);
                                        } catch (error) {
                                            packet.warnings.push(`Cleanup: ${message(error)}`);
                                        }
                                    }
                                })();
                                if (computed.unsupportedActions.length) {
                                    packet.fix = {
                                        ...computed,
                                        written: false,
                                        preview: computed.text,
                                    };
                                    throw new Error(
                                        "Unsupported actions rejected; no edits written",
                                    );
                                }
                                return computed;
                            },
                        );
                        const result = await operation;
                        packet.fix = {
                            ...result.value,
                            written: result.written,
                            preview: result.value.text,
                        };
                        route.complete = true;
                    } else {
                        client = this.createClient(server, root, routeSignal);
                        await client.start();
                        // Reserve all read bytes serially; at most eight documents have active requests.
                        for (let offset = 0; offset < files.files.length; offset += 8) {
                            if (routeSignal.aborted) break;
                            const batch = files.files.slice(offset, offset + 8);
                            await Promise.all(batch.map(async (path) => {
                                const outcome: Record<string, unknown> = { path, complete: false };
                                outcomes.push(outcome);
                                try {
                                    routeSignal.throwIfAborted();
                                    const maximum = 2 * 1024 * 1024;
                                    if (budget < maximum) {
                                        throw new Error("Invocation exceeds 32 MiB read budget");
                                    }
                                    budget -= maximum;
                                    const handle = await open(path, "r");
                                    let size = 0;
                                    const buffer = Buffer.alloc(maximum + 1);
                                    try {
                                        while (size < buffer.length) {
                                            routeSignal.throwIfAborted();
                                            const { bytesRead } = await handle.read(
                                                buffer,
                                                size,
                                                buffer.length - size,
                                                null,
                                            );
                                            if (!bytesRead) break;
                                            size += bytesRead;
                                        }
                                    } finally {
                                        await handle.close();
                                    }
                                    budget += maximum - Math.min(size, maximum);
                                    if (size > maximum) throw new Error("File exceeds 2 MiB");
                                    const bytes = buffer.subarray(0, size);
                                    const text = new TextDecoder("utf-8", {
                                        fatal: true,
                                        ignoreBOM: true,
                                    }).decode(bytes);
                                    routeSignal.throwIfAborted();
                                    const uri = pathToFileURL(path).href;
                                    client!.open(uri, text, languageId(path));
                                    try {
                                        Object.assign(outcome, await client!.diagnostics(uri));
                                    } finally {
                                        try {
                                            client!.closeDocument(uri);
                                        } catch (error) {
                                            packet.warnings.push(`Cleanup: ${message(error)}`);
                                        }
                                    }
                                } catch (error) {
                                    outcome.error = typedError(error);
                                }
                            }));
                        }
                        route.complete = !routeSignal.aborted && !files.limited
                            && !files.warnings.length
                            && outcomes.length === files.files.length && outcomes.every((f) =>
                                f.complete
                            );
                    }
                } catch (error) {
                    route.error = typedError(error);
                } finally {
                    if (client) {
                        try {
                            packet.warnings.push(...await client.shutdown());
                        } catch (error) {
                            packet.warnings.push(`Cleanup: ${message(error)}`);
                        }
                    }
                    deadline.dispose();
                }
                if (signal.aborted) break;
            }
            const relevant = packet.routes.filter((route) => !route.skipped);
            if (!relevant.length) {
                throw new Error("No matching files; provide paths and check configured extensions");
            }
            const complete = relevant.every((route) => route.complete === true);
            const outcomes = relevant.flatMap((route) => route.files as Record<string, unknown>[]);
            const confirmed = relevant.some((route) => route.complete === true)
                || outcomes.some((file) => file.complete === true);
            packet.status = signal.aborted
                ? "cancelled"
                : complete
                ? "success"
                : confirmed
                ? "partial"
                : "failure";
            packet.summary = {
                routes: relevant.length,
                completeRoutes: relevant.filter((r) => r.complete).length,
                files: outcomes.length,
                completeFiles: outcomes.filter((f) => f.complete).length,
                diagnostics: 0,
                errors: 0,
                warnings: 0,
                information: 0,
                hints: 0,
            };
            for (const file of outcomes) {
                for (const diagnostic of (file.diagnostics ?? []) as { severity?: number }[]) {
                    packet.summary.diagnostics++;
                    const severity = [
                        "",
                        "errors",
                        "warnings",
                        "information",
                        "hints",
                    ][diagnostic.severity ?? 0];
                    if (severity) {
                        packet.summary[severity]++;
                    }
                }
            }
        } catch (error) {
            packet.status = signal.aborted ? "cancelled" : "failure";
            packet.error = typedError(error);
        }
        if (packet.fix?.written && signal.aborted) {
            packet.warnings.push("Cancellation occurred after the file was committed");
        }
        packet.request.finishedAt = Date.now();
        return finalizeResult(packet);
    }
}
