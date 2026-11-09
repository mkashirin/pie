import test from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { link, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { computeFix, transformEdits, withSafeFile } from "../src/fixes.ts";
import {
    createEditTool,
    createWriteTool,
    withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
const signal = () => new AbortController().signal;
const uri = "file:///tmp/pi-fix-validation";
const clientFor = (actions) => ({
    supportsResolve: false,
    diagnostics: async () => ({ complete: true, diagnostics: [], warnings: [] }),
    codeActions: async () => actions,
    resolveAction: async (a) => a,
});
test("unsafe selections fail closed, including malformed and ambiguous edits", async () => {
    const good = {
        title: "good",
        kind: "source.fixAll",
        edit: { changes: { [uri]: [edit(0, 1, "b")] } },
    };
    const unsafe = [
        { title: "command", command: "execute" },
        {
            title: "resource",
            kind: "source.fixAll",
            edit: { documentChanges: [{ kind: "delete", uri }] },
        },
        {
            title: "crossfile",
            kind: "source.fixAll",
            edit: { changes: { "file:///tmp/elsewhere": [edit(0, 1, "x")] } },
        },
        ...[undefined, 0, 2].map((version) => ({
            title: "version",
            kind: "source.fixAll",
            edit: {
                documentChanges: [{ textDocument: { uri, version }, edits: [edit(0, 1, "x")] }],
            },
        })),
        ...["missing", "known"].map((annotationId) => ({
            title: "annotation",
            kind: "source.fixAll",
            edit: {
                changes: { [uri]: [{ ...edit(0, 1, "x"), annotationId }] },
                changeAnnotations: { known: { label: "label", needsConfirmation: false } },
            },
        })),
        { title: "ambiguous", kind: "source.fixAll", edit: { changes: {}, documentChanges: [] } },
        { title: "malformed", kind: "source.fixAll", edit: { changes: { [uri]: null } } },
        { title: "malformed", kind: 42 },
        null,
    ];
    for (const bad of unsafe) {
        const result = await computeFix(
            clientFor([good, bad]),
            uri,
            "a",
            "source.fixAll",
            signal(),
        );
        assert.equal(result.text, "a");
        assert.equal(result.changed, false);
        assert.deepEqual(result.edits, []);
        assert.equal(result.unsupportedActions.length, 1);
    }
    for (const version of [null, 1]) {
        const result = await computeFix(
            clientFor([{
                title: "valid",
                kind: "source.fixAll",
                edit: {
                    documentChanges: [{ textDocument: { uri, version }, edits: [edit(0, 1, "x")] }],
                },
            }]),
            uri,
            "a",
            "source.fixAll",
            signal(),
        );
        assert.equal(result.text, "x");
    }
});
test("filter before resolve, skip disabled after resolve, reject malformed resolution", async () => {
    let calls = 0;
    const client = clientFor([
        { title: "disabled", kind: "source.fixAll", disabled: { reason: "no" } },
        { title: "other", kind: "quickfix" },
        { title: "selected", kind: "source.fixAll" },
    ]);
    client.supportsResolve = true;
    client.resolveAction = async (a) => {
        calls++;
        return { ...a, disabled: { reason: "resolved disabled" } };
    };
    assert.equal((await computeFix(client, uri, "a", "source.fixAll", signal())).changed, false);
    assert.equal(calls, 1);
    client.resolveAction = async () => null;
    assert.equal(
        (await computeFix(client, uri, "a", "source.fixAll", signal())).unsupportedActions.length,
        1,
    );
});
test("malformed disabled fields fail closed before and after resolution, including writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-disabled-"));
    try {
        const path = join(dir, "file");
        await writeFile(path, "a");
        const fileUri = pathToFileURL(path).href;
        const good = {
            title: "good",
            kind: "source.fixAll",
            edit: { changes: { [fileUri]: [edit(0, 1, "b")] } },
        };
        const unsafe = {
            title: "unsafe",
            kind: "source.fixAll",
            edit: { documentChanges: [{ kind: "delete", uri: fileUri }] },
        };
        for (const disabled of ["malformed", true, false, null, [], {}, { reason: 42 }]) {
            for (const resolved of [false, true]) {
                const client = clientFor([good, resolved ? unsafe : { ...unsafe, disabled }]);
                client.supportsResolve = resolved;
                client.resolveAction = async (action) =>
                    action.title === "unsafe" ? { ...action, disabled } : action;
                const result = await withSafeFile(
                    path,
                    true,
                    signal(),
                    (text) => computeFix(client, fileUri, text, "source.fixAll", signal()),
                );
                assert.equal(result.value.unsupportedActions.length, 1);
                assert.match(result.value.unsupportedActions[0].reason, /disabled/);
                assert.equal(result.value.changed, false);
                assert.deepEqual(result.value.edits, []);
                assert.equal(result.value.text, "a");
                assert.equal(result.written, false);
                assert.equal(await readFile(path, "utf8"), "a");
            }
        }
        for (const reason of ["intentionally disabled", ""]) {
            const result = await computeFix(
                clientFor([good, { ...unsafe, disabled: { reason } }]),
                fileUri,
                "a",
                "source.fixAll",
                signal(),
            );
            assert.equal(result.text, "b");
            assert.deepEqual(result.unsupportedActions, []);
        }
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("cancellation immediately after rename preserves the committed result", () => {
    // Isolate the built-in monkeypatch so other tests never observe it.
    execFileSync(process.execPath, [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `
        import assert from "node:assert/strict";
        import fs from "node:fs";
        import { syncBuiltinESMExports } from "node:module";
        import { tmpdir } from "node:os";
        import { join } from "node:path";
        const controller = new AbortController();
        const rename = fs.promises.rename;
        fs.promises.rename = async (...args) => {
            await rename(...args);
            controller.abort();
        };
        syncBuiltinESMExports();
        const { withSafeFile } = await import(${
            JSON.stringify(new URL("../src/fixes.ts", import.meta.url).href)
        });
        const dir = await fs.promises.mkdtemp(join(tmpdir(), "pi-postrename-"));
        try {
            const path = join(dir, "file");
            await fs.promises.writeFile(path, "a");
            const result = await withSafeFile(path, true, controller.signal, async () => ({ text: "b" }));
            assert.equal(controller.signal.aborted, true);
            assert.equal(result.written, true);
            assert.equal(await fs.promises.readFile(path, "utf8"), "b");
        } finally {
            fs.promises.rename = rename;
            syncBuiltinESMExports();
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    `,
    ], { stdio: "pipe", timeout: 10000 });
});
test("hardlink preview allowed, writes and invalid UTF8 refused; queued abort is prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-fix-safety-"));
    try {
        const path = join(dir, "file");
        await writeFile(path, "a");
        await link(path, join(dir, "hardlink"));
        assert.equal(
            (await withSafeFile(path, false, signal(), async () => ({ text: "b" }))).written,
            false,
        );
        await assert.rejects(
            withSafeFile(path, true, signal(), async () => ({ text: "b" })),
            /hard link/,
        );
        await writeFile(path, Buffer.from([0xff]));
        await assert.rejects(
            withSafeFile(path, false, signal(), async () => ({ text: "b" })),
            /encoded data/,
        );
        const queuedPath = join(dir, "queued");
        await writeFile(queuedPath, "a");
        let release;
        let started;
        const ready = new Promise((r) => started = r);
        const gate = new Promise((r) => release = r);
        const blocker = withFileMutationQueue(queuedPath, async () => {
            started();
            await gate;
        });
        await ready;
        let computed = false;
        const controller = new AbortController();
        const pending = withSafeFile(queuedPath, true, controller.signal, async () => {
            computed = true;
            return { text: "b" };
        });
        controller.abort();
        try {
            await Promise.race([
                assert.rejects(pending),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("abort did not reject promptly")), 200)
                ),
            ]);
        } finally {
            release();
            await blocker;
        }
        await withFileMutationQueue(queuedPath, async () => {});
        assert.equal(computed, false);
        assert.equal(await readFile(queuedPath, "utf8"), "a");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
