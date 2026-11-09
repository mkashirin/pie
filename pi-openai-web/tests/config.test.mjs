import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
    defaults,
    loadConfiguration,
    mutateConfiguration,
    resolveModel,
    status,
    validateSettings,
} from "../src/config.ts";

test("strict config, trust, precedence and atomic preserving mutation", async () => {
    const root = await mkdtemp(join(import.meta.dirname, "../.test-config-"));
    const cwd = join(root, "project");
    await mkdir(join(cwd, ".pi"), { recursive: true });
    try {
        await writeFile(
            join(root, "pi-openai-web.json"),
            JSON.stringify({ concurrency: 2, freshness: "cached" }),
        );
        await writeFile(join(cwd, ".pi/pi-openai-web.json"), JSON.stringify({ concurrency: 4 }));
        assert.equal((await loadConfiguration(root, cwd, false, {})).settings.concurrency, 2);
        assert.equal(
            (await loadConfiguration(root, cwd, true, { PI_OPENAI_WEB_CONCURRENCY: "5" })).settings
                .concurrency,
            5,
        );
        const ctx = { cwd, isIdle: () => true, isProjectTrusted: () => true };
        await mutateConfiguration(root, ctx, "set enabled false", false, {});
        assert.deepEqual(JSON.parse(await readFile(join(root, "pi-openai-web.json"), "utf8")), {
            concurrency: 2,
            freshness: "cached",
            enabled: false,
        });
        await assert.rejects(mutateConfiguration(root, ctx, "reset", true, {}), /idle/);
        await assert.rejects(
            mutateConfiguration(
                root,
                { ...ctx, isProjectTrusted: () => false },
                "reset --project",
                false,
                {},
            ),
            /trust/,
        );
        assert.throws(() => validateSettings({ unknown: true }), /unknown/);
        assert.throws(() => validateSettings({ pageTimeoutMs: 120001 }), /invalid/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("explicit invalid model never falls back; status uses only synchronous auth presence", () => {
    const model = { provider: "openai", api: "openai-responses", id: "fixture" };
    const ctx = {
        model,
        modelRegistry: {
            find: () => undefined,
            hasConfiguredAuth: () => true,
            getApiKey: () => {
                throw Error("refresh forbidden");
            },
        },
    };
    assert.throws(() => resolveModel({ ...defaults, model: "openai/missing" }, ctx), /no fallback/);
    assert.throws(
        () => resolveModel(defaults, { ...ctx, model: { ...model, provider: "openai-codex" } }),
        /physical/,
    );
    for (const provider of ["openai", "openai-multi"]) {
        const selected = { ...model, provider };
        assert.deepEqual(resolveModel(defaults, { ...ctx, model: selected }), selected);
        assert.deepEqual(
            resolveModel({ ...defaults, model: `${provider}/fixture` }, {
                ...ctx,
                modelRegistry: { find: () => selected },
            }),
            selected,
        );
    }
    for (const override of [{ provider: "openai-multi-custom" }, { api: "pi-virtual" }]) {
        assert.throws(
            () => resolveModel(defaults, { ...ctx, model: { ...model, ...override } }),
            /physical/,
        );
    }
    assert.notEqual(resolveModel(defaults, ctx), model);
    assert.match(
        status({ settings: defaults, provenance: {}, trusted: false }, ctx),
        /configured \(not verified\)/,
    );
});
