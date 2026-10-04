import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
    type Assignment,
    assignmentFor,
    type Capability,
    CLASSES,
    classifications,
    type Configuration,
    field,
    LEVELS,
    resolveAssignment,
    saveSettings,
    type SessionSettings,
    splitModel,
    toolList,
    validateSettings,
} from "./config.ts";
import { classify, policyDecision } from "./policy.ts";
import type { ModeState } from "./state.ts";

export const HELP =
    `/subagents on|off|status|list|models|reload\n/subagents model <agent|default> <provider/model-id|reset> [--save]\n/subagents thinking <agent|default> <level|reset> [--save]\n/subagents tools <agent> [allow <tool,...>|deny <tool,...>|inherit] [--save]\n/subagents classify <tool> <read|write|execute|delegate|control|unknown> [--save]`;
export interface CommandHost {
    pi: ExtensionAPI;
    config: () => Configuration;
    setConfig: (config: Configuration) => void;
    mode: () => ModeState;
    persist: () => void;
    refresh: () => void;
    clearConsent: () => void;
    reload: (ctx: ExtensionContext) => Promise<void>;
    busy: () => boolean;
    apply: (ctx: ExtensionContext, restoring?: boolean) => Promise<void>;
}

function role(settings: SessionSettings, name: string): Assignment {
    if (name === "default") return settings.default ??= {};
    return (settings.agents ??= {})[name] ??= {};
}

function message(host: CommandHost, text: string) {
    host.pi.sendMessage({ customType: "pi-openai-subagents-info", content: text, display: true }, {
        triggerTurn: false,
    });
}

