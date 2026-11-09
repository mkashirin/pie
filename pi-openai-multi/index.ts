import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
    type ExtensionAPI,
    type ExtensionContext,
    getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { credential, fold, label, Vault } from "./vault.ts";
import { bridge, managedActivity, runtime } from "./bridge.ts";
import { login } from "./oauth.ts";
import { migrate } from "./migration.ts";

export function parse(args: string): string[] {
    const tokens: string[] = [];
    let rest = args.trim();
    while (rest) {
        if (rest[0] === "\"") {
            const match = rest.match(/^"(?:[^"\\]|\\.)*"/);
            if (!match) throw Error("Invalid quoted label");
            tokens.push(JSON.parse(match[0]));
            rest = rest.slice(match[0].length);
            if (rest && !/^\s/.test(rest)) throw Error("Expected whitespace");
        } else {
            const match = rest.match(/^\S+/)!;
            tokens.push(match[0]);
            rest = rest.slice(match[0].length);
        }
        rest = rest.trimStart();
    }
    return tokens;
}
export const ENTRY = "openai-multi-account";
export function expiryStatus(expires: number): string {
    return `${expires <= Date.now() ? "expired" : "valid locally until"} ${
        new Date(expires).toISOString()
    } (local; not checked online)`;
}
const commands = [
    "add",
    "list",
    "status",
    "use",
    "clear",
    "rename",
    "reauth",
    "remove",
    "move-existing",
];
export function completion(prefix: string, accounts: { id: string; label: string }[]) {
    const space = prefix.indexOf(" ");
    if (space < 0) {
        return commands.filter((c) => c.startsWith(prefix)).map((c) => ({ value: c, label: c }));
    }
    const command = prefix.slice(0, space);
    if (!["use", "rename", "reauth", "remove"].includes(command)) return [];
    const rest = prefix.slice(space + 1).trimStart();
    return accounts.flatMap((a) => [a.label, a.id]).filter((n) =>
        fold(n).startsWith(fold(rest.replace(/^"/, "")))
    ).map((n) => ({ value: `${command} ${JSON.stringify(n)}`, label: n }));
}
export const createExtension =
    (deps: { runtime?: typeof runtime; migrate?: typeof migrate; login?: typeof login } = {}) =>
    (pi: ExtensionAPI) => {
        const authorize = deps.runtime ?? runtime;
        const migrateAccounts = deps.migrate ?? migrate;
        const loginAccount = deps.login ?? login;
        const vault = new Vault(join(getAgentDir(), "openai-multi"));
        let selected: string | undefined, busy = false, controller: AbortController | undefined;
        pi.registerFlag("openai-account", {
            description: "Explicit account label or UUID (overrides session selection)",
            type: "string",
        });
        const provider = bridge(vault, () => selected);
        pi.registerProvider(provider);
        const active = () => managedActivity(provider);
        const notify = (
            ctx: ExtensionContext,
            text: string,
            kind: "info" | "warning" | "error" = "info",
        ) => {
            ctx.ui.notify(text, kind);
        };
        const status = async (ctx: ExtensionContext) => {
            const account = (await vault.list()).find((a) => a.id === selected);
            ctx.ui.setStatus(
                "openai-multi",
                ctx.model?.provider === "openai-multi"
                    ? account
                        ? `ChatGPT: ${account.label}`
                        : "ChatGPT unavailable: /openai-accounts use <label-or-ID>"
                    : undefined,
            );
        };
        const select = async (id: string, ctx: ExtensionContext) => {
            if (!await authorize(vault, id).getAuth("openai")) throw Error("Unavailable");
            pi.appendEntry(ENTRY, { version: 1, accountId: id });
            selected = id;
            await ctx.modelRegistry.refresh({ providers: ["openai-multi"] });
            await status(ctx);
        };
        const recoveryNotice = (ctx: ExtensionContext, outcome: unknown) => {
            if (
                outcome && typeof outcome === "object" && "rolledBack" in outcome
                && Array.isArray(outcome.rolledBack) && outcome.rolledBack.length
            ) {
                notify(
                    ctx,
                    "An interrupted credential move was rolled back because native credentials changed. Retry /openai-accounts move-existing with a new label.",
                    "warning",
                );
            }
        };
        const restore = async (ctx: ExtensionContext) => {
            selected = undefined;
            try {
                const outcome: unknown = await migrateAccounts(
                    vault,
                    join(getAgentDir(), "auth.json"),
                );
                recoveryNotice(ctx, outcome);
                const flag = pi.getFlag("openai-account");
                if (typeof flag === "string") {
                    const account = (await vault.list()).find((a) =>
                        a.id === flag || fold(a.label) === fold(flag)
                    );
                    if (!account) throw Error("Unavailable");
                    selected = account.id;
                } else {
                    const saved = ctx.sessionManager.getEntries().filter((e) =>
                        e.type === "custom" && e.customType === ENTRY
                    ).at(-1);
                    if (saved?.type === "custom") {
                        const data = saved.data as { version?: unknown; accountId?: unknown };
                        if (data?.version === 1 && typeof data.accountId === "string") {
                            selected = data.accountId;
                        }
                    }
                }
                if (selected) {
                    await vault.read(async (d) => {
                        const a = d.accounts[selected!];
                        if (!a || a.pendingMove) throw Error("Unavailable");
                        credential(a.credential);
                    });
                }
            } catch {
                selected = undefined;
                notify(
                    ctx,
                    "Account unavailable. Use /openai-accounts list, then use <label-or-ID>.",
                    "warning",
                );
            }
            await ctx.modelRegistry.refresh({ providers: ["openai-multi"] }).catch(() => {
                notify(ctx, "Managed model availability could not be refreshed.", "warning");
            });
            await status(ctx).catch(() => {});
        };
        pi.on("session_start", async (_e, ctx) => restore(ctx));
        pi.on("model_select", async (_e, ctx) => {
            await status(ctx).catch(() => {});
        });
        pi.on("session_shutdown", async () => {
            controller?.abort();
            selected = undefined;
        });
        pi.registerCommand("openai-accounts", {
            description:
                "Manage explicit ChatGPT accounts: add/list/status/use/clear/rename/reauth/remove/move-existing",
            getArgumentCompletions: async (prefix) =>
                completion(prefix, await vault.list().catch(() => [])),
            handler: async (args, ctx) => {
                if (!ctx.isIdle() || active() || busy) {
                    notify(ctx, "Account management requires an idle session.", "warning");
                    return;
                }
                busy = true;
                let operation = "management";
                try {
                    let [command, ...names] = parse(args);
                    const accounts = await vault.list();
                    if (!command) {
                        if (ctx.mode !== "tui") {
                            notify(ctx, "Use /openai-accounts list, status, or use <label-or-ID>.");
                            return;
                        }
                        const choices = [
                            "Add account",
                            ...accounts.map((a) => `${a.label} (${a.id})`),
                        ];
                        const choice = await ctx.ui.select("ChatGPT accounts", choices);
                        if (!choice) return;
                        if (choice === choices[0]) {
                            command = "add";
                            const name = await ctx.ui.input("Account label");
                            if (name === undefined) return;
                            names = [name];
                        } else {
                            const account = accounts[choices.indexOf(choice) - 1];
                            const action = await ctx.ui.select(account.label, [
                                "use",
                                "reauth",
                                "rename",
                                "remove",
                            ]);
                            if (!action) return;
                            command = action;
                            names = [account.id];
                            if (action === "rename") {
                                const name = await ctx.ui.input("New label");
                                if (name === undefined) return;
                                names.push(name);
                            }
                        }
                    }
                    operation = commands.includes(command) ? command : "management";
                    if (!commands.includes(command)) throw Error("Unknown command");
                    const count = command === "rename"
                        ? 2
                        : ["add", "use", "reauth", "remove", "move-existing"].includes(command)
                        ? 1
                        : 0;
                    if (names.length !== count) throw Error("Arguments");
                    const account = accounts.find((a) =>
                        a.id === names[0] || fold(a.label) === fold(names[0] ?? "")
                    );
                    if (command === "list") {
                        notify(
                            ctx,
                            accounts.map((a) =>
                                `${a.id === selected ? "* " : ""}${
                                    JSON.stringify(a.label)
                                }  ${a.id}  ${expiryStatus(a.expires)}`
                            ).join("\n") || "No accounts. Use /openai-accounts add <label>.",
                        );
                    } else if (command === "status") {
                        const a = accounts.find((a) => a.id === selected);
                        notify(
                            ctx,
                            a
                                ? `Selected: ${JSON.stringify(a.label)} (${a.id}); ${
                                    expiryStatus(a.expires)
                                }`
                                : "No available account selected. Use /openai-accounts use <label-or-ID>.",
                        );
                    } else if (command === "clear") {
                        pi.appendEntry(ENTRY, { version: 1, accountId: null });
                        selected = undefined;
                        await ctx.modelRegistry.refresh({ providers: ["openai-multi"] });
                        await status(ctx);
                    } else if (command === "use") {
                        if (!account) throw Error("Missing");
                        await select(account.id, ctx);
                        notify(ctx, "Account selected.");
                    } else if (command === "add" || command === "reauth") {
                        if (ctx.mode !== "tui") {
                            notify(ctx, "Login requires interactive TUI mode.", "warning");
                            return;
                        }
                        if (command === "add") {
                            label(names[0]);
                            if (accounts.some((a) => fold(a.label) === fold(names[0]))) {
                                throw Error("Duplicate");
                            }
                        } else if (!account) throw Error("Missing");
                        const settings = pi.getSettings() as unknown as { deviceId?: unknown };
                        const deviceId = typeof settings.deviceId === "string"
                                && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
                                    .test(settings.deviceId)
                            ? settings.deviceId
                            : await vault.read(async (d) => d.deviceId);
                        controller = new AbortController();
                        const result = await loginAccount(ctx, deviceId, controller);
                        controller.signal.throwIfAborted();
                        credential(result);
                        await vault.transact(async (d) => {
                            const now = new Date().toISOString();
                            if (command === "reauth") {
                                const a = d.accounts[account!.id];
                                if (!a || a.pendingMove) throw Error("Missing");
                                a.credential = result;
                                a.updatedAt = now;
                            } else {
                                if (
                                    Object.values(d.accounts).some((a) =>
                                        fold(a.label) === fold(names[0])
                                    )
                                ) throw Error("Duplicate");
                                const id = randomUUID();
                                d.accounts[id] = {
                                    id,
                                    label: names[0],
                                    createdAt: now,
                                    updatedAt: now,
                                    credential: result,
                                };
                            }
                        }, controller.signal);
                        notify(
                            ctx,
                            "Credential saved. Selection unchanged; use explicitly to activate.",
                        );
                    } else if (command === "rename") {
                        if (!account) throw Error("Missing");
                        label(names[1]);
                        await vault.transact(async (d) => {
                            const a = d.accounts[account.id];
                            if (
                                !a || a.pendingMove
                                || Object.values(d.accounts).some((v) =>
                                    v.id !== a.id && fold(v.label) === fold(names[1])
                                )
                            ) throw Error("Unavailable");
                            a.label = names[1];
                            a.updatedAt = new Date().toISOString();
                        });
                        await status(ctx);
                    } else if (command === "remove") {
                        if (ctx.mode !== "tui") {
                            notify(
                                ctx,
                                "Removal requires interactive TUI confirmation.",
                                "warning",
                            );
                            return;
                        }
                        if (!account) throw Error("Missing");
                        if (
                            !await ctx.ui.confirm(
                                "Remove account?",
                                `${
                                    JSON.stringify(account.label)
                                }: removes this account for all local sessions. Other sessions using it will lose access.`,
                            )
                        ) return;
                        await vault.transact(async (d) => {
                            delete d.accounts[account.id];
                        });
                        if (selected === account.id) {
                            pi.appendEntry(ENTRY, { version: 1, accountId: null });
                            selected = undefined;
                        }
                        await ctx.modelRegistry.refresh({ providers: ["openai-multi"] });
                        await status(ctx);
                    } else if (command === "move-existing") {
                        label(names[0]);
                        if (ctx.mode !== "tui") {
                            notify(
                                ctx,
                                "Moving native credentials requires interactive TUI confirmation.",
                                "warning",
                            );
                            return;
                        }
                        if (
                            !await ctx.ui.confirm(
                                "Move native ChatGPT credential?",
                                "Close other Pi sessions first. This removes the global normal OpenAI login (the matching OAuth entry in auth.json), affecting all local sessions. Does not select it.",
                            )
                        ) return;
                        const outcome = await migrateAccounts(
                            vault,
                            join(getAgentDir(), "auth.json"),
                            names[0],
                        );
                        recoveryNotice(ctx, outcome);
                        notify(ctx, "Credential moved. Use explicitly to activate.");
                    }
                } catch {
                    notify(
                        ctx,
                        `Account ${operation} failed or was cancelled. Check arguments, account availability, and private vault permissions; selection is unchanged unless the operation completed.`,
                        "error",
                    );
                } finally {
                    busy = false;
                    controller = undefined;
                }
            },
        });
    };
export default createExtension();
