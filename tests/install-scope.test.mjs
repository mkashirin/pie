import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(t) {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), "pi-install-scope-")));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const root = join(temp, "checkout with spaces");
    const bin = join(temp, "bin");
    const caller = join(temp, "unrelated project");
    const log = join(temp, "npm.json");
    for (const path of [root, bin, caller]) mkdirSync(path);
    copyFileSync(join(repository, "install.sh"), join(root, "install.sh"));
    writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
    for (const path of manifest.workspaces) {
        mkdirSync(join(root, path), { recursive: true });
        writeFileSync(join(root, path, "package.json"), "{}");
    }
    for (const path of manifest.pi.extensions) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), "");
    }
    for (const path of manifest.pi.skills) mkdirSync(join(root, path), { recursive: true });
    symlinkSync(process.execPath, join(bin, "node"));
    const stub = join(bin, "npm.mjs");
    writeFileSync(
        stub,
        `import { writeFileSync } from "node:fs";
writeFileSync(process.env.INSTALL_TEST_LOG, JSON.stringify({
    cwd: process.cwd(), args: process.argv.slice(2)
}));
process.exit(Number(process.env.INSTALL_TEST_NPM_EXIT || 0));
`,
    );
    writeFileSync(
        join(bin, "npm"),
        `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(stub)} "$@"\n`,
        {
            mode: 0o755,
        },
    );
    return {
        root,
        log,
        caller,
        setManifest(value) {
            writeFileSync(join(root, "package.json"), JSON.stringify(value));
        },
        run(args = [], env = {}) {
            return spawnSync("/bin/sh", [join(root, "install.sh"), ...args], {
                cwd: caller,
                encoding: "utf8",
                env: {
                    ...process.env,
                    PATH: `${bin}:/usr/bin:/bin`,
                    INSTALL_TEST_LOG: log,
                    ...env,
                },
            });
        },
    };
}

test("all declared extensions, workspaces, and five skills exist in this checkout", () => {
    for (const path of [...manifest.workspaces, ...manifest.pi.extensions, ...manifest.pi.skills]) {
        assert.ok(existsSync(join(repository, path)), path);
    }
    for (const name of ["onboard", "researcher", "ru-check", "ru-score", "ru-text"]) {
        assert.ok(existsSync(join(repository, "skills", name, "SKILL.md")), name);
    }
});

for (const dev of [false, true]) {
    test(`installs ${dev ? "development" : "runtime"} dependencies only in the checkout`, (t) => {
        const f = fixture(t);
        const result = f.run(dev ? ["--dev"] : [], {
            npm_config_global: "true",
            npm_config_prefix: f.caller,
        });
        assert.equal(result.status, 0, result.stderr);
        const invocation = JSON.parse(readFileSync(f.log, "utf8"));
        assert.equal(invocation.cwd, f.root);
        assert.deepEqual(invocation.args, [
            "ci",
            "--prefix",
            f.root,
            "--global=false",
            dev ? "--include=dev" : "--omit=dev",
            "--legacy-peer-deps",
        ]);
        assert.match(result.stdout, /no Pi settings were changed/);
        assert.match(result.stdout, /For skills, use the local skills path explicitly/);
        assert.equal(existsSync(join(f.caller, "node_modules")), false);
        assert.equal(existsSync(join(f.root, ".pi")), false);
    });
}

test("help does not invoke npm", (t) => {
    const f = fixture(t);
    const result = f.run(["--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /this checkout only/);
    assert.equal(existsSync(f.log), false);
});

for (const arg of ["--check", "--global", "--unknown"]) {
    test(`rejects unsupported option ${arg} without installing`, (t) => {
        const f = fixture(t);
        const result = f.run([arg]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Unknown option/);
        assert.equal(existsSync(f.log), false);
    });
}

for (const kind of ["workspaces", "extensions", "skills"]) {
    for (const escape of ["missing", "parent", "absolute", "symlink"]) {
        test(`rejects ${escape} ${kind} before npm runs`, (t) => {
            const f = fixture(t);
            const value = structuredClone(manifest);
            const paths = kind === "workspaces" ? value.workspaces : value.pi[kind];
            if (escape === "missing") paths.push("./missing");
            if (escape === "parent") paths.push("../unrelated project");
            if (escape === "absolute") paths.push(f.caller);
            if (escape === "symlink") {
                symlinkSync(f.caller, join(f.root, "external"));
                paths.push("./external");
            }
            f.setManifest(value);
            const result = f.run();
            assert.notEqual(result.status, 0);
            assert.equal(existsSync(f.log), false);
        });
    }
}

test("npm failure propagates without reporting success", (t) => {
    const f = fixture(t);
    const result = f.run([], { INSTALL_TEST_NPM_EXIT: "42" });
    assert.equal(result.status, 42, result.stderr);
    assert.doesNotMatch(result.stdout, /Dependencies installed/);
});
