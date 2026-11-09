import { defineTool, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadConfiguration } from "./src/config.ts";
import { resolveCommand } from "./src/command.ts";
import { renderResult, renderStatus, renderToolCall } from "./src/presentation.ts";
import { DiagnosticParams, FixParams, PacketSchema } from "./src/results.ts";
import { Runtime } from "./src/runtime.ts";

export default function lsp(pi: ExtensionAPI) {
    const runtime = new Runtime();
    pi.on("session_start", (_event, ctx) => {
        runtime.beginSession();
        runtime.setActivity((count) =>
            ctx.ui.setStatus("pi-lsp", count ? `LSP: ${count} active` : undefined)
        );
    });
    pi.on("session_shutdown", async () => {
        await runtime.stop();
    });
    pi.registerCommand("lsp", {
        description: "Show LSP configuration and executable availability (does not start servers)",
        handler: async (args, ctx) => {
            const lifecycle = runtime.captureLifecycle();
            let text: string;
            try {
                if (args.trim() && args.trim() !== "status") {
                    throw new Error("Usage: /lsp [status]");
                }
                const config = await loadConfiguration(
                    getAgentDir(),
                    ctx.cwd,
                    ctx.isProjectTrusted(),
                );
                const availability = await Promise.all(
                    config.servers.map(async (server) =>
                        `${server.name}: ${
                            await resolveCommand(server.command[0], ctx.cwd, server.env)
                                ? "available"
                                : "missing command (install it or update pi-lsp.json)"
                        }; argv ${JSON.stringify(server.command)}; extensions ${
                            server.extensions.join(", ")
                        }`
                    ),
                );
                text = [
                    `pi-lsp: ${config.source ?? "no configuration"}`,
                    `Project trusted: ${config.trusted}; route timeout: ${config.timeout}ms; active: ${runtime.busy}`,
                    ...availability,
                    ...config.warnings,
                ].join("\n");
            } catch (error) {
                text = `pi-lsp: ${error instanceof Error ? error.message : String(error)}`;
            }
            if (lifecycle.aborted) return;
            pi.sendMessage({ customType: "pi-lsp-status", content: text, display: true }, {
                triggerTurn: false,
            });
        },
    });
    pi.registerMessageRenderer(
        "pi-lsp-status",
        (message, options, theme) =>
            renderStatus(
                typeof message.content === "string" ? message.content : "pi-lsp status",
                options,
                theme,
            ),
    );
    const namespace = {
        name: "lsp",
        description: "Configured language-server diagnostics and safe single-file fixes",
    };
    pi.registerTool(defineTool({
        name: "lsp_diagnostics",
        label: "LSP diagnostics",
        namespace,
        description:
            "Collect diagnostics using all matching configured servers by default. Findings are successful results; incomplete collection is an error. Text is bounded to 50 KiB/2000 lines, structured output to 256 KiB; full reports use artifacts. Configured servers execute trusted code, not a sandbox.",
        promptSnippet: "Use lsp_diagnostics for configured language-server diagnostics.",
        promptGuidelines: [
            "Use lsp_diagnostics on changed files; run authoritative project tests and compiler checks as needed. Configured servers are trusted executable code, not sandboxed.",
        ],
        parameters: DiagnosticParams,
        outputSchema: PacketSchema,
        executionMode: "parallel",
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
        },
        execute: (id, args, signal, _update, ctx) => {
            runtime.setActivity((count) =>
                ctx.ui.setStatus("pi-lsp", count ? `LSP: ${count} active` : undefined)
            );
            return runtime.execute(
                "lsp_diagnostics",
                id,
                args,
                getAgentDir(),
                ctx.cwd,
                ctx.isProjectTrusted(),
                signal,
            );
        },
        renderCall: (args, theme) => renderToolCall("lsp_diagnostics", args, theme),
        renderResult: (result, options, theme) =>
            renderResult(result, { ...options, outputPad: 0 }, theme),
    }));
    pi.registerTool(defineTool({
        name: "lsp_fix",
        label: "LSP fix",
        namespace,
        description:
            "Preview or atomically write safe single-file source actions. Default preview only. Unsupported commands and cross-file actions are rejected without writing. Select one server when multiple match. Text limit 50 KiB/2000 lines; structured limit 256 KiB with full-report artifacts. Configured servers run trusted code without a sandbox.",
        promptSnippet: "Use lsp_fix to preview or apply configured single-file source fixes.",
        promptGuidelines: [
            "Use lsp_fix for configured source actions, preview first when appropriate, and run authoritative project checks after changes.",
        ],
        parameters: FixParams,
        outputSchema: PacketSchema,
        executionMode: "parallel",
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: false,
        },
        execute: (id, args, signal, _update, ctx) => {
            runtime.setActivity((count) =>
                ctx.ui.setStatus("pi-lsp", count ? `LSP: ${count} active` : undefined)
            );
            return runtime.execute(
                "lsp_fix",
                id,
                args,
                getAgentDir(),
                ctx.cwd,
                ctx.isProjectTrusted(),
                signal,
            );
        },
        renderCall: (args, theme) => renderToolCall("lsp_fix", args, theme),
        renderResult: (result, options, theme) =>
            renderResult(result, { ...options, outputPad: 0 }, theme),
    }));
}
