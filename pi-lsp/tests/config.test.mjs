import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const { loadConfiguration } = await createJiti(import.meta.url).import("../src/config.ts");
test("strict timing, directory names, case preservation and canonical failclosed precedence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-lsp-validation-"));
    try {
        const source = join(dir, "pi-lsp.json");
        const entry = {
            command: ["node", ""],
            extensions: ["C", ".Mixed"],
            diagnosticsSettleMs: 0.5,
            pushDiagnosticsGraceMs: 0.5,
            pullDiagnosticsGraceMs: 0.5,
        };
        await writeFile(
            join(dir, "lsp.json"),
            JSON.stringify({ legacy: { command: ["node"], extensions: ["js"] } }),
        );
        const load = async (value) => {
            await writeFile(source, JSON.stringify(value));
            return loadConfiguration(dir, dir, false);
        };
        const valid = await load({ servers: { cpp: entry }, timeout: 0.5 });
        assert.equal(valid.timeout, 0.5);
        assert.deepEqual(valid.servers[0].extensions, [".C", ".Mixed"]);
        assert.match(valid.warnings.join("\n"), /takes precedence.*legacy/);
        for (const bad of [0, null, -1, "1"]) {
            assert.deepEqual((await load({ servers: { cpp: entry }, timeout: bad })).servers, []);
            for (
                const key of [
                    "diagnosticsSettleMs",
                    "pushDiagnosticsGraceMs",
                    "pullDiagnosticsGraceMs",
                ]
            ) {
                const result = await load({ cpp: { ...entry, [key]: bad } });
                assert.deepEqual(result.servers, []);
                assert.match(result.warnings.join("\n"), /positive finite/);
            }
        }
        for (const name of ["", " ", ".", "..", "../hidden", "/absolute", "a/b", "a\\b"]) {
            const result = await load({ cpp: { ...entry, skipDirectories: [name] } });
            assert.deepEqual(result.servers, []);
            assert.match(result.warnings.join("\n"), /directory names/);
        }
        await writeFile(source, "{");
        assert.match(
            (await loadConfiguration(dir, dir, false)).warnings.join("\n"),
            /Invalid configuration/,
        );
        await rm(source);
        await mkdir(source);
        const unreadable = await loadConfiguration(dir, dir, false);
        assert.deepEqual(unreadable.servers, []);
        assert.match(unreadable.warnings.join("\n"), /Cannot read/);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("trusted configuration belongs to cwd, not a separately selected tool root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-lsp-trust-"));
    try {
        for (const name of ["agent", "cwd", "root"]) {
            await mkdir(join(dir, name, ".pi"), { recursive: true });
        }
        for (const name of ["cwd", "root"]) {
            await writeFile(
                join(dir, name, ".pi", "pi-lsp.json"),
                JSON.stringify({ [name]: { command: ["node"], extensions: ["ts"] } }),
            );
        }
        assert.equal(
            (await loadConfiguration(join(dir, "agent"), join(dir, "cwd"), true)).servers[0].name,
            "cwd",
        );
        assert.deepEqual(
            (await loadConfiguration(join(dir, "agent"), join(dir, "cwd"), false)).servers,
            [],
        );
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("configuration precedence, trust, legacy, and failclosed validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-lsp-config-"));
    try {
        const agent = join(dir, "agent");
        await mkdir(agent);
        await mkdir(join(dir, ".pi"));
        await writeFile(
            join(agent, "lsp.json"),
            JSON.stringify({ global: { command: ["node"], extensions: ["js"] } }),
        );
        const global = await loadConfiguration(agent, dir, false);
        assert.equal(global.servers[0].name, "global");
        assert.equal(global.timeout, 20000);
        assert.equal(global.warnings.length, 1);
        await writeFile(
            join(dir, ".pi/pi-lsp.json"),
            JSON.stringify({
                servers: { local: { command: ["node"], extensions: ["ts"] } },
                timeout: 100,
            }),
        );
        assert.equal((await loadConfiguration(agent, dir, true)).servers[0].name, "local");
        assert.equal((await loadConfiguration(agent, dir, false)).servers[0].name, "global");
        await writeFile(join(dir, ".pi/pi-lsp.json"), "{");
        const invalid = await loadConfiguration(agent, dir, true);
        assert.deepEqual(invalid.servers, []);
        assert.match(invalid.warnings[0], /Invalid/);
        await writeFile(
            join(dir, ".pi/pi-lsp.json"),
            JSON.stringify({ servers: {}, catalog: true }),
        );
        assert.deepEqual((await loadConfiguration(agent, dir, true)).servers, []);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