export async function command(host: CommandHost, args: string, ctx: ExtensionCommandContext) {
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    const save = tokens.includes("--save");
    const p = tokens.filter((x) => x !== "--save");
    const [verb = "status", name, value, extra] = p;
    const config = host.config();
    const mode = host.mode();

    const requireAgent = (agent: string | undefined, allowDefault = false) => {
        if (!agent || (!config.definitions.has(agent) && !(allowDefault && agent === "default"))) {
            throw new Error("Unknown agent; use /subagents list");
        }
        return agent;
    };

    const mutating = ["on", "off", "reload", "model", "thinking", "classify"].includes(verb)
        || (verb === "tools" && value !== undefined);
    if (mutating && (!ctx.isIdle() || host.busy())) {
        throw new Error("Execution settings can change only while idle");
    }
    if (verb === "status") {
        message(
            host,
            `Orchestration ${
                mode.enabled ? "on" : "off"
            }. Specialists use isolated contexts and shared parent tools/workspace.\n${HELP}`,
        );
        return;
    }
    if (verb === "list") {
        message(
            host,
            [...config.definitions.values()].map((d) =>
                `${d.name} [${d.profile}] — ${d.description}\n  ${d.source}`
            ).join("\n"),
        );
        return;
    }
    if (verb === "models") {
        const lines: string[] = [];
        for (const d of config.definitions.values()) {
            const a = assignmentFor(config, mode.settings, d.name, ctx.model);
            try {
                const r = await resolveAssignment(config, mode.settings, d.name, ctx);
                lines.push(
                    `${d.name}: ${r.ref} (${r.modelSource}), thinking ${r.thinking} (${r.thinkingSource})${
                        r.normalization ? `; ${r.normalization}` : ""
                    }`,
                );
            } catch (error) {
                lines.push(
                    `${d.name}: ${a.ref} (${a.modelSource}), thinking ${a.thinking} — ${
                        String(error)
                    }`,
                );
            }
        }
        message(host, lines.join("\n"));
        return;
    }
    if (verb === "tools" && value === undefined) {
        const d = config.definitions.get(requireAgent(name))!;
        const active = new Set(host.pi.getActiveTools());
        const overrides = classifications(config, mode.settings);
        const lines = host.pi.getAllTools().map((t) => {
            const available = ["codemode", "deferred"].includes(t.exposure)
                || (t.exposure === "direct" && active.has(t.name))
                || (name === "orchestrator" && t.exposure === "model-only" && active.has(t.name));
            const decision = policyDecision(config, mode.settings, d, t, name !== "orchestrator");
            return `${t.name}: ${classify(t, overrides)} — ${
                !available
                    ? "not callable"
                    : decision.reason
                        ?? (decision.capability === "unknown" ? "approval required" : "allowed")
            }`;
        });
        message(
            host,
            `${name} inherits parent callable tools within the ${d.profile} ceiling.\nAllow: ${
                JSON.stringify(field(config, mode.settings, d, "allowTools"))
            }\nDeny: ${JSON.stringify(field(config, mode.settings, d, "denyTools"))}\n${
                lines.join("\n")
            }`,
        );
        return;
    }
    if (verb === "reload") {
        await host.reload(ctx);
        message(
            host,
            "Agent definitions/settings reloaded; session overrides retained, consent cleared.",
        );
        return;
    }
    if (verb === "on") {
        if (mode.enabled) {
            message(host, "Orchestration already on");
            return;
        }
        await resolveAssignment(config, mode.settings, "orchestrator", ctx);
        if (!host.pi.getActiveTools().includes("subagents_run")) {
            throw new Error(
                "subagents_run is inactive; activate it through your Pi loadout before enabling orchestration",
            );
        }
        const previous = ctx.model
            ? {
                model: `${ctx.model.provider}/${ctx.model.id}`,
                thinking: host.pi.getThinkingLevel(),
            }
            : undefined;
        await host.apply(ctx);
        mode.previous = previous;
        mode.enabled = true;
        mode.manualModel = false;
        mode.manualThinking = false;
        host.persist();
        host.refresh();
        message(
            host,
            "Orchestration on. Converse and steer normally; specialist delegation is available.",
        );
        return;
    }
    if (verb === "off") {
        if (!mode.enabled) {
            message(host, "Orchestration already off");
            return;
        }
        await host.apply(ctx, true);
        mode.enabled = false;
        mode.previous = undefined;
        mode.applied = undefined;
        host.persist();
        host.refresh();
        message(
            host,
            "Orchestration off; previous model/thinking restored where not manually changed.",
        );
        return;
    }
    const candidate = structuredClone(save ? config.user : mode.settings);
    const session = structuredClone(mode.settings);
    if (verb === "model" || verb === "thinking") {
        requireAgent(name, true);
        if (!value || extra) throw new Error(HELP);
        const key = verb === "model" ? "model" : "thinking";
        if (value === "reset") delete role(candidate, name!)[key];
        else {
            if (key === "model") splitModel(value);
            else if (!LEVELS.includes(value as ThinkingLevel)) {
                throw new Error(`Thinking levels: ${LEVELS.join(", ")}`);
            }
            Object.assign(role(candidate, name!), { [key]: value });
        }
        // Validate the requested assignment even if project/session precedence would mask a saved value.
        const validation = structuredClone(mode.settings);
        if (save) delete role(validation, name!)[key];
        const targets = name === "default" ? [...config.definitions.keys()] : [name!];
        for (const target of targets) {
            if (value !== "reset") Object.assign(role(validation, target), { [key]: value });
            else delete role(validation, name!)[key];
            const candidateConfig = save ? { ...config, user: candidate } : config;
            await resolveAssignment(
                candidateConfig,
                value === "reset" && !save ? candidate : validation,
                target,
                ctx,
                key === "thinking" && value !== "reset",
            );
        }
        if (save) delete role(session, name!)[key];
    } else if (verb === "tools") {
        requireAgent(name);
        const target = role(candidate, name!);
        if (value === "inherit" && !extra) {
            delete target.allowTools;
            delete target.denyTools;
        } else if ((value === "allow" || value === "deny") && extra && p.length === 4) {
            target[value === "allow" ? "allowTools" : "denyTools"] = toolList(extra, "tools");
        } else throw new Error(HELP);
        if (save) {
            const targetSession = role(session, name!);
            delete targetSession.allowTools;
            delete targetSession.denyTools;
        }
    } else if (verb === "classify") {
        if (!name || !CLASSES.includes(value as Capability) || extra) throw new Error(HELP);
        (candidate.classifications ??= {})[name] = value as Capability;
        if (save) delete (session.classifications ??= {})[name];
    } else throw new Error(HELP);
    validateSettings(candidate);
    if (save) {
        await saveSettings(getAgentDir(), candidate);
        host.setConfig({
            ...config,
            user: candidate,
        });
        mode.settings = session;
    } else mode.settings = candidate;
    host.clearConsent();
    if (
        mode.enabled && (verb === "model" || verb === "thinking")
        && (name === "orchestrator" || name === "default")
    ) await host.apply(ctx);
    host.persist();
    host.refresh();
    message(
        host,
        `${save ? "User default saved" : "Session override updated"}; use /subagents ${
            verb === "classify" || verb === "tools"
                ? `tools ${name === "default" ? "orchestrator" : name}`
                : "models"
        } to inspect effective precedence.`,
    );
}
