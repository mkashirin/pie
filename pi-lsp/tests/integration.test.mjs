import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import { CONFIG_DIR_NAME, createExtensionRuntime } from "@earendil-works/pi-coding-agent";
register();
const { default: factory } = await import("../index.ts");
const { loadExtensionFromFactory } = await import(
    new URL("core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"))
);
test("headless status executes through actual loader without leaking env or initialization", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "lsp-status-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await mkdir(join(dir, CONFIG_DIR_NAME));
    await writeFile(
        join(dir, CONFIG_DIR_NAME, "pi-lsp.json"),
        JSON.stringify({
            servers: {
                statusFixture: {
                    command: [process.execPath, "--status-argv-marker"],
                    extensions: [".txt"],
                    env: { PRIVATE_TOKEN: "env-secret-marker" },
                    initialization: { token: "init-secret-marker" },
                },
            },
        }),
    );
    const runtime = createExtensionRuntime();
    const loaded = await loadExtensionFromFactory(factory, dir, {
        emit() {},
        on() {
            return () => {};
        },
    }, runtime);
    const messages = [];
    runtime.sendMessage = (message) => messages.push(message);
    const ctx = { cwd: dir, hasUI: false, isProjectTrusted: () => true };
    const command = loaded.commands.get("lsp");
    await command.handler("status", ctx);
    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /--status-argv-marker/);
    assert.doesNotMatch(messages[0].content, /env-secret-marker|init-secret-marker|PRIVATE_TOKEN/);
    await command.handler("unsupported", ctx);
    assert.match(messages[1].content, /Usage: \/lsp \[status\]/);
});
test("actual Pi factory loader registers source-native tools and status without resources", async () => {
    const runtime = createExtensionRuntime();
    const loaded = await loadExtensionFromFactory(factory, process.cwd(), {
        emit() {},
        on() {
            return () => {};
        },
    }, runtime);
    assert.equal(loaded.tools.size, 2);
    assert.ok(loaded.commands.has("lsp"));
    for (const name of ["lsp_diagnostics", "lsp_fix"]) {
        const registered = loaded.tools.get(name);
        const tool = registered.definition ?? registered;
        assert.equal(tool.namespace.name, "lsp");
        assert.ok(tool.outputSchema);
        assert.equal(tool.annotations.readOnlyHint, name === "lsp_diagnostics");
        const result = await tool.execute("invalid", { unexpected: true }, undefined, () => {}, {
            cwd: process.cwd(),
            hasUI: false,
            isProjectTrusted: () => false,
        });
        assert.equal(result.isError, true);
        assert.equal(Value.Check(tool.outputSchema, result.details), true);
    }
    for (const name of ["session_start", "session_shutdown"]) {
        assert.ok(loaded.handlers.has(name));
        for (const handler of loaded.handlers.get(name)) {
            await handler({ type: name }, { cwd: process.cwd(), hasUI: false });
        }
    }
});
