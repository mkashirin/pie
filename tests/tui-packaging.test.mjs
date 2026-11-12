import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const manifest = readJson("package.json");
const shared = readJson("tui/package.json");
const lock = readJson("package-lock.json");

test("seven workspaces retain exactly six Pi extension entrypoints and one Kit owner", () => {
    assert.equal(manifest.name, "pi-extensions");
    assert.equal(lock.name, manifest.name);
    assert.equal(lock.packages[""].name, manifest.name);
    assert.equal(manifest.workspaces.length, 7);
    assert.equal(manifest.pi.extensions.length, 6);
    assert.ok(!manifest.pi.extensions.some((path) => path.includes("/tui/")));
    assert.equal(shared.name, "@pi-extensions/tui");
    assert.equal(shared.version, "0.1.0");
    assert.equal(lock.packages.tui.name, shared.name);
    assert.equal(shared.private, true);
    assert.equal(shared.pi, undefined);
    assert.equal(shared.exports["."], "./src/index.ts");
    assert.equal(shared.dependencies["@narumitw/pi-tui-kit"], "0.59.0");
    assert.equal(manifest.dependencies["@narumitw/pi-tui-kit"], undefined);
    assert.deepEqual(lock.packages["node_modules/@pi-extensions/tui"], {
        resolved: "tui",
        link: true,
    });
    assert.deepEqual(lock.packages[""].workspaces, manifest.workspaces);
    for (const workspace of manifest.workspaces.filter((name) => name !== "tui")) {
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

test("source-only shared package and root bundle pack runtime sources and declarations", () => {
    const files = packedFiles("@pi-extensions/tui");
    assert.ok(files.includes("src/index.ts"));
    assert.ok(files.includes("src/interaction.ts"));
    assert.ok(files.includes("src/interaction/menu.d.ts"));
    assert.ok(files.includes("src/interaction/questionnaire.d.ts"));
    assert.ok(files.includes("LICENSE"));
    assert.equal(files.filter((path) => /^src\/interaction\/.*\.js$/u.test(path)).length, 10);
    const bundle = packedFiles();
    for (const path of files) assert.ok(bundle.includes(`tui/${path}`), path);
    for (const path of manifest.pi.extensions) assert.ok(bundle.includes(path.slice(2)), path);
    for (const workspace of manifest.workspaces) {
        assert.ok(bundle.includes(`${workspace}/package.json`), workspace);
    }
});
