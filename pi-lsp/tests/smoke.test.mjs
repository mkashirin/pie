import test from "node:test";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec = promisify(execFile);
const source = fileURLToPath(new URL("../../", import.meta.url));
const host = import.meta.resolve("@earendil-works/pi-coding-agent");

// Run against the installed host, not a second host installed into the plugin bundle.
async function checkBundle(host, agentDir, cwd, bundle) {
    const assert = (await import("node:assert/strict")).default;
    const { readFile } = await import("node:fs/promises");
    const { resolve, join } = await import("node:path");
    const { discoverAndLoadExtensions } = await import(new URL("core/extensions/loader.js", host));
    const sdk = await import(host);
    const manifest = JSON.parse(await readFile(join(bundle, "package.json"), "utf8"));
    assert.ok(manifest.pi.extensions.length >= 6);
    const loaded = await discoverAndLoadExtensions([], cwd, agentDir);
    assert.deepEqual(loaded.errors, []);
    for (const entry of manifest.pi.extensions) {
        assert.equal(
            loaded.extensions.filter((e) => resolve(e.resolvedPath) === resolve(bundle, entry))
                .length,
            1,
            entry,
        );
    }
    for (const name of ["lsp_diagnostics", "lsp_fix"]) {
        assert.equal(loaded.extensions.filter((e) => e.tools.has(name)).length, 1, name);
    }
    const settings = sdk.SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
        cacheWarming: "off",
    });
    const loader = new sdk.DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: settings,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
    });
    await loader.reload();
    // Offline registry/runtime: no auth resolution, refresh, model request or prompt.
    const runtime = await sdk.ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: null,
        modelsStorePath: join(agentDir, "models.json"),
        allowModelNetwork: false,
        refreshOnCreate: false,
    });
    const model = {
        id: "offline",
        name: "Offline smoke",
        provider: "smoke",
        api: "openai-responses",
        baseUrl: "https://never-called.invalid",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024,
    };
    runtime.registerProvider("smoke", {
        baseUrl: model.baseUrl,
        api: model.api,
        apiKey: "offline",
        models: [model],
        streamSimple() {
            throw new Error("Smoke must not request a model");
        },
    });
    const { session, extensionsResult } = await sdk.createAgentSession({
        cwd,
        agentDir,
        modelRuntime: runtime,
        model: runtime.getModel("smoke", "offline"),
        settingsManager: settings,
        resourceLoader: loader,
        sessionManager: sdk.SessionManager.inMemory(cwd),
    });
    const errors = [];
    try {
        assert.deepEqual(extensionsResult.errors, []);
        await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
        for (const name of ["lsp_diagnostics", "lsp_fix"]) {
            assert.equal(session.getActiveToolNames().filter((n) => n === name).length, 1);
        }
        const { emitSessionShutdownEvent } = await import(
            new URL("core/extensions/runner.js", host)
        );
        await emitSessionShutdownEvent(session.extensionRunner, {
            type: "session_shutdown",
            reason: "exit",
        });
        assert.deepEqual(errors, []);
    } finally {
        session.dispose();
    }
}

async function copyBundle(target) {
    await cp(source, target, {
        recursive: true,
        filter: (path) =>
            !path.split(/[\\/]/).some((part) => part === "node_modules" || part === ".git"),
    });
}

async function layouts(t, runtimeOnly) {
    const root = await mkdtemp(join(tmpdir(), "lsp-bundle-smoke-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    let installed;
    for (const nested of [false, true]) {
        const agentDir = join(root, nested ? "nested-agent" : "flat-agent");
        const cwd = join(root, nested ? "nested-project" : "flat-project");
        const bundle = nested
            ? join(agentDir, "extensions", "bundle")
            : join(agentDir, "extensions");
        await mkdir(cwd, { recursive: true });
        await copyBundle(bundle);
        if (runtimeOnly && !installed) {
            await exec("npm", ["ci", "--omit=dev", "--legacy-peer-deps", "--ignore-scripts"], {
                cwd: bundle,
                timeout: 180000,
                maxBuffer: 4 * 1024 * 1024,
            });
            installed = join(bundle, "node_modules");
        } else {
            await symlink(
                runtimeOnly ? installed : join(source, "node_modules"),
                join(bundle, "node_modules"),
                "dir",
            );
        }
        // Separate processes keep jiti/module caches and extension global state isolated.
        const script = join(root, nested ? "nested-check.mjs" : "flat-check.mjs");
        await writeFile(
            script,
            `await (${checkBundle.toString()})(${
                [host, agentDir, cwd, bundle].map((v) => JSON.stringify(v)).join(",")
            });`,
        );
        await exec(process.execPath, [script], { cwd, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    }
}

test("real root manifest auto-discovery and offline SDK startup: flat and nested", {
    timeout: 180000,
}, async (t) => layouts(t, false));
test("runtime-only full bundle auto-discovery and offline SDK startup: flat and nested", {
    timeout: 360000,
    skip: process.env.PI_LSP_RUNTIME_SMOKE !== "1",
}, async (t) => layouts(t, true));
