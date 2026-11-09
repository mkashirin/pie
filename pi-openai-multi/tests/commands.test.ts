import { test } from "node:test";
import assert from "node:assert/strict";
import { completion, createExtension, ENTRY, parse } from "../index.ts";
import { Vault } from "../vault.ts";

// No auth, network, or on-disk credentials: patch only the local vault prototype,
// restoring it after each serial harness invocation.
async function harness(
    run: (h: any) => Promise<void>,
    deps: Parameters<typeof createExtension>[0] = {},
) {
    const originalList = Vault.prototype.list;
    const originalRead = Vault.prototype.read;
    const originalTransact = Vault.prototype.transact;
    const id = "87e02ee4-9219-4204-89aa-e7183bd062b7";
    const account = {
        id,
        label: "Work Team",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        credential: {
            type: "oauth",
            access: "fake",
            refresh: "fake",
            expires: 1,
            clientId: "fake",
            scopes: ["chatgpt.tokens.use.direct"],
        },
    };
    const data: any = { version: 1, deviceId: id, accounts: { [id]: account } };
    Vault.prototype.list = async () =>
        Object.values(data.accounts).map((a: any) => ({
            id: a.id,
            label: a.label,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
            expires: a.credential.expires,
        }));
    Vault.prototype.read = async (fn: any) => fn(data);
    Vault.prototype.transact = async (fn: any) => fn(data, () => {});
    const events: Record<string, Function> = {},
        entries: any[] = [],
        notes: string[] = [],
        flags: Record<string, unknown> = {};
    let command: any, flagName: string;
    const pi: any = {
        registerFlag: (name: string) => {
            flagName = name;
        },
        registerProvider: () => {},
        registerCommand: (name: string, c: any) => {
            assert.equal(name, "openai-accounts");
            command = c;
        },
        on: (name: string, cb: Function) => {
            events[name] = cb;
        },
        appendEntry: (type: string, value: unknown) => entries.push({ type, value }),
        getFlag: (name: string) => flags[name],
        getSettings: () => ({}),
    };
    const refreshes: unknown[] = [];
    const ctx: any = {
        modelRegistry: {
            refresh: async (options: unknown) => {
                refreshes.push(options);
            },
        },
        mode: "rpc",
        hasUI: true,
        isIdle: () => true,
        sessionManager: { getEntries: () => [] },
        ui: {
            notify: (text: string) => notes.push(text),
            setStatus: () => {},
            confirm: () => {
                throw Error("RPC confirmation forbidden");
            },
            custom: () => {
                throw Error("RPC login forbidden");
            },
        },
    };
    try {
        createExtension({
            runtime: (() => ({ getAuth: async () => "fake" })) as any,
            migrate: (async () => ({ rolledBack: [] })) as any,
            ...deps,
        })(pi);
        await run({
            command,
            ctx,
            notes,
            entries,
            data,
            id,
            events,
            flags,
            refreshes,
            flagName: flagName!,
        });
    } finally {
        Vault.prototype.list = originalList;
        Vault.prototype.read = originalRead;
        Vault.prototype.transact = originalTransact;
    }
}
test("recovery notices are identical at startup and explicit move", async () =>
    harness(async (h) => {
        await h.events.session_start({}, h.ctx);
        const warning = h.notes.find((n: string) => /rolled back/.test(n));
        assert.ok(warning);
        h.notes.length = 0;
        h.ctx.mode = "tui";
        h.ctx.ui.confirm = async () => true;
        await h.command.handler("move-existing Native", h.ctx);
        assert.equal(h.notes[0], warning);
        assert.match(h.notes[1], /Credential moved/);
    }, { migrate: (async () => ({ rolledBack: ["fake"] })) as any }));
