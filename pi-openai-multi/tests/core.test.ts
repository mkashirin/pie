import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { label, locked, validate, Vault } from "../vault.ts";
import { AccountCredentials } from "../credentials.ts";
import { fingerprint, migrate } from "../migration.ts";
import { bridge, managedActivity, normalize, runtime } from "../bridge.ts";
import { parse } from "../index.ts";
import { normalizeContext } from "@earendil-works/pi-ai";

const directory = dirname(fileURLToPath(import.meta.url));
const cred = {
    type: "oauth" as const,
    refresh: "fake-refresh",
    access: "fake-access",
    expires: Date.now() + 3600000,
    accountId: "fake-account",
    clientId: "fake-client",
    scopes: ["chatgpt.tokens.use.direct"],
};
async function fixture(t: { after(fn: () => Promise<void>): void }) {
    // Keep all test writes inside this package, including lock directories.
    const dir = await fs.mkdtemp(join(directory, ".fixture-"));
    await fs.chmod(dir, 0o700);
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return { dir, vault: new Vault(join(dir, "vault")) };
}
async function add(v: Vault, name = "One") {
    const id = randomUUID();
    await v.transact(async (d) => {
        d.accounts[id] = {
            id,
            label: name,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            credential: structuredClone(cred),
        };
    });
    return id;
}
test("strict schema, labels, quoting, duplicate normalized labels", async (t) => {
    assert.deepEqual(parse("rename \"a b\" \"c\\\"d\""), ["rename", "a b", "c\"d"]);
    assert.throws(() => parse("use \"broken"));
    for (const value of ["", "x\n", "x\u200b", "x".repeat(65)]) assert.throws(() => label(value));
    const { vault } = await fixture(t);
    await add(vault);
    await assert.rejects(add(vault, "ＯＮＥ"), /Duplicate/);
    const data = JSON.parse(await fs.readFile(vault.path, "utf8"));
    assert.throws(() => validate({ ...data, extra: true }));
    assert.equal((await vault.list()).length, 1);
    assert.equal((await fs.stat(vault.path)).mode & 0o777, 0o600);
});
test("serialized account-bound refresh, missing accounts cannot be recreated", async (t) => {
    const { vault } = await fixture(t);
    const id = await add(vault);
    const other = await add(vault, "Two");
    const store = new AccountCredentials(vault, id);
    await Promise.all(Array.from({ length: 4 }, () =>
        store.modify("openai", async (current) => {
            assert.equal(current?.type, "oauth");
            return { ...cred, refresh: (current as typeof cred).refresh + "x" };
        })));
    assert.equal((await store.read("openai"))?.refresh, cred.refresh + "xxxx");
    assert.deepEqual(await new AccountCredentials(vault, other).read("openai"), cred);
    assert.equal(await store.read("other"), undefined);
    await store.delete("openai");
    await assert.rejects(store.modify("openai", async () => cred), /missing/);
});
test("unsafe permissions and symlinks fail closed; abort prevents writes", async (t) => {
    const { dir, vault } = await fixture(t);
    await add(vault);
    await fs.chmod(vault.path, 0o644);
    await assert.rejects(vault.list(), /Unsafe/);
    await fs.chmod(vault.path, 0o600);
    const target = join(dir, "target");
    await fs.rename(vault.path, target);
    await fs.symlink(target, vault.path);
    await assert.rejects(vault.list(), /Unsafe/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(locked(join(dir, "unused"), async () => {}, controller.signal));
    assert.equal(await fs.stat(join(dir, "unused.lock")).catch(() => undefined), undefined);
});
test("migration moves only matching credential without selecting", async (t) => {
    const { dir, vault } = await fixture(t);
    const source = join(dir, "auth.json");
    await fs.writeFile(
        source,
        JSON.stringify({ openai: cred, unrelated: { type: "api_key", key: "fake" } }),
        { mode: 0o600 },
    );
    await migrate(vault, source, "Moved");
    assert.deepEqual(JSON.parse(await fs.readFile(source, "utf8")), {
        unrelated: { type: "api_key", key: "fake" },
    });
    const accounts = await vault.list();
    assert.equal(accounts[0].label, "Moved");
    assert.deepEqual(await new AccountCredentials(vault, accounts[0].id).read("openai"), cred);
});
for (const state of ["absent", "matching", "changed"] as const) {
    test(`migration recovery: ${state}`, async (t) => {
        const { dir, vault } = await fixture(t);
        const source = join(dir, "auth.json");
        const id = await add(vault);
        await vault.transact(async (d) => {
            d.accounts[id].pendingMove = { sourceFingerprint: fingerprint(cred) };
        });
        assert.deepEqual(await vault.list(), []);
        assert.equal(await new AccountCredentials(vault, id).read("openai"), undefined);
        await fs.writeFile(
            source,
            JSON.stringify(
                state === "absent"
                    ? {}
                    : { openai: state === "matching" ? cred : { ...cred, refresh: "changed" } },
            ),
            { mode: 0o600 },
        );
        await migrate(vault, source);
        assert.equal((await vault.list()).length, state === "changed" ? 0 : 1);
        assert.equal(
            JSON.parse(await fs.readFile(source, "utf8")).openai?.refresh,
            state === "changed" ? "changed" : undefined,
        );
    });
}
test("native auth uses bound credential without network or environment fallback", async (t) => {
    const { vault } = await fixture(t);
    const id = await add(vault);
    assert.ok(await runtime(vault, id).getAuth("openai"));
    assert.equal(await runtime(vault, randomUUID()).getAuth("openai"), undefined);
});
test("preflight leases expire lazily and abort releases activity", async (t) => {
    const factory = (() => ({
        getAuth: async () => ({ auth: { apiKey: "private-token" }, source: "test" }),
    })) as unknown as typeof runtime;
    const provider = bridge(new Vault("unused"), () => "id", factory);
    const controller = new AbortController();
    await provider.auth!.apiKey!.resolve!({ signal: controller.signal } as never);
    assert.equal(managedActivity(provider), 1);
    controller.abort();
    assert.equal(managedActivity(provider), 0);
    await provider.auth!.apiKey!.resolve!({} as never);
    assert.equal(managedActivity(provider), 1);
    const now = Date.now();
    t.mock.method(Date, "now", () => now + 30_001);
    assert.equal(managedActivity(provider), 0);
});
test("request capabilities reject duplicate, altered and aborted headers and clean their own leases", async () => {
    const factory = (() => ({
        getAuth: async () => ({ auth: { apiKey: "same-token" }, source: "test" }),
    })) as unknown as typeof runtime;
    const provider = bridge(new Vault("unused"), () => "id", factory);
    const model = provider.getModels()[0];
    const context = normalizeContext({ messages: [] });
    const first = await provider.auth!.apiKey!.resolve!({} as never);
    const second = await provider.auth!.apiKey!.resolve!({} as never);
    assert.equal(managedActivity(provider), 2);
    assert.notDeepEqual(first!.auth.headers, second!.auth.headers);
    const nonce = first!.auth.headers!["x-pi-openai-multi-request"];
    assert.throws(() =>
        provider.streamSimple(model, context, {
            apiKey: "same-token",
            headers: { ...first!.auth.headers, "X-Pi-Openai-Multi-Request": nonce },
        }), /overrides/);
    assert.equal(managedActivity(provider), 1);
    assert.throws(() =>
        provider.streamSimple(model, context, {
            ...second!.auth,
            apiKey: "changed-token",
        }), /overrides/);
    assert.equal(managedActivity(provider), 0);
    const controller = new AbortController();
    const aborted = await provider.auth!.apiKey!.resolve!({ signal: controller.signal } as never);
    controller.abort();
    assert.throws(() => provider.streamSimple(model, context, aborted!.auth), /overrides/);
    assert.equal(managedActivity(provider), 0);
});
test("bridge rejects overrides before transport; normalization preserves tool payloads", async (t) => {
    const { vault } = await fixture(t);
    const provider = bridge(vault, () => "selected");
    const model = provider.getModels()[0];
    for (
        const options of [
            { apiKey: "fake" },
            { headers: { Authorization: "fake" } },
            { transformHeaders: () => ({}) },
            { env: {} },
            { fetch: globalThis.fetch },
        ]
    ) {
        assert.throws(
            () => provider.streamSimple(model, normalizeContext({ messages: [] }), options),
            /overrides/,
        );
    }
    assert.throws(
        () =>
            provider.streamSimple(
                { ...model, baseUrl: "https://invalid.example" },
                normalizeContext({ messages: [] }),
            ),
        /overrides/,
    );
    const input = {
        messages: [{
            role: "assistant",
            provider: "openai-multi",
            content: [{
                type: "toolCall",
                arguments: { role: "assistant", provider: "openai-multi" },
            }],
        }],
    };
    const output = normalize(input, "openai-multi", "openai");
    assert.equal(output.messages[0].provider, "openai");
    assert.equal(input.messages[0].provider, "openai-multi");
    assert.equal(output.messages[0].content[0].arguments.provider, "openai-multi");
});
