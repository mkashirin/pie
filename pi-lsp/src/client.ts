import spawn from "cross-spawn";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename } from "node:path";
import {
    CancellationTokenSource,
    createMessageConnection,
    type MessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import type {
    CodeAction,
    Command,
    Diagnostic,
    ServerCapabilities,
} from "vscode-languageserver-protocol";
import type { ChildProcess } from "node:child_process";
import type { ServerConfig } from "./config.ts";
import { effectiveEnvironment, resolveCommand } from "./command.ts";

const MAX_FRAME = 16 * 1024 * 1024;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function canonical(uri: string): string {
    try {
        return pathToFileURL(fileURLToPath(uri)).href;
    } catch {
        return uri;
    }
}
function validDiagnostics(value: unknown): value is Diagnostic[] {
    return Array.isArray(value)
        && value.every((d) =>
            d && typeof d.message === "string"
            && (d.severity === undefined || [1, 2, 3, 4].includes(d.severity))
            && (d.code === undefined || typeof d.code === "string"
                || (typeof d.code === "number" && Number.isFinite(d.code)))
            && (d.source === undefined || typeof d.source === "string")
            && (d.tags === undefined
                || (Array.isArray(d.tags) && d.tags.every((t: unknown) => t === 1 || t === 2)))
            && (d.codeDescription === undefined
                || (d.codeDescription && typeof d.codeDescription.href === "string"
                    && URL.canParse(d.codeDescription.href)))
            && (d.relatedInformation === undefined
                || (Array.isArray(d.relatedInformation) && d.relatedInformation.every((r: any) =>
                    r && typeof r.message === "string" && typeof r.location?.uri === "string"
                    && URL.canParse(r.location.uri)
                    && validDiagnostics([{ message: r.message, range: r.location.range }])
                )))
            && d.range
            && [d.range.start, d.range.end].every((p: any) =>
                p && Number.isInteger(p.line) && p.line >= 0 && Number.isInteger(p.character)
                && p.character >= 0
            )
            && (d.range.start.line < d.range.end.line
                || (d.range.start.line === d.range.end.line
                    && d.range.start.character <= d.range.end.character))
        );
}

function validEnvelope(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const message = value as Record<string, unknown>;
    const has = (key: string) => Object.hasOwn(message, key);
    const id = (value: unknown) =>
        typeof value === "string"
        || (typeof value === "number" && Number.isFinite(value));
    if (message.jsonrpc !== "2.0") return false;
    if (has("method")) {
        return typeof message.method === "string" && (!has("id") || id(message.id))
            && !has("result") && !has("error")
            && (!has("params") || (message.params !== null && typeof message.params === "object"));
    }
    if (
        !has("id") || !(id(message.id) || message.id === null)
        || has("params") || has("result") === has("error")
    ) return false;
    if (has("error")) {
        const error = message.error as Record<string, unknown> | null;
        return !!error && typeof error === "object" && !Array.isArray(error)
            && Number.isInteger(error.code) && typeof error.message === "string";
    }
    return true;
}

/** One process and one protocol session, never shared between routes. */
export class LspClient {
    private state: "NEW" | "STARTING" | "RUNNING" | "CLOSING" | "CLOSED" = "NEW";
    private startup?: Promise<void>;
    private process?: ChildProcess;
    private connection?: MessageConnection;
    private capabilities: ServerCapabilities = {};
    private publications = new Map<
        string,
        { diagnostics: Diagnostic[]; at: number; version?: number }
    >();
    private versions = new Map<string, number>();
    private warnings: string[] = [];
    private stderr = "";
    private dead = false;
    private failure?: Error;
    private failures = new Set<(error: Error) => void>();
    private fail(error: unknown) {
        this.failure ??= error instanceof Error ? error : new Error(String(error));
        for (const reject of this.failures) reject(this.failure);
    }
    private notify(method: string, params: unknown) {
        void this.connection?.sendNotification(method, params).catch((error) => this.fail(error));
    }
    private cleanup?: Promise<string[]>;
    private cancellation = new CancellationTokenSource();
    private abort = () => this.cancellation.cancel();
    constructor(private server: ServerConfig, private root: string, private signal: AbortSignal) {
        signal.addEventListener("abort", this.abort, { once: true });
        if (signal.aborted) this.abort();
    }
    private check() {
        if (this.failure) throw this.failure;
        if (this.signal.aborted) throw this.abortError();
        if (this.dead) throw new Error(`LSP server exited${this.stderr ? `: ${this.stderr}` : ""}`);
    }
    private abortError(): Error {
        const error = new Error(
            `LSP route deadline exceeded or aborted: ${String(this.signal.reason ?? "cancelled")}`,
        );
        error.name = this.signal.reason?.name === "TimeoutError" ? "TimeoutError" : "AbortError";
        return error;
    }
    private async request<T>(method: string, params?: unknown): Promise<T> {
        this.check();
        if (!this.connection) throw new Error("LSP client not started");
        // Race cancellation explicitly: servers are allowed to ignore $/cancelRequest.
        let abort!: () => void;
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => reject(this.abortError());
            this.signal.addEventListener("abort", abort, { once: true });
        });
        let rejectFailure!: (error: Error) => void;
        const failed = new Promise<never>((_, reject) => {
            rejectFailure = reject;
            this.failures.add(reject);
        });
        try {
            this.check();
            return await Promise.race([
                failed,
                this.connection.sendRequest<T>(method, params, this.cancellation.token),
                cancelled,
            ]);
        } finally {
            this.signal.removeEventListener("abort", abort);
            this.failures.delete(rejectFailure);
        }
    }
    start(): Promise<void> {
        if (this.state === "STARTING" || this.state === "RUNNING") return this.startup!;
        if (this.state !== "NEW") return Promise.reject(new Error("LSP client is closed"));
        this.state = "STARTING";
        return this.startup = this.startSession();
    }
    private async startSession(): Promise<void> {
        this.check();
        const env = effectiveEnvironment(this.server.env);
        const command = await resolveCommand(this.server.command[0], this.root, this.server.env);
        this.check();
        if (this.state !== "STARTING") throw new Error("LSP startup cancelled by shutdown");
        if (!command) throw new Error(`LSP command not found: ${this.server.command[0]}`);
        const child = this.process = spawn(command, this.server.command.slice(1), {
            cwd: this.root,
            env,
            stdio: "pipe",
        });
        const input = new PassThrough();
        // Validate framing before handing data to the maintained JSON-RPC reader.
        let buffer = Buffer.alloc(0), remaining: number | undefined;
        let headerFrame = Buffer.alloc(0);
        child.stdout!.on("data", (chunk: Buffer) => {
            try {
                buffer = Buffer.concat([buffer, chunk]);
                while (buffer.length) {
                    if (remaining === undefined) {
                        const end = buffer.indexOf("\r\n\r\n");
                        if (end < 0) {
                            if (buffer.length > 8192) throw new Error("LSP header too large");
                            break;
                        }
                        if (end > 8192) throw new Error("LSP header too large");
                        const header = buffer.subarray(0, end).toString("latin1");
                        const lengths: string[] = [];
                        for (const line of header.split("\r\n")) {
                            // Reject folding and non-ASCII/whitespace names rather than letting
                            // the scanner and the maintained reader interpret different headers.
                            const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([\t\x20-\x7e]*)$/
                                .exec(line);
                            if (!match) throw new Error("Invalid LSP header");
                            if (match[1].toLowerCase() === "content-length") {
                                lengths.push(match[2].trim());
                            }
                        }
                        if (lengths.length !== 1 || !/^[0-9]+$/.test(lengths[0])) {
                            throw new Error("Invalid LSP Content-Length");
                        }
                        remaining = Number(lengths[0]);
                        if (!Number.isSafeInteger(remaining) || remaining > MAX_FRAME) {
                            throw new Error("LSP frame exceeds 16 MiB");
                        }
                        headerFrame = Buffer.from(buffer.subarray(0, end + 4));
                        buffer = buffer.subarray(end + 4);
                    }
                    if (buffer.length < remaining) break;
                    const body = buffer.subarray(0, remaining);
                    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
                        body,
                    );
                    if (!validEnvelope(JSON.parse(text))) {
                        throw new Error("Invalid JSON-RPC protocol envelope");
                    }
                    input.write(Buffer.concat([headerFrame, body]));
                    buffer = buffer.subarray(remaining);
                    remaining = undefined;
                }
            } catch (error) {
                this.fail(new Error(`LSP protocol error: ${String(error)}`));
                this.dead = true;
                this.connection?.dispose();
                child.kill();
            }
        });
        child.stderr!.on("data", (chunk: Buffer) => {
            this.stderr = Buffer.from(this.stderr + chunk.toString()).subarray(-65536).toString();
        });
        child.on("error", (error) => {
            this.fail(new Error(`LSP process error: ${error.message}`));
            this.dead = true;
            this.connection?.dispose();
        });
        child.stdin!.on(
            "error",
            (error) => this.fail(new Error(`LSP stdin error: ${error.message}`)),
        );
        child.on("exit", (code, signal) => {
            this.fail(
                new Error(
                    `LSP server exited (code ${code}, signal ${signal})${
                        this.stderr ? `: ${this.stderr}` : ""
                    }`,
                ),
            );
            this.dead = true;
            input.end();
            this.connection?.dispose();
        });
        const connection = this.connection = createMessageConnection(
            new StreamMessageReader(input),
            new StreamMessageWriter(child.stdin!),
        );
        connection.onError((error) =>
            this.fail(new Error(`LSP protocol error: ${String(error[0])}`))
        );
        connection.onRequest(
            "workspace/configuration",
            (params: any) =>
                (params.items ?? []).map((item: any) => {
                    let value: any = this.server.initialization ?? {};
                    for (const key of (item.section ?? "").split(".").filter(Boolean)) {
                        value = value?.[key];
                    }
                    return value ?? null;
                }),
        );
        const folders = [{ uri: pathToFileURL(this.root).href, name: basename(this.root) }];
        connection.onRequest("workspace/workspaceFolders", () => folders);
        connection.onRequest("window/workDoneProgress/create", () => null);
        connection.onRequest(
            "workspace/applyEdit",
            () => ({ applied: false, failureReason: "Server-initiated edits are disabled" }),
        );
        connection.onNotification("textDocument/publishDiagnostics", (params: any) => {
            if (
                typeof params?.uri !== "string" || !validDiagnostics(params.diagnostics)
                || (params.version !== undefined && !Number.isInteger(params.version))
            ) {
                this.fail(new Error("Invalid publishDiagnostics report"));
                return;
            }
            const uri = canonical(params.uri);
            const version = this.versions.get(uri);
            if (version === undefined) return;
            if (params.version !== undefined && params.version !== version) {
                return;
            }
            this.publications.set(uri, {
                diagnostics: params.diagnostics,
                at: Date.now(),
                version: params.version,
            });
        });
        connection.listen();
        const result = await this.request<any>("initialize", {
            processId: process.pid,
            rootUri: folders[0].uri,
            workspaceFolders: folders,
            initializationOptions: this.server.initialization,
            capabilities: {
                general: { positionEncodings: ["utf-16"] },
                workspace: { configuration: true, workspaceFolders: true, applyEdit: false },
                window: { workDoneProgress: true },
                textDocument: {
                    synchronization: { dynamicRegistration: false },
                    publishDiagnostics: { versionSupport: true },
                    diagnostic: { dynamicRegistration: false },
                    codeAction: {
                        dynamicRegistration: false,
                        codeActionLiteralSupport: {
                            codeActionKind: {
                                valueSet: ["quickfix", "source.fixAll", "source.organizeImports"],
                            },
                        },
                        resolveSupport: { properties: ["edit"] },
                    },
                },
            },
        });
        if (this.state !== "STARTING") throw new Error("LSP startup cancelled by shutdown");
        this.capabilities = result.capabilities ?? {};
        if (this.capabilities.positionEncoding && this.capabilities.positionEncoding !== "utf-16") {
            throw new Error(`Unsupported position encoding: ${this.capabilities.positionEncoding}`);
        }
        this.notify("initialized", {});
        if (this.server.initialization !== undefined) {
            this.notify("workspace/didChangeConfiguration", {
                settings: this.server.initialization,
            });
        }
        this.state = "RUNNING";
    }
    open(uri: string, text: string, languageId: string): void {
        this.check();
        uri = canonical(uri);
        this.publications.delete(uri);
        this.versions.set(uri, 1);
        this.notify("textDocument/didOpen", {
            textDocument: { uri, languageId, version: 1, text },
        });
    }
    closeDocument(uri: string): void {
        uri = canonical(uri);
        if (!this.dead) {
            this.notify("textDocument/didClose", { textDocument: { uri } });
        }
        this.versions.delete(uri);
        this.publications.delete(uri);
    }
    async diagnostics(
        uri: string,
    ): Promise<{ diagnostics: Diagnostic[]; complete: boolean; warnings: string[] }> {
        uri = canonical(uri);
        const started = Date.now();
        let pulled: Diagnostic[] | undefined;
        try {
            if (this.capabilities.diagnosticProvider) {
                const report = await this.request<any>("textDocument/diagnostic", {
                    textDocument: { uri },
                });
                if (report?.kind !== "full" || !validDiagnostics(report.items)) {
                    throw new Error(
                        "Invalid initial pull diagnostics report (expected full report)",
                    );
                }
                pulled = report.items;
                if (pulled!.length) {
                    return { diagnostics: pulled!, complete: true, warnings: [...this.warnings] };
                }
            }
            const grace = pulled
                ? this.server.pullDiagnosticsGraceMs
                : this.server.pushDiagnosticsGraceMs;
            if (pulled && grace === undefined) {
                return { diagnostics: pulled, complete: true, warnings: [...this.warnings] };
            }
            const settle = this.server.diagnosticsSettleMs ?? 800;
            const waitStart = Date.now();
            while (true) {
                this.check();
                const latest = this.publications.get(uri);
                if (latest && Date.now() - latest.at >= settle) {
                    return {
                        diagnostics: latest.diagnostics,
                        complete: true,
                        warnings: [...this.warnings],
                    };
                }
                if (!latest && grace !== undefined && Date.now() - waitStart >= grace) {
                    return {
                        diagnostics: pulled ?? [],
                        complete: pulled !== undefined,
                        warnings: [
                            ...this.warnings,
                            ...(pulled === undefined
                                ? ["Server published no diagnostics before push grace expired"]
                                : []),
                        ],
                    };
                }
                await sleep(10);
            }
        } catch (error) {
            const latest = this.publications.get(uri);
            if (!this.failure && this.signal.aborted && (latest || pulled)) {
                return {
                    diagnostics: latest?.diagnostics ?? pulled!,
                    complete: false,
                    warnings: [
                        ...this.warnings,
                        `Route deadline exceeded while waiting for diagnostics (${
                            Date.now() - started
                        }ms)`,
                    ],
                };
            }
            throw error;
        }
    }
    async codeActions(
        uri: string,
        text: string,
        diagnostics: Diagnostic[],
        kind: string,
    ): Promise<(CodeAction | Command)[]> {
        const lines = text.split(/\r\n|\r|\n/);
        return await this.request<(CodeAction | Command)[] | null>("textDocument/codeAction", {
            textDocument: { uri },
            range: {
                start: { line: 0, character: 0 },
                end: { line: lines.length - 1, character: lines.at(-1)!.length },
            },
            context: { diagnostics, only: [kind], triggerKind: 1 },
        }) ?? [];
    }
    get supportsResolve(): boolean {
        const provider = this.capabilities.codeActionProvider;
        return typeof provider === "object" && provider.resolveProvider === true;
    }
    resolveAction(action: CodeAction): Promise<CodeAction> {
        return this.request("codeAction/resolve", action);
    }
    shutdown(): Promise<string[]> {
        if (!this.cleanup) {
            this.state = "CLOSING";
            this.fail(new Error("LSP client shutting down"));
            this.cleanup = this.finish();
        }
        return this.cleanup;
    }
    private async finish(): Promise<string[]> {
        await this.startup?.catch(() => {});
        this.signal.removeEventListener("abort", this.abort);
        const child = this.process;
        if (child && child.pid && child.exitCode === null && child.signalCode === null) {
            const bounded = async (operation: Promise<unknown>, label: string) => {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([
                        operation,
                        new Promise<never>((_, reject) => {
                            timer = setTimeout(() => reject(new Error(`${label} timed out`)), 500);
                        }),
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            };
            try {
                await bounded(this.connection!.sendRequest("shutdown"), "Shutdown response");
            } catch (error) {
                this.warnings.push(String(error));
            }
            try {
                await bounded(this.connection!.sendNotification("exit"), "Exit notification");
            } catch (error) {
                this.warnings.push(String(error));
            }
            const exited = () => child.exitCode !== null || child.signalCode !== null;
            const wait = async () => {
                const until = Date.now() + 500;
                while (!exited() && Date.now() < until) await sleep(10);
            };
            await wait();
            if (!exited()) {
                this.warnings.push("Server required SIGTERM");
                if (!child.kill("SIGTERM")) this.warnings.push("SIGTERM delivery failed");
                await wait();
            }
            if (!exited()) {
                this.warnings.push("Server required SIGKILL");
                if (!child.kill("SIGKILL")) this.warnings.push("SIGKILL delivery failed");
                await wait();
            }
            if (!exited()) this.warnings.push("Server exit not observed after SIGKILL");
        }
        this.connection?.dispose();
        this.cancellation.dispose();
        child?.stdin?.destroy();
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        this.state = "CLOSED";
        return [...this.warnings];
    }
}
