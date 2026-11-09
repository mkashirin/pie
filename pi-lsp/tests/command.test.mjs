import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const { resolveCommand, effectiveEnvironment } = await createJiti(import.meta.url).import(
    "../src/command.ts",
);
test("PATH, relative executables, PATHEXT shims and environment isolation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-lsp-command-"));
    try {
        await writeFile(join(dir, "tool"), "");
        await chmod(join(dir, "tool"), 0o755);
        assert.equal(await resolveCommand("tool", dir, { PATH: dir }, "linux"), join(dir, "tool"));
        assert.equal(await resolveCommand("./tool", dir, { PATH: "" }, "linux"), join(dir, "tool"));
        await writeFile(join(dir, "shim.cmd"), "");
        assert.equal(
            await resolveCommand("shim", dir, { Path: dir, PATHEXT: ".EXE;.CMD" }, "win32"),
            join(dir, "shim.cmd"),
        );
        assert.equal(await resolveCommand("missing", dir, { PATH: dir }), undefined);
        const before = process.env.PI_LSP_TEST;
        assert.equal(effectiveEnvironment({ PI_LSP_TEST: "yes" }).PI_LSP_TEST, "yes");
        assert.equal(process.env.PI_LSP_TEST, before);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
