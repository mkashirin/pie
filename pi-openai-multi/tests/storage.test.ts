import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { atomic, credential, locked, validate, Vault } from "../vault.ts";
import { AccountCredentials } from "../credentials.ts";
const directory = dirname(fileURLToPath(import.meta.url));
const cred = {
    type: "oauth" as const,
    access: "fake",
    refresh: "fake-refresh",
    expires: 12345,
    clientId: "fake-client",
    scopes: ["chatgpt.tokens.use.direct"],
    future: { arbitrary: true },
};
test("schema, read-only metadata and account-bound serialized refresh", async (t) => {
    const dir = await fs.mkdtemp(join(directory, ".storage-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const vault = new Vault(join(dir, "vault"));
    const id = randomUUID();
    credential(cred);
    assert.throws(() => credential({ ...cred, scopes: [] }));
    await vault.transact((d) => {
        d.accounts[id] = {
            id,
            label: "One",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            credential: cred,
        };
    });
    const before = await fs.stat(vault.path);
    assert.deepEqual(await vault.list(), [{
        id,
        label: "One",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        expires: 12345,
    }]);
    await vault.read((d) => {
        d.accounts = {};
    });
    assert.equal((await fs.stat(vault.path)).mtimeMs, before.mtimeMs);
    assert.equal((await vault.list()).length, 1);
    const store = new AccountCredentials(vault, id);
    await Promise.all([1, 2, 3].map(() =>
        store.modify("openai", async (current) => {
            assert.equal(current?.type, "oauth");
            return { ...cred, refresh: (current as typeof cred).refresh + "x" };
        })
    ));
    assert.equal((await store.read("openai"))?.refresh, "fake-refreshxxx");
    await vault.transact((d) => {
        d.accounts[id].pendingMove = { sourceFingerprint: "a".repeat(64) };
    });
    assert.equal(await store.read("openai"), undefined);
    assert.deepEqual(await vault.list(), []);
    await assert.rejects(store.modify("openai", async () => cred), /pending/);
    await store.delete("openai");
    await assert.rejects(store.modify("openai", async () => cred), /missing/);
    await vault.read((d) => {
        validate({ ...d, deviceId: "12345678-1234-7123-8123-123456789abc" });
        assert.throws(() => validate({ ...d, accounts: [] }));
    });
});
test("stale holder cannot overwrite or remove a child replacement lock and releases heartbeat", {
    timeout: 10000,
}, async (t) => {
    const dir = await fs.mkdtemp(join(directory, ".storage-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const vault = new Vault(join(dir, "vault"));
    const id = randomUUID();
    await vault.transact((d) => {
        d.accounts[id] = {
            id,
            label: "One",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            credential: cred,
        };
    });
    let child: ReturnType<typeof spawn> | undefined;
    t.after(() => child?.kill());
    await assert.rejects(
        vault.transact(async (d) => {
            const old = new Date(Date.now() - 60000);
            await fs.utimes(vault.path + ".lock", old, old);
            const code = `import { Vault, locked } from ${
                JSON.stringify(new URL("../vault.ts", import.meta.url).href)
            };
      const v = new Vault(${JSON.stringify(vault.directory)});
      await v.transact(d => { d.accounts[${
                JSON.stringify(id)
            }].credential.refresh = 'child-rotated'; });
      await locked(v.path, async () => { console.log('ready'); await new Promise(r => process.stdin.once('data', r)); });`;
            child = spawn(
                process.execPath,
                ["--import", "tsx", "--input-type=module", "-e", code],
                { stdio: ["pipe", "pipe", "inherit"] },
            );
            await once(child.stdout!, "data");
            d.accounts[id].credential.refresh = "obsolete";
        }),
        /ownership lost|stale/i,
    );
    assert.equal(
        JSON.parse(await fs.readFile(vault.path, "utf8")).accounts[id].credential.refresh,
        "child-rotated",
    );
    assert.ok((await fs.lstat(vault.path + ".lock")).isDirectory());
    // Internal lock registry also owns the heartbeat timer: release must remove it.
    const { createRequire } = await import("node:module");
    const internals = createRequire(import.meta.url)("proper-lockfile/lib/lockfile.js");
    assert.equal(internals.getLocks()[vault.path], undefined);
    const exited = once(child!, "exit");
    child!.stdin!.end("done");
    assert.deepEqual(await exited, [0, null]);
    assert.equal(await fs.lstat(vault.path + ".lock").catch(() => undefined), undefined);
});
test("same-process stale holders serialize normalized paths, abort and bound waiting", {
    timeout: 22000,
}, async (t) => {
    const dir = await fs.mkdtemp(join(directory, ".storage-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const path = join(dir, "auth.json");
    let unblock!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((r) => {
        entered = r;
    });
    const gate = new Promise<void>((r) => {
        unblock = r;
    });
    t.after(() => unblock());
    const first = locked(path, async () => {
        const old = new Date(Date.now() - 60000);
        await fs.utimes(path + ".lock", old, old);
        entered();
        await gate;
    });
    // Attach rejection handling before releasing the deliberately stale holder.
    const firstDone = assert.rejects(first, /ownership lost|stale/i);
    await ready;
    const inode = (await fs.stat(path + ".lock")).ino;
    // Test-only inspection: implementation uses only proper-lockfile's public API.
    const { createRequire } = await import("node:module");
    const internals = createRequire(import.meta.url)("proper-lockfile/lib/lockfile.js");
    const firstRegistryEntry = internals.getLocks()[path];
    assert.ok(firstRegistryEntry);
    let acquired = false;
    const controller = new AbortController();
    const aborted = locked(path, async () => {
        assert.fail("aborted waiter acquired");
    }, controller.signal);
    controller.abort();
    await assert.rejects(aborted, { name: "AbortError" });
    const timed = locked(path, async () => {
        assert.fail("timed waiter acquired");
    });
    const timedDone = assert.rejects(timed, /Timed out/);
    await timedDone;
    assert.equal((await fs.stat(path + ".lock")).ino, inode);
    const second = locked(join(dir, "unused", "..", "auth.json"), async (check) => {
        acquired = true;
        check();
        const entry = internals.getLocks()[path];
        assert.ok(entry);
        assert.notEqual(entry, firstRegistryEntry);
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(internals.getLocks()[path], entry);
        assert.notEqual(entry.released, true);
        assert.ok(entry.updateTimeout);
        check();
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(acquired, false);
    // The first heartbeat may already have detected our artificial mtime change
    // and removed its own registry entry; the local mutex must still be held.
    const old = new Date(Date.now() - 60000);
    await fs.utimes(path + ".lock", old, old);
    unblock();
    await firstDone;
    await second;
    assert.equal(acquired, true);
    assert.equal(internals.getLocks()[path], undefined);
    assert.equal(await fs.lstat(path + ".lock").catch(() => undefined), undefined);
    // Public API must remain usable after aborted/timed-out waiters and release.
    await locked(path, async (check) => check());
});
test("private files, symlinks, cancellation and atomic precommit failures", async (t) => {
    const dir = await fs.mkdtemp(join(directory, ".storage-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const vault = new Vault(join(dir, "vault"));
    await vault.list();
    assert.equal((await fs.stat(vault.path)).mode & 0o777, 0o600);
    const original = await fs.readFile(vault.path, "utf8");
    await assert.rejects(
        atomic(vault.path, "bad", () => {
            throw Error("injected");
        }),
        /injected/,
    );
    assert.equal(await fs.readFile(vault.path, "utf8"), original);
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
    assert.equal(await fs.lstat(join(dir, "unused.lock")).catch(() => undefined), undefined);
});
