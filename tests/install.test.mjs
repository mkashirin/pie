import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const installer = join(root, "install.sh");
const options = { skip: process.platform === "win32" };

function run(t, args, exitCode = 0) {
    const directory = mkdtempSync(join(tmpdir(), "pi-installer-test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const log = join(directory, "calls.log");
    writeFileSync(log, "");
    writeFileSync(
        join(directory, "npm"),
        [
            "#!/bin/sh",
            "printf \"%s\\n\" \"$PWD\" \"$*\" >> \"$INSTALL_TEST_LOG\"",
            "exit \"$INSTALL_TEST_EXIT\"",
            "",
        ].join("\n"),
        { mode: 0o755 },
    );
    const result = spawnSync("sh", [installer, ...args], {
        cwd: directory,
        encoding: "utf8",
        env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            INSTALL_TEST_LOG: log,
            INSTALL_TEST_EXIT: String(exitCode),
        },
    });
    if (result.error) throw result.error;
    const lines = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    const commands = [];
    for (let i = 0; i < lines.length; i += 2) {
        assert.equal(realpathSync(lines[i]), realpathSync(root));
        commands.push(lines[i + 1]);
    }
    return { ...result, commands };
}

test("installer defaults to locked runtime-only installation from any cwd", options, (t) => {
    const result = run(t, []);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.commands, ["ci --omit=dev --legacy-peer-deps"]);
    assert.match(result.stdout, /Start Pi or use \/reload/);
});

test("installer development and verification are explicit opt-ins", options, (t) => {
    const dev = run(t, ["--dev"]);
    assert.equal(dev.status, 0, dev.stderr);
    assert.deepEqual(dev.commands, ["ci --include=dev --legacy-peer-deps"]);
    const checked = run(t, ["--check"]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.deepEqual(checked.commands, [
        "ci --include=dev --legacy-peer-deps",
        "run check",
        "run smoke",
    ]);
});

test("installer help and invalid options never install anything", options, (t) => {
    const help = run(t, ["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);
    assert.deepEqual(help.commands, []);
    const invalid = run(t, ["--unknown"]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Unknown option/);
    assert.deepEqual(invalid.commands, []);
});

test("installer stops and propagates an installation failure", options, (t) => {
    const result = run(t, ["--check"], 37);
    assert.equal(result.status, 37);
    assert.deepEqual(result.commands, ["ci --include=dev --legacy-peer-deps"]);
    assert.doesNotMatch(result.stdout, /Installed/);
});
