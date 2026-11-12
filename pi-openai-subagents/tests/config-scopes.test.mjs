import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { cfg, environment, harness, model } from "./helpers.mjs";
const canonical = "pi-openai-subagents.json";

async function json(dir, file, value) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, file), JSON.stringify(value));
}

function markdown(name, profile, body) {
    return `---\nname: ${name}\ndescription: Test ${name}\n${
        profile ? `profile: ${profile}\n` : ""
    }---\n${body}\n`;
}

test("only canonical settings and definitions load, including trusted scopes", async (t) => {
    const e = await environment(t);
    for (const dir of [e.agentDir, join(e.cwd, ".pi")]) {
        await mkdir(join(dir, "pi-codex-subagents/agents"), { recursive: true });
        await writeFile(join(dir, "pi-codex-subagents.json"), "{invalid ignored settings");
        await writeFile(
            join(dir, "pi-codex-subagents/agents/bad.md"),
            "invalid ignored definition",
        );
    }
    let c = await cfg.loadConfiguration(e.agentDir, e.cwd, true);
    assert.deepEqual(c.user, {});
    assert.deepEqual(c.project, {});
    assert.equal(c.definitions.size, 7);
    await json(e.agentDir, canonical, { default: { model: "other/family/model" } });
    c = await cfg.loadConfiguration(e.agentDir, e.cwd, true);
    assert.equal(cfg.assignmentFor(c, {}, "worker").ref, "other/family/model");
    await writeFile(join(e.cwd, ".pi", canonical), "{invalid project");
    await cfg.loadConfiguration(e.agentDir, e.cwd, false);
    await assert.rejects(cfg.loadConfiguration(e.agentDir, e.cwd, true), SyntaxError);
    await writeFile(join(e.agentDir, canonical), "{invalid canonical");
    await assert.rejects(cfg.loadConfiguration(e.agentDir, e.cwd, false), SyntaxError);
});
test("canonical saves retain preferences, reset fields and leave old files untouched", async (t) => {
    const h = await harness(t);
    const old = join(h.agentDir, "pi-codex-subagents.json");
    await json(h.agentDir, "pi-codex-subagents.json", { maxTurns: 99 });
    const before = await readFile(old, "utf8");
    await json(h.agentDir, canonical, {
        default: { model: "other/family/model", thinking: "high" },
        maxTurns: 31,
    });
    await h.command("reload");
    await h.command("classify mystery read --save");
    await h.command("model default reset --save");
    const saved = JSON.parse(await readFile(join(h.agentDir, canonical), "utf8"));
    assert.equal(saved.default.model, undefined);
    assert.equal(saved.default.thinking, "high");
    assert.equal(saved.maxTurns, 31);
    assert.equal(saved.classifications.mystery, "read");
    assert.equal(await readFile(old, "utf8"), before);
});
test("canonical definition overrides keep builtin cores fixed but custom profiles mutable", async (t) => {
    const e = await environment(t);
    const dirs = [
        join(e.agentDir, "pi-openai-subagents/agents"),
        join(e.cwd, ".pi/pi-openai-subagents/agents"),
    ];
    for (const [i, dir] of dirs.entries()) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "worker.md"), markdown("worker", "worker", `layer ${i}`));
        await writeFile(
            join(dir, "custom.md"),
            markdown("custom", i ? "researcher" : "scout", `layer ${i}`),
        );
    }
    const c = await cfg.loadConfiguration(e.agentDir, e.cwd, true);
    assert.equal(c.definitions.get("worker").prompt, "layer 1");
    assert.match(c.definitions.get("worker").core, /Implement the assigned task/);
    assert.equal(c.definitions.get("custom").profile, "researcher");
    assert.equal(c.definitions.get("custom").core, "");
    await writeFile(join(dirs[1], "custom.md"), markdown("custom", undefined, "missing"));
    await assert.rejects(cfg.loadConfiguration(e.agentDir, e.cwd, true), /profile/);
    await writeFile(join(dirs[1], "custom.md"), markdown("custom", "scout", "valid"));
    await writeFile(join(dirs[1], "worker.md"), markdown("worker", "scout", "invalid"));
    await assert.rejects(cfg.loadConfiguration(e.agentDir, e.cwd, true), /profile/);
});
test("test environment isolates inherited credentials and restores environment", async (t) => {
    const key = "OPENAI_API_KEY";
    const previous = process.env[key];
    process.env[key] = "sentinel-not-a-real-credential";
    const e = await environment(t);
    t.after(() => {
        try {
            assert.equal(process.env[key], "sentinel-not-a-real-credential");
        } finally {
            if (previous === undefined) delete process.env[key];
            else process.env[key] = previous;
        }
    });
    assert.equal(process.env[key], undefined);
    assert.equal(process.env.HOME, e.dir);
    assert.equal(process.env.PI_CODING_AGENT_DIR, e.agentDir);
    assert.equal(process.env.PI_OFFLINE, "1");
});

test("physical OpenAI defaults fail closed; explicit provider assignments stay neutral", async (t) => {
    const e = await environment(t);
    const physical = model("openai", "active");
    assert.equal(cfg.assignmentFor(e.config, {}, "worker", physical).ref, "openai/active");
    const managed = model("openai-multi", "active");
    assert.equal(cfg.assignmentFor(e.config, {}, "worker", managed).ref, "openai-multi/active");
    e.ctx.model = managed;
    e.ctx.modelRegistry.find = () => managed;
    assert.equal(
        (await cfg.resolveAssignment(e.config, {}, "worker", e.ctx)).ref,
        "openai-multi/active",
    );
    e.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false, error: "missing auth" });
    await assert.rejects(cfg.resolveAssignment(e.config, {}, "worker", e.ctx), /\/openai-accounts/);
    for (
        const parent of [
            undefined,
            model("other"),
            model("openai-multi-custom"),
            { ...managed, api: "pi-virtual" },
            { ...physical, api: "pi-virtual" },
            {
                ...physical,
                api: "openai-completions",
            },
        ]
    ) {
        assert.equal(cfg.assignmentFor(e.config, {}, "worker", parent).ref, "openai/gpt-6.1-sol");
    }
    e.ctx.model = undefined;
    e.ctx.modelRegistry.find = () => undefined;
    await assert.rejects(cfg.resolveAssignment(e.config, {}, "worker", e.ctx), /unavailable/);
    e.ctx.modelRegistry.find = () => ({ ...model(), api: "pi-virtual" });
    await assert.rejects(cfg.resolveAssignment(e.config, {}, "worker", e.ctx), /physical/);
    e.ctx.modelRegistry.find = () => model();
    e.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false, error: "missing auth" });
    await assert.rejects(cfg.resolveAssignment(e.config, {}, "worker", e.ctx), /missing auth/);
    e.ctx.modelRegistry.find = () => model("other", "family/model");
    e.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: "fake" });
    assert.equal(
        (await cfg.resolveAssignment(
            e.config,
            { default: { model: "other/family/model" } },
            "worker",
            e.ctx,
        )).ref,
        "other/family/model",
    );
});
