import type { ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
    type Capability,
    classifications,
    type Configuration,
    type Definition,
    field,
    type Profile,
    type SessionSettings,
} from "./config.ts";

export interface Identity {
    agent: string;
    runId: string;
    definition: Definition;
    writePaths: string[];
    signal?: AbortSignal;
}
export const identity = new AsyncLocalStorage<Identity>();
const READ = new Set([
    "read",
    "grep",
    "find",
    "ls",
    "openai_search",
    "web_action",
    "lens_diagnostics",
    "symbol_search",
    "effective_config",
    "project_report",
    "module_report",
    "read_symbol",
    "read_enclosing",
    "ast_grep_search",
    "ast_grep_outline",
    "lens_diagnostic_mark",
]);
const WRITE = new Set(["edit", "write", "ast_grep_replace"]);
const EXECUTE = new Set(["bash", "powershell"]);
const DELEGATE = new Set([
    "subagents_run",
    "subagent",
    "subagents",
    "dispatch_agent",
    "spawn_agent",
]);
const CONTROL = new Set([
    "pi_lens_activate_tools",
    "tool_search",
    "plan_mode_question",
    "plan_mode_complete",
    "switch_model",
    "set_model",
    "new_session",
]);

export function hardClass(name: string): Capability | undefined {
    if (DELEGATE.has(name)) return "delegate";
    if (CONTROL.has(name)) return "control";
    if (EXECUTE.has(name)) return "execute";
    if (WRITE.has(name)) return "write";
    return undefined;
}

export function classify(
    tool: Pick<ToolInfo, "name" | "annotations">,
    overrides: Record<string, Capability>,
    args?: unknown,
): Capability {
    // Never permit reclassification of known mutation/recursion/control primitives as reads.
    const fixed = hardClass(tool.name);
    if (fixed) return fixed;
    if (tool.name === "lsp_navigation") {
        const op = (args as { operation?: string } | undefined)?.operation;
        if (["rename", "rename_file"].includes(op ?? "")) return "write";
        if (op === "executeCommand") return "execute";
        if (op === "codeAction" && (args as { apply?: boolean })?.apply) return "write";
        return "read";
    }
    if (overrides[tool.name]) return overrides[tool.name];
    if (READ.has(tool.name) || tool.annotations?.readOnlyHint === true) return "read";
    return "unknown";
}

export function ceiling(profile: Profile, capability: Capability, child: boolean): boolean {
    if (capability === "control") return false;
    if (capability === "delegate") return !child && profile === "orchestrator";
    if (capability === "write") return profile === "worker";
    if (capability === "execute") return profile === "worker" || profile === "reviewer";
    return true; // unknowns are separately approved, not silently treated as reads
}

export function policyDecision(
    config: Configuration,
    session: SessionSettings,
    definition: Definition,
    tool: ToolInfo,
    child: boolean,
    args?: unknown,
) {
    const capability = classify(tool, classifications(config, session), args);
    if (!ceiling(definition.profile, capability, child)) {
        return {
            capability,
            reason:
                `${definition.name} (${definition.profile}) cannot use ${capability} tool ${tool.name}`,
        };
    }
    const allow = field(config, session, definition, "allowTools").value;
    const deny = field(config, session, definition, "denyTools").value;
    if (deny?.includes(tool.name)) {
        return { capability, reason: `${tool.name} is denied for ${definition.name}` };
    }
    if (allow && !allow.includes(tool.name)) {
        return { capability, reason: `${tool.name} is outside ${definition.name}'s allow subset` };
    }
    return { capability, reason: undefined };
}

export function fingerprint(tool: ToolInfo): string {
    return createHash("sha256").update(
        JSON.stringify({
            name: tool.name,
            parameters: tool.parameters,
            annotations: tool.annotations,
            exposure: tool.exposure,
            description: tool.description,
            sourceInfo: tool.sourceInfo,
            namespace: tool.namespace,
            promptGuidelines: tool.promptGuidelines,
        }),
    ).digest("hex");
}

export class Consent {
    private answers = new Map<string, boolean>();
    private tail: Promise<unknown> = Promise.resolve();
    private generation = 0;

    clear() {
        this.answers.clear();
        this.generation++;
    }

    async approve(
        agent: string,
        tool: ToolInfo,
        args: unknown,
        ctx: ExtensionContext,
        signal?: AbortSignal,
    ): Promise<boolean> {
        if (!ctx.hasUI || signal?.aborted) return false;
        const generation = this.generation;
        const key = `${agent}:${fingerprint(tool)}`;

        const check = async () => {
            if (signal?.aborted || generation !== this.generation) return false;
            const cached = this.answers.get(key);
            if (cached !== undefined) return cached;
            const answer = await ctx.ui.confirm(
                `Allow unknown tool for ${agent}?`,
                `${tool.name}\n${
                    JSON.stringify(args, null, 2)
                }\n\nSide effects are unknown. Approval is a trust decision, not a sandbox, and does not bypass parent permissions.`,
                { signal },
            );
            if (signal?.aborted || generation !== this.generation) return false;
            this.answers.set(key, answer);
            return answer;
        };

        const result = this.tail.then(check, check);
        this.tail = result.catch(() => {});
        return result;
    }
}
