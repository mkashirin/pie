import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const hostEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const { DefaultPackageManager, SettingsManager, ExtensionRunner, SessionManager } = await import(
    hostEntry
);
const { loadExtensions } = await import(new URL("./core/extensions/loader.js", hostEntry).href);
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run npm run smoke after npm run setup:dev.");
const temporary = mkdtempSync(join(tmpdir(), "pi-extensions-smoke-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const webEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.startsWith("PI_OPENAI_WEB_")),
);
for (const name of Object.keys(webEnvironment)) delete process.env[name];
process.env.PI_OPENAI_WEB_ENABLED = "true";

async function verify(checkout, agentDir) {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const manager = new DefaultPackageManager({
        cwd: join(temporary, "project"),
        agentDir,
        settingsManager: SettingsManager.inMemory(),
    });
    const discovered = await manager.resolve();
    const expected = manifest.pi.extensions.map((entry) => resolve(checkout, entry)).sort();
    assert.deepEqual(
        discovered.extensions.filter((entry) => entry.enabled).map((entry) => entry.path).sort(),
        expected,
    );
    const registered = await manager.resolveExtensionSources([checkout], { temporary: true });
    assert.deepEqual(registered.extensions.map((entry) => entry.path).sort(), expected);
    const loaded = await loadExtensions(expected, join(temporary, "project"));
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 4);
    const runner = new ExtensionRunner(
        loaded.extensions,
        loaded.runtime,
        join(temporary, "project"),
        SessionManager.inMemory(join(temporary, "project")),
        {
            find: () => undefined,
            getAvailable: () => [],
            hasConfiguredAuth: () => false,
            streamSimple: () => {
                throw new Error("Model networking is forbidden in the smoke test.");
            },
            getApiKeyAndHeaders: async () => ({
                ok: false,
                error: "Smoke test has no credentials.",
            }),
        },
    );
    const errors = [];
    runner.onError((error) => errors.push(error));
    try {
        await runner.emit({ type: "session_start", reason: "startup" });
        for (const command of ["plan", "subagents", "openai-web"]) {
            assert.ok(
                loaded.extensions.some((extension) => extension.commands.has(command)),
                command,
            );
        }
        const tools = runner.getAllRegisteredTools().map((tool) => tool.definition.name);
        for (
            const name of [
                "plan_mode_question",
                "plan_mode_complete",
                "subagents_run",
                "openai_search",
                "web_action",
            ]
        ) {
            assert.ok(tools.includes(name), name);
        }
        assert.deepEqual(errors, []);
    } finally {
        await runner.emit({ type: "session_shutdown", reason: "quit" });
    }
    console.log(`Discovery and offline session startup passed: ${checkout}`);
}

try {
    mkdirSync(join(temporary, "project"));
    const nestedAgentDir = join(temporary, "nested-agent");
    const checkout = join(nestedAgentDir, "extensions", "pi-local-extensions");
    mkdirSync(checkout, { recursive: true });
    for (const name of ["package.json", "package-lock.json", ".npmrc", "install.sh"]) {
        cpSync(join(root, name), join(checkout, name));
    }
    for (const entry of manifest.pi.extensions) {
        const directory = dirname(entry);
        const child = JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8"));
        for (const name of ["package.json", ...child.files]) {
            cpSync(join(root, directory, name), join(checkout, directory, name), {
                recursive: true,
            });
        }
    }
    const command = process.platform === "win32" ? process.execPath : "sh";
    const args = process.platform === "win32"
        ? [npm, "ci", "--omit=dev", "--legacy-peer-deps"]
        : [join(checkout, "install.sh")];
    const installed = spawnSync(command, args, {
        cwd: temporary,
        stdio: "inherit",
        ...(process.platform === "win32" ? { cwd: checkout } : {}),
    });
    if (installed.error) throw installed.error;
    assert.equal(installed.status, 0, "Runtime-only install must succeed.");
    for (const name of Object.keys(manifest.peerDependencies)) {
        assert.equal(existsSync(join(checkout, "node_modules", name)), false, name);
    }
    for (const entry of manifest.pi.extensions) {
        assert.equal(existsSync(join(checkout, dirname(entry), "node_modules")), false);
    }
    await verify(checkout, nestedAgentDir);
    const flatAgentDir = join(temporary, "flat-agent");
    mkdirSync(flatAgentDir);
    const flatCheckout = join(flatAgentDir, "extensions");
    renameSync(checkout, flatCheckout);
    await verify(flatCheckout, flatAgentDir);
} finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    for (const name of Object.keys(process.env)) {
        if (name.startsWith("PI_OPENAI_WEB_")) delete process.env[name];
    }
    Object.assign(process.env, webEnvironment);
    rmSync(temporary, { recursive: true, force: true });
}
