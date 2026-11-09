import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../vault.ts";
import { fingerprint, migrate, type MigrationPhase } from "../migration.ts";
const directory = dirname(fileURLToPath(import.meta.url));
const cred = {
    type: "oauth" as const,
    access: "fake",
    refresh: "fake-refresh",
    expires: 12345,
    clientId: "fake-client",
    scopes: ["chatgpt.tokens.use.direct"],
    future: { b: 2, a: 1 },
};
for (const phase of ["prepared", "sourceRemoved", "finalized"] as MigrationPhase[]) {
    test(`recovery after durable ${phase}`, async (t) => {
        const dir = await fs.mkdtemp(join(directory, ".migration-"));
        t.after(() => fs.rm(dir, { recursive: true, force: true }));
        await fs.chmod(dir, 0o755);
        const vault = new Vault(join(dir, "vault")), source = join(dir, "auth.json");
        await fs.writeFile(source, JSON.stringify({ openai: cred, unrelated: { key: "fake" } }), {
            mode: 0o600,
        });
        await assert.rejects(
            migrate(vault, source, "Moved", undefined, {
                phase: (p) => {
                    if (p === phase) throw Error("crash");
                },
            }),
            /crash/,
        );
        if (phase !== "finalized") assert.deepEqual(await vault.list(), []);
        await migrate(vault, source);
        assert.equal((await vault.list()).length, 1);
        assert.deepEqual(JSON.parse(await fs.readFile(source, "utf8")), {
            unrelated: { key: "fake" },
        });
        assert.equal((await fs.stat(source)).mode & 0o777, 0o600);
        await vault.read((d) => {
            const a = Object.values(d.accounts)[0];
            assert.equal(a.pendingMove, undefined);
            assert.deepEqual(a.credential, cred);
        });
    });
}
test("migration rejects writable source parents and lock directories", async (t) => {
    const dir = await fs.mkdtemp(join(directory, ".migration-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const vault = new Vault(join(dir, "vault")), source = join(dir, "auth.json");
    const original = JSON.stringify({ openai: cred });
    await fs.writeFile(source, original, { mode: 0o600 });
    await fs.chmod(dir, 0o777);
    await assert.rejects(migrate(vault, source, "Moved"), /Unsafe/);
    assert.equal(await fs.readFile(source, "utf8"), original);
    await fs.chmod(dir, 0o755);
    await fs.mkdir(source + ".lock");
    await fs.chmod(source + ".lock", 0o777);
    await assert.rejects(migrate(vault, source, "Moved"), /Unsafe/);
    assert.equal(await fs.readFile(source, "utf8"), original);
    await fs.rmdir(source + ".lock");
    await migrate(vault, source, "Moved");
    assert.equal((await vault.list()).length, 1);
});
test("changed source drops pending, canonical fingerprint ignores object key order", async (t) => {
    const dir = await fs.mkdtemp(join(directory, ".migration-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const vault = new Vault(join(dir, "vault")), source = join(dir, "auth.json");
    assert.equal(
        fingerprint({ z: 1, a: { y: 2, x: 3 } }),
        fingerprint({ a: { x: 3, y: 2 }, z: 1 }),
    );
    await fs.writeFile(source, JSON.stringify({ openai: cred }), { mode: 0o600 });
    await assert.rejects(migrate(vault, source, "Moved", undefined, {
        phase: () => {
            throw Error("crash");
        },
    }));
    await vault.read((d) => {
        assert.deepEqual(Object.values(d.accounts)[0].pendingMove, {
            sourceFingerprint: fingerprint(cred),
        });
    });
    const changed = { openai: { ...cred, refresh: "new" }, unrelated: true };
    await fs.writeFile(source, JSON.stringify(changed));
    assert.deepEqual(await migrate(vault, source), { rolledBack: ["Moved"] });
    assert.deepEqual(await migrate(vault, source), { rolledBack: [] });
    assert.deepEqual(await vault.list(), []);
    assert.deepEqual(JSON.parse(await fs.readFile(source, "utf8")), changed);
});