const edit = (a, b, newText) => ({
    range: { start: { line: 0, character: a }, end: { line: 0, character: b } },
    newText,
});
test("UTF16 ranges, BOM, CRLF, deduplication, stable inserts and conflicts", () => {
    assert.equal(
        transformEdits("\uFEFF😀\r\nx", [edit(3, 3, "a"), edit(3, 3, "b"), edit(3, 3, "a")]).text,
        "\uFEFF😀ab\r\nx",
    );
    assert.throws(() => transformEdits("😀", [edit(1, 2, "x")]));
    assert.throws(() => transformEdits("a\r\n", [edit(2, 2, "x")]));
    assert.throws(() => transformEdits("abc", [edit(0, 2, "x"), edit(1, 3, "y")]));
});
test("complete diagnostics and atomic rejection of cross-file actions", async () => {
    const uri = "file:///tmp/pi-fix-test";
    const client = {
        supportsResolve: true,
        diagnostics: async () => ({ complete: true, diagnostics: [], warnings: [] }),
        resolveAction: async (a) => a,
        codeActions: async () => [
            {
                title: "ok",
                kind: "source.fixAll.test",
                edit: { changes: { [uri]: [edit(0, 1, "b")] } },
            },
            {
                title: "unsafe",
                kind: "source.fixAll",
                edit: {
                    changes: { [uri]: [edit(0, 1, "c")], "file:///tmp/other": [edit(0, 0, "x")] },
                },
            },
        ],
    };
    const result = await computeFix(client, uri, "a", "source.fixAll", signal());
    assert.equal(result.text, "a");
    assert.equal(result.changed, false);
    assert.deepEqual(result.edits, []);
    assert.equal(result.unsupportedActions.length, 1);
    client.diagnostics = async () => ({ complete: false, diagnostics: [], warnings: [] });
    await assert.rejects(computeFix(client, uri, "a", "source.fixAll", signal()));
});
test("safe writer shares actual Pi write/edit queue through symlink aliases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-fixes-"));
    try {
        const path = join(dir, "file");
        const alias = join(dir, "alias");
        await writeFile(path, "a", { mode: 0o640 });
        await symlink(path, alias);
        let started;
        const ready = new Promise((r) => started = r);
        let release;
        const wait = new Promise((r) => release = r);
        const first = withSafeFile(alias, true, signal(), async (text) => {
            started();
            await wait;
            return { text: text + "b" };
        });
        await ready;
        const toolWrite = createWriteTool(dir).execute("write", { path, content: "c" }, signal());
        release();
        assert.equal((await first).written, true);
        await toolWrite;
        await createEditTool(dir).execute("edit", {
            path: alias,
            edits: [{ oldText: "c", newText: "d" }],
        }, signal());
        assert.equal(await readFile(path, "utf8"), "d");
        assert.equal((await stat(path)).mode & 0o777, 0o640);
        await assert.rejects(
            withSafeFile(path, true, signal(), async () => {
                await writeFile(path, "external");
                return { text: "lost" };
            }),
            /changed/,
        );
        const controller = new AbortController();
        await assert.rejects(withSafeFile(path, true, controller.signal, async () => {
            controller.abort();
            return { text: "cancelled" };
        }));
        assert.equal(await readFile(path, "utf8"), "external");
        await withSafeFile(path, false, signal(), async () => ({ text: "preview" }));
        assert.equal(await readFile(path, "utf8"), "external");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
