import {
    createMessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
const mode = process.argv[2] ?? "push";
const connection = createMessageConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
);
const diagnostic = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    message: "fixture",
    severity: 1,
};
let initialization;
let settings;
let initialized = false;
let serverRequests;
connection.onNotification("initialized", () => {
    initialized = true;
});
connection.onNotification("workspace/didChangeConfiguration", (params) => {
    settings = params.settings;
});
connection.onRequest("initialize", async (params) => {
    initialization = params;
    if (mode === "requests") {
        serverRequests = Promise.all([
            connection.sendRequest("workspace/configuration", {
                items: [{ section: "nested.value" }, { section: "missing" }, {}],
            }),
            connection.sendRequest("workspace/workspaceFolders"),
            connection.sendRequest("window/workDoneProgress/create", { token: "test" }),
            connection.sendRequest("workspace/applyEdit", { edit: { changes: {} } }),
            ...["unknown/method", "client/registerCapability"].map((method) =>
                connection.sendRequest(method, {}).catch((error) => error.code)
            ),
        ]);
    }
    if (mode === "init-delay") await new Promise((resolve) => setTimeout(resolve, 10000));
    return {
        capabilities: {
            positionEncoding: mode === "encoding" ? "utf-8" : "utf-16",
            diagnosticProvider: mode.startsWith("pull")
                ? { interFileDependencies: false, workspaceDiagnostics: false }
                : undefined,
            codeActionProvider: { resolveProvider: true },
        },
    };
});
connection.onNotification("textDocument/didOpen", ({ textDocument }) => {
    if (mode.startsWith("envelope:")) {
        const body = mode.slice("envelope:".length);
        process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        connection.sendNotification("textDocument/publishDiagnostics", {
            uri: textDocument.uri,
            diagnostics: [],
        });
    }
    if (mode.startsWith("raw:")) {
        const [, kind, fragmentation] = mode.split(":");
        const body = Buffer.from(JSON.stringify({
            jsonrpc: "2.0",
            method: "textDocument/publishDiagnostics",
            params: {
                uri: textDocument.uri,
                diagnostics: kind === "utf8-message" ? [{ ...diagnostic, message: "MARKER" }] : [],
                extra: "MARKER",
            },
        }));
        if (kind.startsWith("utf8-")) {
            const offset = kind === "utf8-message"
                ? body.indexOf("MARKER")
                : body.lastIndexOf("MARKER");
            body[offset] = 0xff;
        }
        const n = body.length;
        const headers = {
            duplicate: `Content-Length: ${n}\r\ncOnTeNt-LeNgTh: ${n}garbage`,
            reversed: `cOnTeNt-LeNgTh: ${n}garbage\r\nContent-Length: ${n}`,
            whitespace: `Content-Length: ${n}\r\nContent-Length : ${n}`,
            folded: `Content-Length: ${n}\r\n Content-Length: ${n}`,
            suffix: `Content-Length: ${n}garbage`,
        };
        const frame = Buffer.concat([
            Buffer.from(`${headers[kind] ?? `Content-Length: ${n}`}\r\n\r\n`),
            body,
        ]);
        if (fragmentation === "7") {
            let offset = 0;
            const send = () => {
                process.stdout.write(frame.subarray(offset, offset + 7));
                offset += 7;
                if (offset < frame.length) setTimeout(send, 1);
            };
            send();
        } else process.stdout.write(frame);
    }
    if (mode === "stderr") process.stderr.write("x".repeat(100000));
    if (mode === "malformed") process.stdout.write("Content-Length: 1\r\n\r\n{");
    if (mode === "oversized") process.stdout.write("Content-Length: 16777217\r\n\r\n");
    if (mode === "fragmented" || mode === "multi") {
        const body = JSON.stringify({
            jsonrpc: "2.0",
            method: "textDocument/publishDiagnostics",
            params: {
                uri: textDocument.uri.replace("test.txt", "%74est.txt"),
                diagnostics: [diagnostic],
            },
        });
        const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
        if (mode === "multi") process.stdout.write(frame + frame);
        else {
            process.stdout.write(frame.slice(0, 12));
            setTimeout(() => process.stdout.write(frame.slice(12)), 10);
        }
    }
    if (mode === "invalid-diagnostic") {
        connection.sendNotification("textDocument/publishDiagnostics", {
            uri: textDocument.uri,
            diagnostics: [{ ...diagnostic, severity: "bad" }],
        });
    }
    if (mode === "push" || mode === "pull-late" || mode === "stderr") {
        setTimeout(() =>
            connection.sendNotification("textDocument/publishDiagnostics", {
                uri: textDocument.uri,
                diagnostics: [diagnostic],
                version: 1,
            }), mode === "pull-late" ? 30 : 0);
    }
    if (mode === "empty") {
        connection.sendNotification("textDocument/publishDiagnostics", {
            uri: textDocument.uri,
            diagnostics: [],
        });
    }
    if (mode === "exit") process.exit(3);
});
connection.onRequest(
    "textDocument/diagnostic",
    () =>
        mode === "pull-unchanged"
            ? { kind: "unchanged", resultId: "unknown" }
            : { kind: "full", items: mode === "pull" ? [diagnostic] : [] },
);
connection.onRequest(
    "textDocument/codeAction",
    async (params) =>
        mode === "requests"
            ? [{
                title: JSON.stringify({
                    initialization,
                    settings,
                    initialized,
                    responses: await serverRequests,
                }),
            }]
            : mode === "range"
            ? [{ title: JSON.stringify(params.range) }]
            : [{ title: "Fix", kind: "quickfix", data: 1 }],
);
connection.onRequest("codeAction/resolve", (action) => ({ ...action, edit: { changes: {} } }));
if (mode === "stubborn") process.on("SIGTERM", () => {});
connection.onRequest("shutdown", () => mode === "stubborn" ? new Promise(() => {}) : null);
connection.onNotification("exit", () => {
    if (mode !== "stubborn") process.exit(0);
});
connection.listen();
