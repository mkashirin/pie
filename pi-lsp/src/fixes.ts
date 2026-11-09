import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { open, realpath, rename, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodeAction, Command, Diagnostic, TextEdit } from "vscode-languageserver-protocol";

export interface FixClient {
    diagnostics(
        uri: string,
    ): Promise<{ diagnostics: Diagnostic[]; complete: boolean; warnings: string[] }>;
    codeActions(
        uri: string,
        text: string,
        diagnostics: Diagnostic[],
        kind: string,
    ): Promise<(CodeAction | Command)[]>;
    resolveAction(action: CodeAction): Promise<CodeAction>;
    supportsResolve: boolean;
}
export interface FixComputation {
    changed: boolean;
    kind: string;
    actions: { title: string; kind?: string }[];
    unsupportedActions: { title: string; reason: string }[];
    edits: TextEdit[];
    text: string;
    warnings: string[];
}

/** Positions are UTF-16 offsets; neither CRLF nor a surrogate pair may be split. */
export function transformEdits(
    text: string,
    edits: TextEdit[],
): { text: string; edits: TextEdit[] } {
    const lines = text.split(/\r\n|\r|\n/);
    const starts = [0];
    for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length);
    const offset = (p: { line: number; character: number }): number => {
        if (
            !p || !Number.isInteger(p.line) || !Number.isInteger(p.character) || p.line < 0
            || p.line >= lines.length || p.character < 0 || p.character > lines[p.line].length
        ) throw new Error("Invalid edit range");
        const n = starts[p.line] + p.character;
        if (n > 0 && /[\uD800-\uDBFF]/.test(text[n - 1]) && /[\uDC00-\uDFFF]/.test(text[n] ?? "")) {
            throw new Error("Edit splits UTF-16 surrogate pair");
        }
        return n;
    };
    if (!Array.isArray(edits)) throw new Error("Edits must be an array");
    const seen = new Set<string>();
    const normalized = edits.map((edit, index) => {
        if (!edit || typeof edit.newText !== "string" || !edit.range) {
            throw new Error("Invalid text edit: expected range and newText");
        }
        const start = offset(edit.range.start), end = offset(edit.range.end);
        if (end < start) throw new Error("Reversed edit range");
        return { edit, start, end, index };
    }).filter(({ edit, start, end }) => {
        const key = JSON.stringify([start, end, edit.newText]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
    for (let i = 0; i < normalized.length; i++) {
        for (let j = i + 1; j < normalized.length; j++) {
            const a = normalized[i], b = normalized[j];
            if (b.start > a.end) break;
            if (a.start === a.end && b.start === b.end) continue;
            if (b.start < a.end || a.start === b.start) throw new Error("Conflicting edits");
        }
    }
    let result = "", cursor = 0;
    for (const item of normalized) {
        result += text.slice(cursor, item.start) + item.edit.newText;
        cursor = item.end;
    }
    return { text: result + text.slice(cursor), edits: normalized.map((item) => item.edit) };
}

async function canonical(uri: string): Promise<string> {
    const url = new URL(uri);
    if (url.protocol !== "file:" || url.search || url.hash) {
        throw new Error("Only file URIs are supported");
    }
    const path = resolve(fileURLToPath(url));
    try {
        return await realpath(path);
    } catch {
        return path;
    }
}

/** LSP permits any string reason, including an empty one. */
function isDisabled(disabled: unknown): boolean {
    if (disabled === undefined) return false;
    if (
        !disabled || typeof disabled !== "object" || Array.isArray(disabled)
        || typeof (disabled as { reason?: unknown }).reason !== "string"
    ) throw new Error("Malformed disabled action: expected an object with a string reason");
    return true;
}

export async function computeFix(
    client: FixClient,
    uri: string,
    text: string,
    kind: string,
    signal: AbortSignal,
): Promise<FixComputation> {
    signal.throwIfAborted();
    if (!(kind === "source" || kind.startsWith("source."))) {
        throw new Error("Expected source action kind");
    }
    const context = await client.diagnostics(uri);
    signal.throwIfAborted();
    if (
        !context?.complete || !Array.isArray(context.diagnostics)
        || !Array.isArray(context.warnings)
    ) throw new Error("Complete diagnostic context required");
    const result: FixComputation = {
        changed: false,
        kind,
        actions: [],
        unsupportedActions: [],
        edits: [],
        text,
        warnings: [...context.warnings],
    };
    const target = await canonical(uri);
    const candidates = await client.codeActions(uri, text, context.diagnostics, kind);
    if (!Array.isArray(candidates)) throw new Error("Code actions must be an array");
    for (const candidate of candidates) {
        signal.throwIfAborted();
        if (!candidate || typeof candidate !== "object" || typeof candidate.title !== "string") {
            result.unsupportedActions.push({
                title: "Malformed action",
                reason: "Expected a code action with a string title",
            });
            continue;
        }
        if (typeof candidate.command === "string") {
            result.unsupportedActions.push({
                title: candidate.title,
                reason: "Commands are not supported; matching kind cannot be determined",
            });
            continue;
        }
        let action = candidate as CodeAction;
        try {
            if (isDisabled(action.disabled)) continue;
        } catch (error) {
            result.unsupportedActions.push({
                title: action.title,
                reason: (error as Error).message,
            });
            continue;
        }
        if (action.kind !== undefined && typeof action.kind !== "string") {
            result.unsupportedActions.push({
                title: action.title,
                reason: "Action kind must be a string",
            });
            continue;
        }
        if (!action.kind || !(action.kind === kind || action.kind.startsWith(`${kind}.`))) continue;
        try {
            if (client.supportsResolve) action = await client.resolveAction(action);
            signal.throwIfAborted();
            if (!action || typeof action !== "object" || typeof action.title !== "string") {
                throw new Error("Malformed resolved action");
            }
            if (isDisabled(action.disabled)) continue;
            if (
                typeof action.kind !== "string"
                || !(action.kind === kind || action.kind.startsWith(`${kind}.`))
            ) throw new Error("Resolved action kind changed");
            if (action.command !== undefined) throw new Error("Commands are not supported");
            const workspace = action.edit;
            if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
                throw new Error("Action has no valid workspace edit");
            }
            if (workspace.changes !== undefined && workspace.documentChanges !== undefined) {
                throw new Error(
                    "Ambiguous workspace edit: changes and documentChanges both supplied",
                );
            }
            if (
                workspace.changes !== undefined
                && (!workspace.changes || typeof workspace.changes !== "object"
                    || Array.isArray(workspace.changes))
            ) throw new Error("Workspace changes must be a URI map");
            if (
                workspace.documentChanges !== undefined && !Array.isArray(workspace.documentChanges)
            ) throw new Error("documentChanges must be an array");
            const edits: TextEdit[] = [];
            const collect = async (editUri: string, items: TextEdit[]) => {
                if (await canonical(editUri) !== target) {
                    throw new Error("Cross-file edits are not supported");
                }
                if (!Array.isArray(items)) throw new Error("Text edits must be an array");
                for (const edit of items) {
                    if (!edit || typeof edit !== "object") throw new Error("Malformed text edit");
                    if ("annotationId" in edit) {
                        throw new Error(
                            "Annotated edits are not supported (confirmation capability not advertised)",
                        );
                    }
                    edits.push(edit);
                }
            };
            for (const [editUri, items] of Object.entries(workspace.changes ?? {})) {
                await collect(editUri, items);
            }
            for (const change of workspace.documentChanges ?? []) {
                if (!change || typeof change !== "object" || !("textDocument" in change)) {
                    throw new Error("Resource operations are not supported");
                }
                if (!change.textDocument || typeof change.textDocument.uri !== "string") {
                    throw new Error("Malformed textDocument edit");
                }
                if (change.textDocument.version !== null && change.textDocument.version !== 1) {
                    throw new Error("Incompatible document version");
                }
                await collect(change.textDocument.uri, change.edits);
            }
            transformEdits(text, edits);
            result.edits.push(...edits);
            result.actions.push({ title: action.title, kind: action.kind });
        } catch (error) {
            signal.throwIfAborted();
            result.unsupportedActions.push({
                title: candidate.title,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
    signal.throwIfAborted();
    // Fail closed across the entire selection, retaining unsupported-action metadata.
    if (result.unsupportedActions.length) return { ...result, edits: [], changed: false, text };
    const transformed = transformEdits(text, result.edits);
    return { ...result, ...transformed, changed: transformed.text !== text };
}

const MAX_BYTES = 2 * 1024 * 1024;
async function readBounded(path: string): Promise<Buffer> {
    const handle = await open(path, "r");
    try {
        const bytes = Buffer.alloc(MAX_BYTES + 1);
        let size = 0;
        while (size < bytes.length) {
            const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
            if (!bytesRead) break;
            size += bytesRead;
        }
        if (size > MAX_BYTES) throw new Error("File exceeds 2 MiB");
        return bytes.subarray(0, size);
    } finally {
        await handle.close();
    }
}
export async function withSafeFile<T extends { text: string }>(
    path: string,
    write: boolean,
    signal: AbortSignal,
    operation: (text: string) => Promise<T>,
): Promise<{ value: T; written: boolean }> {
    signal.throwIfAborted();
    const absolute = resolve(path);
    const run = async () => {
        signal.throwIfAborted();
        const target = await realpath(absolute);
        const before = await stat(target);
        if (!before.isFile() || (write && before.nlink !== 1)) {
            throw new Error("Expected a regular file with one hard link for writes");
        }
        if (before.size > MAX_BYTES) throw new Error("File exceeds 2 MiB");
        const bytes = await readBounded(target);
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        signal.throwIfAborted();
        const value = await operation(text);
        signal.throwIfAborted();
        if (!write || value.text === text) return { value, written: false };
        const temp = join(dirname(target), `.pi-lsp-${randomUUID()}.tmp`);
        try {
            const handle = await open(temp, "wx", before.mode & 0o7777);
            try {
                await handle.writeFile(value.text, "utf8");
                await handle.chmod(before.mode & 0o7777);
                await handle.sync();
            } finally {
                await handle.close();
            }
            const current = await stat(target);
            if (
                await realpath(absolute) !== target || current.dev !== before.dev
                || current.ino !== before.ino || current.nlink !== 1 || current.mode !== before.mode
                || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs
                || current.size !== before.size || !(await readBounded(target)).equals(bytes)
            ) throw new Error("File changed during fix computation");
            signal.throwIfAborted();
            await rename(temp, target);
            return { value, written: true };
        } finally {
            await unlink(temp).catch(() => {});
        }
    };
    if (!write) return run();
    // Race only queue waiting. Once active, run owns cancellation so a committed
    // rename always reports written:true, even if cancellation arrives afterward.
    return new Promise((resolveResult, reject) => {
        const abort = () => reject(signal.reason ?? new Error("Fix cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        void withFileMutationQueue(absolute, async () => {
            signal.removeEventListener("abort", abort);
            return run();
        }).then(resolveResult, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}
