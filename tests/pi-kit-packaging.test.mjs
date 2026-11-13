import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const manifest = readJson("package.json");
const shared = readJson("pi-kit/package.json");
const lock = readJson("package-lock.json");

test("seven workspaces retain six Pi entrypoints and a host-only pi-kit", () => {
    assert.equal(manifest.name, "pi-extensions");
    assert.equal(lock.name, manifest.name);
    assert.equal(lock.packages[""].name, manifest.name);
    assert.equal(manifest.workspaces.length, 7);
    assert.ok(manifest.workspaces.includes("pi-kit"));
    assert.equal(manifest.pi.extensions.length, 6);
    assert.ok(!manifest.pi.extensions.some((path) => path.includes("/pi-kit/")));
    assert.equal(shared.name, "@pi-extensions/pi-kit");
    assert.equal(shared.version, "0.1.0");
    assert.equal(lock.packages["pi-kit"].name, shared.name);
    assert.equal(shared.private, true);
    assert.equal(shared.pi, undefined);
    assert.equal(shared.exports["."], "./src/index.ts");
    assert.deepEqual(shared.dependencies ?? {}, {});
    assert.equal(lock.packages["node_modules/@narumitw/pi-tui-kit"], undefined);
    for (const [path, metadata] of Object.entries(lock.packages)) {
        for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
            assert.ok(
                !Object.keys(metadata[field] ?? {}).some((name) => name.startsWith("@narumitw/")),
                `${path || "root"} ${field}: third-party Pi extension dependency`,
            );
        }
    }
    assert.deepEqual(lock.packages["node_modules/@pi-extensions/pi-kit"], {
        resolved: "pi-kit",
        link: true,
    });
    assert.deepEqual(lock.packages[""].workspaces, manifest.workspaces);
    for (const workspace of manifest.workspaces.filter((name) => name !== "pi-kit")) {
        const consumer = readJson(`${workspace}/package.json`);
        assert.equal(consumer.dependencies[shared.name], shared.version, workspace);
        assert.equal(consumer.dependencies["@narumitw/pi-tui-kit"], undefined, workspace);
        assert.equal(lock.packages[workspace].dependencies[shared.name], shared.version, workspace);
        assert.ok(manifest.pi.extensions.includes(`./${workspace}/index.ts`), workspace);
    }
});

function packedFiles(workspace) {
    const result = spawnSync("npm", [
        "pack",
        "--dry-run",
        "--json",
        "--ignore-scripts",
        "--offline",
        ...(workspace ? ["--workspace", workspace] : []),
    ], {
        cwd: fileURLToPath(root),
        encoding: "utf8",
        env: { ...process.env, npm_config_logs_max: "0" },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout)[0].files.map((file) => file.path);
}

test("source-only shared package and root bundle pack the typed runtime closure", () => {
    const files = packedFiles("@pi-extensions/pi-kit");
    assert.ok(files.includes("src/index.ts"));
    assert.ok(files.includes("src/interaction.ts"));
    for (
        const name of [
            "types",
            "lifetime",
            "editor",
            "layout",
            "menu-components",
            "menu",
            "questionnaire",
        ]
    ) {
        assert.ok(files.includes(`src/interaction/${name}.ts`), name);
    }
    assert.ok(files.includes("LICENSE"));
    assert.ok(!files.some((path) => /\.(?:js|d\.ts)$/u.test(path)));
    const bundle = packedFiles();
    for (const path of files) assert.ok(bundle.includes(`pi-kit/${path}`), path);
    for (const path of manifest.pi.extensions) assert.ok(bundle.includes(path.slice(2)), path);
    for (const workspace of manifest.workspaces) {
        assert.ok(bundle.includes(`${workspace}/package.json`), workspace);
    }
});
