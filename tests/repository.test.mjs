import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJSON = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const bundle = readJSON("package.json");
const hostPeers = [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "typebox",
];

test("bundle exposes exactly the four source entry points and workspaces", () => {
    assert.deepEqual(bundle.pi.extensions, [
        "./pi-hem/index.ts",
        "./pi-openai-subagents/index.ts",
        "./pi-openai-web/index.ts",
        "./pi-plan/index.ts",
    ]);
    assert.deepEqual(
        bundle.workspaces,
        bundle.pi.extensions.map((entry) => dirname(entry).slice(2)),
    );
    for (const entry of bundle.pi.extensions) assert.ok(existsSync(resolve(root, entry)), entry);
    for (
        const name of [
            "orchestrator",
            "scout",
            "worker",
            "reviewer",
            "researcher",
            "research-validator",
        ]
    ) {
        assert.ok(existsSync(resolve(root, "pi-openai-subagents/agents", `${name}.md`)), name);
    }
});

test("one root lockfile pins all workspace releases without machine-specific links", () => {
    const lock = readJSON("package-lock.json");
    assert.equal(bundle.version, "0.1.0");
    assert.equal(lock.name, bundle.name);
    assert.equal(lock.version, bundle.version);
    assert.equal(lock.packages[""].version, bundle.version);
    for (const directory of bundle.workspaces) {
        const manifest = readJSON(`${directory}/package.json`);
        assert.equal(manifest.version, bundle.version, directory);
        assert.equal(lock.packages[directory].version, manifest.version, directory);
        assert.equal(existsSync(resolve(root, directory, "package-lock.json")), false, directory);
        assert.deepEqual(lock.packages[`node_modules/${manifest.name}`], {
            resolved: directory,
            link: true,
        });
    }
    for (const [path, metadata] of Object.entries(lock.packages)) {
        assert.ok(
            path === "" || bundle.workspaces.includes(path) || path.startsWith("node_modules/"),
            path,
        );
        if (metadata.link) {
            assert.ok(bundle.workspaces.includes(metadata.resolved), path);
            const workspace = readJSON(`${metadata.resolved}/package.json`);
            assert.equal(path, `node_modules/${workspace.name}`);
        } else if (metadata.resolved) {
            assert.ok(metadata.resolved.startsWith("https://"), path);
        }
    }
});

test("runtime dependency pins agree and development tooling is declared only at the root", () => {
    const expected = {};
    for (const directory of bundle.workspaces) {
        const child = readJSON(`${directory}/package.json`);
        assert.equal(child.devDependencies, undefined, directory);
        for (const [name, version] of Object.entries(child.dependencies ?? {})) {
            if (name in expected) assert.equal(expected[name], version, name);
            expected[name] = version;
        }
    }
    assert.deepEqual(bundle.dependencies, expected);
    const lock = readJSON("package-lock.json");
    assert.deepEqual(lock.packages[""].dependencies, bundle.dependencies);
    assert.deepEqual(lock.packages[""].devDependencies, bundle.devDependencies);
    for (const name of hostPeers) {
        assert.equal(bundle.peerDependencies[name], "*");
        assert.equal(bundle.dependencies[name], undefined);
        assert.ok(bundle.devDependencies[name], name);
        assert.equal(lock.packages[`node_modules/${name}`].dev, true, name);
    }
});