test("pending login guards mutations and failed reauth preserves credential and selection", async () => {
    let finish: (value: undefined) => void = () => {};
    await harness(async (h) => {
        await h.command.handler("use \"Work Team\"", h.ctx);
        const before = structuredClone(h.data);
        h.ctx.mode = "tui";
        const pending = h.command.handler("reauth \"Work Team\"", h.ctx);
        await new Promise<void>((resolve) => setImmediate(resolve));
        for (const command of ["rename \"Work Team\" Changed", "clear", "remove \"Work Team\""]) {
            await h.command.handler(command, h.ctx);
            assert.match(h.notes.at(-1), /idle/);
        }
        finish(undefined);
        await pending;
        assert.deepEqual(h.data, before);
        assert.equal(h.entries.length, 1);
        await h.command.handler("status", h.ctx);
        assert.match(h.notes.at(-1), /Selected:.*Work Team/);
    }, {
        login: (async () =>
            new Promise<undefined>((resolve) => {
                finish = resolve;
            })) as any,
    });
});
test("session shutdown aborts pending login and prevents late credential commit", async () => {
    let finish: (value: unknown) => void = () => {};
    let signal: AbortSignal | undefined;
    await harness(async (h) => {
        const before = structuredClone(h.data);
        h.ctx.mode = "tui";
        const pending = h.command.handler("add New", h.ctx);
        await new Promise<void>((resolve) => setImmediate(resolve));
        await h.events.session_shutdown({}, h.ctx);
        assert.equal(signal?.aborted, true);
        finish(h.data.accounts[h.id].credential);
        await pending;
        assert.deepEqual(h.data, before);
        assert.equal(h.entries.length, 0);
        assert.match(h.notes.at(-1), /failed or was cancelled/);
    }, {
        login: (async (_ctx: unknown, _device: unknown, controller: AbortController) => {
            signal = controller.signal;
            return new Promise((resolve) => {
                finish = resolve;
            });
        }) as any,
    });
});
test("quoted and unquoted references, malformed quoting, and completions", () => {
    assert.deepEqual(parse("use \"Work Team\""), ["use", "Work Team"]);
    assert.deepEqual(parse("use abc"), ["use", "abc"]);
    assert.throws(() => parse("use \"unterminated"));
    assert.throws(() => parse("use \"x\"suffix"));
    assert.deepEqual(completion("use \"Wo", [{ id: "abc", label: "Work Team" }])[0], {
        value: "use \"Work Team\"",
        label: "Work Team",
    });
    assert.equal(completion("use ab", [{ id: "abc", label: "Work Team" }])[0].value, "use \"abc\"");
});
test("exact command/flag and RPC metadata management without implicit selection", async () =>
    harness(async (h) => {
        assert.equal(h.flagName, "openai-account");
        await h.command.handler("list", h.ctx);
        assert.match(h.notes.at(-1), /Work Team/);
        await h.command.handler("rename \"Work Team\" Personal", h.ctx);
        assert.equal(h.data.accounts[h.id].label, "Personal");
        assert.equal(h.entries.length, 0);
        await h.command.handler("status", h.ctx);
        assert.match(h.notes.at(-1), /No available account selected/);
        await h.command.handler("clear", h.ctx);
        assert.deepEqual(h.entries, [{ type: ENTRY, value: { version: 1, accountId: null } }]);
    }));
test("RPC login/destructive operations are refused and idle guard prevents edits", async () =>
    harness(async (h) => {
        for (
            const args of [
                "add New",
                "reauth \"Work Team\"",
                "remove \"Work Team\"",
                "move-existing Native",
            ]
        ) await h.command.handler(args, h.ctx);
        assert.equal(Object.keys(h.data.accounts).length, 1);
        assert.equal(h.entries.length, 0);
        h.ctx.isIdle = () => false;
        await h.command.handler("clear", h.ctx);
        assert.equal(h.entries.length, 0);
        assert.match(h.notes.at(-1), /idle/);
    }));
test("successful use refreshes availability and clear removes selection", async () =>
    harness(async (h) => {
        await h.command.handler("use \"Work Team\"", h.ctx);
        assert.deepEqual(h.entries, [{ type: ENTRY, value: { version: 1, accountId: h.id } }]);
        assert.deepEqual(h.refreshes, [{ providers: ["openai-multi"] }]);
        await h.command.handler("status", h.ctx);
        assert.match(h.notes.at(-1), /Selected:.*Work Team/);
        await h.command.handler("clear", h.ctx);
        assert.equal(h.refreshes.length, 2);
    }));
test("startup restores physical entries, but invalid explicit flag never falls back", async () =>
    harness(async (h) => {
        h.ctx.sessionManager.getEntries =
            () => [{ type: "custom", customType: ENTRY, data: { version: 1, accountId: h.id } }];
        await h.events.session_start({}, h.ctx);
        await h.command.handler("status", h.ctx);
        assert.match(h.notes.at(-1), /Selected:/);
        h.flags["openai-account"] = "Missing";
        await h.events.session_start({}, h.ctx);
        await h.command.handler("status", h.ctx);
        assert.match(h.notes.at(-1), /No available account selected/);
        assert.equal(h.entries.length, 0);
        assert.equal(h.refreshes.length, 2);
    }));
test("invalid use and malformed commands do not persist and do not leak exceptions", async () =>
    harness(async (h) => {
        for (const args of ["use Missing", "rename", "add \"", "unknown"]) {
            await h.command.handler(args, h.ctx);
        }
        assert.equal(h.entries.length, 0);
        assert.ok(h.notes.every((n: string) => /failed or was cancelled/.test(n)));
    }));
