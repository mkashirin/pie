import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("packed sources load with offline Node WASM and copied runtime dependencies", () => {
    const temp = mkdtempSync(path.join(tmpdir(), "pi-hem-pack-"));
    try {
        const packed = JSON.parse(execFileSync("npm", [
            "pack",
            "--offline",
            "--ignore-scripts",
            "--json",
            "--pack-destination",
            temp,
        ], { cwd: root, encoding: "utf8" }))[0];
        const files = packed.files.map((file) => file.path);
        for (
            const required of [
                "index.ts",
                "src/index.ts",
                "src/regex.ts",
                "src/commands.ts",
                "src/registers.ts",
                "LICENSE",
                "THIRD_PARTY_NOTICES.md",
                "README.md",
            ]
        ) {
            assert.ok(files.includes(required), required);
        }
        assert.ok(files.every((file) => !/^(tests|node_modules)\//.test(file)));
        assert.deepEqual(files.filter((file) => file.startsWith("reference/")), [
            "reference/resolved-arguments.ts",
        ]);
        assert.ok(!files.some((file) => /(?:lock\.json|tsconfig\.json|dprint\.json)$/.test(file)));
        execFileSync("tar", ["-xzf", path.join(temp, packed.filename), "-C", temp]);
        const manifest = JSON.parse(readFileSync(path.join(temp, "package/package.json"), "utf8"));
        assert.deepEqual(manifest.dependencies, {
            "@pi-extensions/pi-kit": "0.1.0",
            rregex: "1.13.5",
        });
        assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
        const copied = new Set();
        function copyDependency(name, from) {
            const require = createRequire(from);
            const directory = require.resolve.paths(name).map((base) => path.join(base, name))
                .find((candidate) => existsSync(path.join(candidate, "package.json")));
            assert.ok(directory, `Locally installed dependency required: ${name}`);
            const source = realpathSync(directory);
            const metadata = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
            if (copied.has(name)) return;
            copied.add(name);
            const destination = path.join(temp, "node_modules", name);
            mkdirSync(path.dirname(destination), { recursive: true });
            cpSync(source, destination, { recursive: true, dereference: true });
            for (const dependency of Object.keys(metadata.dependencies ?? {})) {
                copyDependency(dependency, path.join(source, "package.json"));
            }
        }
        for (
            const name of [
                "jiti",
                ...Object.keys(manifest.dependencies),
                ...Object.keys(manifest.peerDependencies),
            ]
        ) {
            copyDependency(name, path.join(root, "package.json"));
        }
        writeFileSync(
            path.join(temp, "verify.mjs"),
            `
import assert from "node:assert/strict";
import { createJiti } from "jiti";
globalThis.fetch = () => { throw new Error("network forbidden"); };
const jiti = createJiti(import.meta.url, { fsCache: false });
const entry = await jiti.import("./package/index.ts");
assert.equal(typeof entry.default, "function");
const { findRegex } = await jiti.import("./package/src/regex.ts");
assert.deepEqual(findRegex("😀 café", "café"), [{ start: 3, end: 7 }]);
assert.deepEqual(findRegex("aa", "a"), [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
assert.throws(() => findRegex("a", "["));
console.log("packed entry and Node WASM passed");
`,
        );
        const output = execFileSync(process.execPath, [path.join(temp, "verify.mjs")], {
            cwd: temp,
            encoding: "utf8",
            env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
        });
        assert.match(output, /packed entry and Node WASM passed/);
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
});
