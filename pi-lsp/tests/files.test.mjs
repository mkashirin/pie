import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const { resolveRoot, resolveFile, discoverFiles, languageId } = await createJiti(import.meta.url)
    .import("../src/files.ts");
const server = { name: "ts", command: ["test"], extensions: [".ts"] };
test("exact extension case, hidden directories, exclusions and traversal warnings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-lsp-discovery-"));
    try {
        const root = join(dir, "root");
        await mkdir(root);
        const excludes = [
            ".git",
            ".hg",
            ".svn",
            "node_modules",
            "vendor",
            "dist",
            "build",
            "coverage",
            ".next",
            ".nuxt",
            ".cache",
            "target",
            "__pycache__",
            ".venv",
            "venv",
            ".turbo",
            ".output",
            ".mypy_cache",
            ".ruff_cache",
            ".svelte-kit",
            ".tox",
            "out",
        ];
        for (const name of [...excludes, ".hidden"]) {
            await mkdir(join(root, name));
            await writeFile(join(root, name, "nested.ts"), "");
        }
        for (const name of ["lower.c", "upper.C", "a.ts", "suffix.d.ts"]) {
            await writeFile(join(root, name), "");
        }
        await symlink(join(root, ".hidden"), join(root, "alias"));
        await symlink(join(root, "missing"), join(root, "broken"));
        const signal = new AbortController().signal;
        const canonical = await resolveRoot(root);
        const found = await discoverFiles(root, ["."], server, 100, signal);
        assert.deepEqual(found.files.map((p) => p.slice(canonical.length + 1)), [
            ".hidden/nested.ts",
            "a.ts",
            "suffix.d.ts",
        ]);
        assert.equal(found.warnings.length, 1);
        assert.match(found.warnings[0], /Skipped.*broken.*ENOENT/);
        const cpp = { ...server, extensions: [".C"] };
        assert.deepEqual((await discoverFiles(root, ["."], cpp, 100, signal)).files, [
            join(canonical, "upper.C"),
        ]);
        await assert.rejects(discoverFiles(root, ["lower.c"], cpp, 100, signal), /Unsupported/);
        assert.deepEqual(
            (await discoverFiles(root, ["."], { ...server, extensions: [".d.ts"] }, 100, signal))
                .files,
            [],
        );
        for (
            const [extension, id] of Object.entries({
                C: "cpp",
                c: "c",
                tex: "latex",
                ex: "elixir",
                tf: "terraform",
                fs: "fsharp",
                ml: "ocaml",
                Unknown: "Unknown",
            })
        ) assert.equal(languageId(`file.${extension}`), id);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test("canonical confined discovery, excludes, deduplication, limits and abort", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-lsp-files-"));
    try {
        const root = join(dir, "root");
        await mkdir(root);
        await mkdir(join(root, "node_modules"));
        for (const file of ["a.ts", "b.ts", "note.txt", "node_modules/c.ts"]) {
            await writeFile(join(root, file), "");
        }
        await writeFile(join(dir, "outside.ts"), "");
        await symlink(join(dir, "outside.ts"), join(root, "escape.ts"));
        await symlink(root, join(root, "cycle"));
        await symlink(join(root, "a.ts"), join(root, "alias.ts"));
        const canonical = await resolveRoot(root);
        assert.equal(await resolveFile(root, "@a.ts"), join(canonical, "a.ts"));
        await assert.rejects(resolveFile(root, "../outside.ts"), /outside/);
        await assert.rejects(resolveFile(root, "escape.ts"), /escapes/);
        const signal = new AbortController().signal;
        const found = await discoverFiles(root, undefined, server, 10, signal);
        assert.deepEqual(found.files.map((p) => p.slice(canonical.length + 1)), ["a.ts", "b.ts"]);
        assert.equal(found.warnings.length, 1);
        assert.equal((await discoverFiles(root, undefined, server, 1, signal)).limited, true);
        assert.equal(
            (await discoverFiles(root, ["node_modules"], server, 10, signal)).files.length,
            1,
        );
        await assert.rejects(
            discoverFiles(root, ["note.txt"], server, 10, signal),
            /Unsupported file/,
        );
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(discoverFiles(root, undefined, server, 10, controller.signal));
        assert.equal(languageId("component.tsx"), "typescriptreact");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
