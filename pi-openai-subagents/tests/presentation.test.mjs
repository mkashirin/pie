import { initTheme } from "@earendil-works/pi-coding-agent";
import { Box, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
    activity,
    call,
    harness,
    presentation,
    report,
    state,
    stream,
    tool,
    ui,
} from "./helpers.mjs";

const { getThemeByName } = await import(
    new URL(
        "./modes/interactive/theme/theme.js",
        import.meta.resolve("@earendil-works/pi-coding-agent"),
    )
);
const theme = { fg: (_token, value) => value, bold: (value) => value };

const turns = (context) => context.messages.filter((m) => m.role === "assistant").length;

const deferred = () => {
    let resolve;
    const promise = new Promise((r) => resolve = r);
    return { promise, resolve };
};

const run = (extra = {}) => ({
    id: "run-current",
    agent: "custom-worker",
    profile: "worker",
    model: "x/y",
    thinking: "high",
    status: "complete",
    task: "Implement",
    inputs: ["run-input"],
    writePaths: ["src/a.ts"],
    evidence: [],
    toolActivity: [],
    durationMs: 2400,
    turns: 2,
    usage: state.emptyUsage(),
    reportBytes: 10,
    truncated: false,
    changed: false,
    uncertainShell: false,
    revision: 1,
    reviewRevision: 0,
    report: report(),
    ...extra,
});

test("worker previews arrive before tool completion, are immutable, and never enter final packets", async (t) => {
    const entered = deferred();
    const release = deferred();
    const args = {
        path: "src/a.ts",
        edits: [{ oldText: "PRIVATE_BEFORE\nold2\nold3", newText: "PRIVATE_AFTER\nnew2\nnew3" }],
    };
    const updates = [];
    const h = await harness(t, {
        mode: "tui",
        hasUI: true,
        tools: [tool("edit", async (_id, _args, _signal, onUpdate) => {
            entered.resolve();
            onUpdate?.({ content: [{ type: "text", text: "working" }], details: {} });
            await release.promise;
            return { content: [{ type: "text", text: "ok" }], details: {} };
        })],
        stream: (m, c) =>
            stream(m, [turns(c) ? call("agent_report", report()) : call("edit", args)]),
    });
    const pending = h.execute(
        "subagents_run",
        { tasks: [{ agent: "worker", task: "Implement" }] },
        undefined,
        undefined,
        (update) => updates.push(update),
    );
    await entered.promise;
    const live = updates.at(-1).details.results[0];
    assert.equal(live.activity.stage, "running");
    assert.equal(live.activity.action, "proposed edit");
    assert.equal(live.activity.focus, "src/a.ts");
    assert.deepEqual(live.activity.snippets.map((s) => s.sign), ["-", "-", "+", "+"]);
    assert.ok(Object.isFrozen(live.activity));
    assert.ok(Object.isFrozen(live.activity.snippets[0]));
    assert.throws(() => live.activity.snippets[0].text = "changed", TypeError);
    const saved = JSON.stringify(live);
    const card = h.tools.get("subagents_run").renderResult(updates.at(-1), {
        expanded: true,
        isPartial: true,
    }, theme);
    assert.match(card.render(240).join("\n"), /- PRIVATE_BEFORE/);
    assert.match(card.render(240).join("\n"), /\+ PRIVATE_AFTER/);
    assert.doesNotMatch(card.render(240).join("\n"), /No final report/);
    const fleet = h.widgetFrames.at(-1);
    assert.equal(fleet.length, 2);
    assert.match(fleet[1], /^worker · running · \d+s$/);
    assert.doesNotMatch(fleet.join("\n"), /src\/a\.ts|PRIVATE_|proposed|edit/);
    release.resolve();
    const final = (await pending).result;
    assert.equal(JSON.stringify(live), saved); // Even tool accounting, usage and turns are snapshots.
    const success = updates.find((u) => u.details.results[0].activity?.stage === "succeeded");
    assert.ok(success);
    assert.match(
        h.tools.get("subagents_run").renderResult(success, { isPartial: true }, theme).render(240)
            .join("\n"),
        /✓ succeeded/,
    );
    assert.equal(final.details.results[0].changed, true); // Existing mutation accounting is preserved.
    for (const value of [final, h.entries]) {
        assert.doesNotMatch(
            JSON.stringify(value),
            /PRIVATE_BEFORE|PRIVATE_AFTER|"activity"|"snippets"/,
        );
    }
    const completed = final.details.results[0];
    assert.doesNotMatch(state.reportText(completed), /PRIVATE_|activity|snippets/);
    let input;
    h.ctx.modelRegistry.streamSimple = (m, c) => {
        input = c.messages.filter((message) => message.role === "user").at(-1)?.content;
        return stream(m, [call("agent_report", report())]);
    };
    await h.execute("subagents_run", {
        tasks: [{ agent: "scout", task: "Inspect prior run", inputs: [completed.id] }],
    });
    assert.ok(input, "inspect the task/report handoff, not the system instructions");
    assert.doesNotMatch(JSON.stringify(input), /PRIVATE_|activity|snippets/);
});

test("failure, thrown execution, parent veto and ownership denial retain honest stages", async (t) => {
    for (const kind of ["failed-result", "throw", "veto", "scope"]) {
        await t.test(kind, async (t) => {
            let executed = 0;
            const updates = [];
            const h = await harness(t, {
                tools: [tool("edit", async () => {
                    executed++;
                    if (kind === "throw") throw new Error("edit failure");
                    return { content: [], details: {}, isError: kind === "failed-result" };
                })],
                stream: (m, c) =>
                    stream(m, [
                        turns(c)
                            ? call("agent_report", report())
                            : call("edit", {
                                path: "outside.ts",
                                edits: [{ oldText: "old", newText: "new" }],
                            }),
                    ]),
            });
            if (kind === "veto") {
                h.pi.on("tool_call", (event) =>
                    event.toolName === "edit"
                        ? { block: true, reason: "parent veto" }
                        : undefined);
            }
            const final = await h.execute(
                "subagents_run",
                {
                    tasks: [{
                        agent: "worker",
                        task: kind,
                        ...(kind === "scope" ? { writePaths: ["owned.ts"] } : {}),
                    }],
                },
                undefined,
                undefined,
                (u) => updates.push(u),
            );
            const stages = updates.flatMap((u) => u.details.results[0].activity?.stage ?? []);
            assert.ok(stages.includes(kind === "veto" || kind === "scope" ? "blocked" : "failed"));
            assert.ok(!stages.includes("succeeded"));
            const terminal = updates.find((u) =>
                ["failed", "blocked"].includes(u.details.results[0].activity?.stage)
            );
            const rendered = h.tools.get("subagents_run").renderResult(terminal, {
                isPartial: true,
            }, theme).render(240).join("\n");
            assert.match(rendered, kind === "veto" || kind === "scope" ? /blocked/ : /✗ failed/);
            assert.doesNotMatch(rendered, /✓/);
            assert.equal(executed, kind === "veto" || kind === "scope" ? 0 : 1);
            assert.equal(final.result.details.results[0].changed, executed > 0);
        });
    }
});

test("authoritative nested hooks expose inner edits without outer wrapper overwrites", async (t) => {
    const entered = deferred();
    const release = deferred();
    const updates = [];
    const h = await harness(t, {
        tools: [
            tool("edit", async () => {
                entered.resolve();
                await release.promise;
                return { content: [], details: {} };
            }),
            tool(
                "wrapper",
                async (_id, _args, _s, _u, ctx) =>
                    (await ctx.executeTool("edit", {
                        path: "inner.ts",
                        edits: [{ oldText: "nested old", newText: "nested new" }],
                    })).result,
                { annotations: { readOnlyHint: true } },
            ),
        ],
        stream: (m, c) =>
            stream(m, [
                turns(c)
                    ? call("agent_report", report())
                    : call("wrapper", { script: "DO_NOT_DISPLAY_SCRIPT" }),
            ]),
    });
    const pending = h.execute(
        "subagents_run",
        { tasks: [{ agent: "worker", task: "Nested mutation" }] },
        undefined,
        undefined,
        (u) => updates.push(u),
    );
    await entered.promise;
    assert.equal(updates.at(-1).details.results[0].activity.tool, "edit");
    assert.equal(updates.at(-1).details.results[0].activity.stage, "running");
    assert.doesNotMatch(JSON.stringify(updates), /DO_NOT_DISPLAY_SCRIPT/);
    release.resolve();
    const final = (await pending).result.details.results[0];
    const previews = updates.flatMap((u) => u.details.results[0].activity ?? []);
    const succeeded = previews.filter((p) => p.stage === "succeeded");
    assert.ok(succeeded.length > 0);
    assert.ok(succeeded.every((p) => p.tool === "edit"));
    assert.ok(final.toolActivity.some((t) => t.tool === "edit" && !t.isError));
    assert.equal(final.changed, true);
});

test("custom names classify by profile; scout reads and role-specific adapters remain bounded", async (t) => {
    const h = await harness(t, {
        tools: [tool("read")],
        stream: (m, c) =>
            stream(m, [
                turns(c)
                    ? call("agent_report", report())
                    : call("read", { path: "src/ui.ts", offset: 20, limit: 10 }),
            ]),
    });
    const definitions = join(h.agentDir, "pi-openai-subagents", "agents");
    await mkdir(definitions, { recursive: true });
    await writeFile(
        join(definitions, "finder.md"),
        "---\nname: finder\ndescription: Locate files\nprofile: scout\n---\nInspect code.\n",
    );
    await h.command("reload");
    const updates = [];
    await h.execute(
        "subagents_run",
        { tasks: [{ agent: "finder", task: "Locate" }] },
        undefined,
        undefined,
        (u) => updates.push(u),
    );
    const preview =
        updates.find((u) => u.details.results[0].activity?.stage === "running").details.results[0]
            .activity;
    assert.equal(preview.action, "read focus");
    assert.equal(preview.focus, "src/ui.ts:20-29");
    const cases = [
        ["reviewer", "bash", { command: "npm test" }, "verification command", "npm test"],
        [
            "researcher",
            "openai_search",
            { queries: ["current API", "second query"] },
            "source search",
            "current API | +1 queries",
        ],
        [
            "researcher",
            "web_action",
            { action: "open", url: "https://example.org" },
            "source action",
            "open | https://example.org",
        ],
        [
            "scout",
            "lsp_navigation",
            { operation: "definition", path: "a.ts", symbol: "FleetUI", line: 3 },
            "symbol focus",
            "definition | a.ts | FleetUI:3",
        ],
        ["scout", "symbol_search", { query: "FleetUI" }, "search focus", "FleetUI"],
        [
            "worker",
            "write",
            { path: "a.ts", content: "new\ncode\nthird" },
            "proposed write",
            "a.ts",
        ],
    ];
    for (const [profile, name, args, actionName, focus] of cases) {
        const p = activity.activityPreview(profile, name, args, "pending");
        assert.equal(p.action, actionName);
        assert.equal(p.focus, focus);
    }
    const validator = activity.activityPreview(
        "research-validator",
        "openai_search",
        { queries: ["countercheck"] },
        "running",
        ["evidence-source"],
    );
    assert.match(validator.action, /validate/);
    assert.match(validator.focus, /evidence-source.*countercheck/);
    const generic = activity.activityPreview("worker", "mystery", {
        script: "SECRET",
        path: "SECRET",
        reasoning: "SECRET",
    }, "pending");
    assert.doesNotMatch(JSON.stringify(generic), /SECRET/);
    const huge = activity.activityPreview("worker", "edit", {
        path: "x".repeat(10000),
        edits: [{ oldText: "界".repeat(10000), newText: "y\n".repeat(10000) }],
    }, "running");
    assert.ok(Buffer.byteLength(JSON.stringify(huge)) < 2000);
});

test("edit/write snippets have muted frames and no trailing child blank in live cards", () => {
    const colors = [];
    const themed = {
        ...theme,
        fg: (token, value) => {
            colors.push([token, value]);
            return value;
        },
    };
    for (const toolName of ["edit", "write"]) {
        for (const stage of ["pending", "running", "succeeded", "failed", "blocked"]) {
            const preview = activity.activityPreview("worker", toolName, {
                path: "a.ts",
                edits: [{ oldText: "OLD\nSECOND\nOMITTED", newText: "NEW\nSECOND\nOMITTED" }],
                content: "NEW\nSECOND\nOMITTED",
            }, stage);
            const r = run({ status: "running", activity: preview });
            const before = JSON.stringify(r);
            const logical = presentation.compactRunLines(r, themed);
            assert.deepEqual(logical.slice(-(preview.snippets.length + 3)), [
                "",
                "...",
                ...preview.snippets.map((s) => `${s.sign} ${s.text}`),
                "...",
            ]);
            for (const expanded of [false, true]) {
                const lines = new presentation.AgentCards([r], themed, expanded).render(80);
                assert.deepEqual(lines, logical);
                assert.equal(lines.at(-1), "...");
                assert.doesNotMatch(lines.join("\n"), /OMITTED/);
            }
            assert.equal(JSON.stringify(r), before);
        }
    }
    assert.ok(colors.filter(([token, value]) => token === "muted" && value === "...").length > 0);
    for (
        const [stage, prefix, token] of [
            ["pending", "", "accent"],
            ["running", "", "accent"],
            ["succeeded", "✓ ", "success"],
            ["failed", "✗ ", "error"],
            ["blocked", "", "warning"],
        ]
    ) {
        // Outcome glyphs also apply to tools without snippets, not only worker mutations.
        const preview = activity.activityPreview("scout", "read", { path: "a.ts" }, stage);
        const lines = presentation.compactRunLines(run({ activity: preview }), themed);
        assert.equal(lines[3], `${prefix}${stage} · read focus · read`);
        assert.ok(
            colors.some(([color, value]) => color === token && value === `${prefix}${stage}`),
        );
        assert.ok(!lines.includes("..."));
    }
    for (const toolName of ["edit", "write"]) {
        const preview = activity.activityPreview("worker", toolName, { path: "a.ts" }, "pending");
        const lines = presentation.compactRunLines(run({ activity: preview }), theme);
        assert.ok(!lines.includes("..."));
        assert.notEqual(lines.at(-1), "");
    }
});

test("Markdown sections preserve evidence, uncertainty and linkage without changing report JSON", () => {
    const r = run({
        status: "incomplete",
        reason: "validation unavailable",
        changed: true,
        uncertainShell: true,
        report: report({
            summary: "Useful summary",
            changeStatus: "changed",
            changes: ["a.ts"],
            verification: ["npm test: failed"],
            findings: ["blocking", "warning", "info"].map((severity) => ({
                severity,
                text: `${severity} finding`,
            })),
            limitations: ["No independent review"],
            claims: [{
                claim: "Source claim",
                evidence: ["evidence-1"],
                urls: ["https://example.org/a(b)?q=x", "javascript:alert(1)"],
                date: "2026-10-02",
                uncertainty: "Limited scope",
            }],
            checks: [{
                target: "run-input",
                verdict: "blocked",
                reason: "Tests failed",
                evidence: ["evidence-1"],
            }],
        }),
        evidence: [{
            id: "evidence-1",
            tool: "openai_search",
            owner: "run-current",
            inspection: "search",
            retrievedAt: "2026-10-02",
            isError: false,
            text: "RAW_SOURCE_NOT_DISPLAYED",
            details: {},
        }],
    });
    const original = state.reportText(r);
    const md = presentation.reportMarkdown(r);
    for (
        const heading of [
            "Summary",
            "Changes",
            "Verification",
            "Findings",
            "Limitations",
            "Claims & sources",
            "Linked checks",
            "Evidence",
            "Run metadata",
        ]
    ) assert.ok(md.includes(`## ${heading}`));
    for (
        const detail of [
            "blocking",
            "warning",
            "info",
            "validation unavailable",
            "Tests failed",
            "Limited scope",
            "2026",
            "completion does not imply independent review",
            "retrieved (not proof)",
        ]
    ) assert.ok(md.includes(detail));
    assert.match(md, /https:\/\/example.org\/a%28b%29/);
    assert.doesNotMatch(md, /\]\(javascript:|RAW_SOURCE_NOT_DISPLAYED/);
    assert.equal(state.reportText(r), original);
    assert.equal(JSON.parse(original).report.summary, "Useful summary");
});

test("fleet and chat headers use plain names and colored status words without role glyphs or pulses", () => {
    initTheme("dark");
    const statuses = {
        queued: "muted",
        running: "muted",
        complete: "success",
        incomplete: "warning",
        failed: "error",
        cancelled: "warning",
    };
    for (const profile of ["worker", "scout", "reviewer", "researcher", "research-validator"]) {
        for (const [status, token] of Object.entries(statuses)) {
            for (const seconds of [0, 1, 2]) {
                const r = run({
                    agent: `custom-${profile}`,
                    profile,
                    status,
                    durationMs: seconds * 1000,
                });
                const before = JSON.stringify(r);
                const header = `${r.agent} · ${status}`;
                const colors = [];
                const themed = {
                    bold: (value) => value,
                    fg: (token, value) => {
                        colors.push([token, value]);
                        return `\x1b[31m${value}\x1b[0m`;
                    },
                };
                const fleet = new ui.FleetComponent(
                    () => [{ live: true, rows: new Map([[r.id, r]]) }],
                    themed,
                    () => {},
                ).render(240).map(stripTerminalSequences);
                assert.equal(fleet.length, 2);
                assert.equal(fleet[1], `${r.agent} · ${status} · ${seconds}s`);
                for (const expanded of [false, true]) {
                    const card = new presentation.AgentCards([r], themed, expanded);
                    assert.deepEqual(card.render(240).slice(0, 3).map(stripTerminalSequences), [
                        header,
                        `Role: ${profile} · Model: x/y`,
                        `Elapsed: ${seconds}s · 2 turns`,
                    ]);
                }
                assert.ok(colors.some(([color, text]) => color === "accent" && text === r.agent));
                assert.ok(colors.some(([color, text]) => color === token && text === status));
                assert.equal(JSON.stringify(r), before);
            }
        }
    }
});

test("controls, Markdown injection, Unicode, widths, themes and elapsed time are presentation-only", async () => {
    initTheme("dark");
    const malicious =
        "\x1b[31m界👩‍💻é\x1b[0m\n# Inject\n```js\n[bad](javascript:evil)\x1b]8;;https://evil\x07link\x1b]8;;\x07\u202e";
    const r = run({
        agent: malicious,
        report: report({ summary: malicious }),
        activity: activity.activityPreview("worker", "edit", {
            path: malicious,
            edits: [{ oldText: malicious, newText: malicious }],
        }, "failed"),
    });
    const before = JSON.stringify(r);
    const md = presentation.reportMarkdown(r);
    assert.ok(md.includes("\\# Inject"));
    assert.doesNotMatch(md, /\x1b|\u202e|```js|\[bad\]\(javascript:/);
    for (const expanded of [false, true]) {
        const card = new presentation.AgentCards([r], theme, expanded);
        for (const width of [0, 1, 2, 3, 8, 20, 80, 240]) {
            const lines = card.render(width);
            assert.ok(lines.every((line) => visibleWidth(line) <= width));
            assert.ok(
                lines.map(stripTerminalSequences).every((line) =>
                    !/[\x00-\x1f\x7f-\x9f\u202e]/.test(line)
                ),
            );
            if (!expanded) assert.ok(lines.every((line) => !line.startsWith(" ")));
        }
    }
    const tokens = [];
    const themed = {
        bold: (value) => value,
        fg: (token, value) => {
            tokens.push(token);
            return `\x1b[31m${value}\x1b[0m`;
        },
    };
    const card = new presentation.AgentCards([r], themed, false);
    const first = card.render(240);
    themed.fg = (_token, value) => `\x1b[32m${value}\x1b[0m`;
    card.invalidate();
    assert.notDeepEqual(card.render(240), first);
    assert.ok(
        tokens.includes("toolDiffAdded") && tokens.includes("toolDiffRemoved")
            && tokens.includes("error"),
    );
    assert.equal(JSON.stringify(r), before);
    const live = run({ status: "running", durationMs: 0 });
    assert.equal(
        presentation.compactRunLines(live, theme)[2],
        "Elapsed: 0s · 2 turns",
    );
    assert.equal(
        presentation.compactRunLines({ ...live, durationMs: 1000 }, theme)[2],
        "Elapsed: 1s · 2 turns",
    );
    assert.deepEqual(
        presentation.compactRunLines(r, theme),
        presentation.compactRunLines({ ...r }, theme),
    );
});

test("multiline chat preserves bounded long metadata, paths, commands, queries and both diff sides", () => {
    initTheme("dark");
    const name = `worker-${"long-name-".repeat(16)}END_NAME`;
    const model = `provider/${"long-model-".repeat(16)}END_MODEL`;
    const path = `src/${"long-path/".repeat(16)}END_PATH.ts`;
    const command = `npm test ${"--long-option=value ".repeat(7)}END_COMMAND`;
    const cases = [
        ["worker", "edit", {
            path,
            edits: [{
                oldText: `OLD_${"before_".repeat(18)}END_OLD\nOLD_SECOND\nOMITTED_OLD`,
                newText: `NEW_${"after_".repeat(20)}END_NEW\nNEW_SECOND\nOMITTED_NEW`,
            }],
        }],
        ["scout", "read", { path, offset: 20, limit: 10 }],
        ["reviewer", "bash", { command }],
        ["researcher", "openai_search", { queries: [command, "SECOND_QUERY_NOT_EXTRACTED"] }],
    ];

    const compact = (text) => stripTerminalSequences(text).replace(/\s/g, "");

    for (const [profile, toolName, args] of cases) {
        for (const stage of ["pending", "running", "succeeded", "failed", "blocked"]) {
            const preview = activity.activityPreview(profile, toolName, args, stage);
            const r = run({ agent: name, model, profile, activity: preview });
            const before = JSON.stringify(r);
            const logical = presentation.compactRunLines(r, theme);
            assert.deepEqual(logical.slice(0, 5), [
                `${name} · complete`,
                `Role: ${profile} · Model: ${model}`,
                "Elapsed: 2s · 2 turns",
                `${
                    stage === "succeeded"
                        ? "✓ "
                        : stage === "failed"
                        ? "✗ "
                        : ""
                }${stage} · ${preview.action} · ${toolName}`,
                toolName === "bash"
                    ? `$ ${preview.focus}`
                    : ["read", "edit"].includes(toolName)
                    ? `${toolName} ${preview.focus}`
                    : `Focus: ${preview.focus}`,
            ]);
            assert.equal(
                logical.includes("tool reported success (not diff verification)"),
                stage === "succeeded",
            );
            for (const expanded of [false, true]) {
                const card = new presentation.AgentCards([r], theme, expanded);
                for (const width of [0, 1, 2, 3, 8, 20]) {
                    const lines = card.render(width);
                    assert.equal(lines.length === 0, width === 0);
                    assert.ok(lines.every((line) => visibleWidth(line) <= width));
                    assert.doesNotMatch(
                        stripTerminalSequences(lines.join("")),
                        /[\x00-\x1f\x7f-\x9f\u202e]|OMITTED_|SECOND_QUERY_NOT_EXTRACTED/,
                    );
                }
                for (const width of [80, 100]) {
                    const lines = card.render(width);
                    const text = lines.join("\n");
                    assert.ok(lines.every((line) => visibleWidth(line) <= width));
                    assert.doesNotMatch(text, /…|OMITTED_|SECOND_QUERY_NOT_EXTRACTED/);
                    // Wrapping can consume word-break spaces, but must preserve every bounded field.
                    for (const line of logical) {
                        assert.ok(compact(text).includes(compact(line)), line);
                    }
                    assert.ok(lines.length > logical.length); // Long tokens and snippets really wrap.
                    if (expanded) assert.match(text, /Summary/);
                    if (toolName === "edit") {
                        assert.equal(preview.snippets.length, 4);
                        for (const ending of ["END_OLD", "OLD_SECOND", "END_NEW", "NEW_SECOND"]) {
                            assert.ok(compact(text).includes(ending));
                        }
                    }
                }
            }
            assert.equal(JSON.stringify(r), before);
        }
    }
});

test("ANSI wrapping preserves Unicode, themed foregrounds and the installed shell background", () => {
    initTheme("dark");
    const name = `${"界👩‍💻é".repeat(24)}END_NAME`;
    const r = run({
        agent: `\x1b[41m${name}\x1b[0m\x1b[2J\u202e`,
        model: `${"family/界👩‍💻é".repeat(15)}END_MODEL`,
        status: "running",
        activity: activity.activityPreview("worker", "edit", {
            path: `${"src/界👩‍💻é/".repeat(16)}END_PATH`,
            edits: [{ oldText: "界👩‍💻é".repeat(18), newText: "NEW界👩‍💻é".repeat(15) }],
        }, "running"),
    });
    for (const palette of ["dark", "light", "system"]) {
        const themed = getThemeByName(palette);
        for (const expanded of [false, true]) {
            const card = new presentation.AgentCards([r], themed, expanded);
            for (const width of [0, 1, 2, 3, 8, 20, 80, 100]) {
                const lines = card.render(width);
                assert.equal(lines.length === 0, width === 0);
                assert.ok(lines.every((line) => visibleWidth(line) <= width));
                assert.ok(
                    lines.map(stripTerminalSequences).every((line) =>
                        !/[\x00-\x1f\x7f-\x9f\u202e]/.test(line)
                    ),
                );
                // Foreground-only styles and tiny-width placeholders must not reset the shell background.
                assert.doesNotMatch(
                    lines.join("\n"),
                    /\x1b\[(?:0|49)m|\x1b\[(?:4[0-7]|48;|10[0-7])/,
                );
                if (width >= 2) {
                    const text = lines.join("\n");
                    assert.ok(text.includes("👩‍💻") && text.includes("é"));
                    assert.ok(lines[1].startsWith(themed.getFgAnsi("accent")));
                }
                if (width >= 80) {
                    assert.equal(lines.map(stripTerminalSequences).join("").includes(name), true);
                    assert.doesNotMatch(lines.join("\n"), /…/);
                }
            }
            for (const width of [80, 100]) {
                const box = new Box(1, 1, (text) => themed.bg("toolPendingBg", text));
                box.addChild(card);
                const lines = box.render(width);
                for (const line of lines) {
                    assert.equal(visibleWidth(line), width);
                    assert.ok(line.startsWith(themed.getBgAnsi("toolPendingBg")));
                    assert.ok(line.endsWith("\x1b[49m"));
                    // System fallback intentionally opens with default background (49m).
                    // No child content may reset it again before the shell's closing code.
                    assert.doesNotMatch(
                        line.slice(themed.getBgAnsi("toolPendingBg").length, -5),
                        /\x1b\[(?:0|49)m/,
                    );
                }
            }
        }
    }
});

test("final reports without live activity and missing details use readable, safe fallback", async (t) => {
    initTheme("dark");
    const h = await harness(t);
    const renderer = h.tools.get("subagents_run").renderResult;
    for (const details of [undefined, {}, { results: null }]) {
        const card = renderer(
            { content: [{ type: "text", text: "Legacy\x1b[2J\noutput" }], details },
            { expanded: true },
            theme,
        );
        assert.match(stripTerminalSequences(card.render(80).join("\n")), /Legacy output/);
        assert.doesNotMatch(card.render(80).join("\n"), /\x1b\[2J/);
    }
    const r = run({ report: undefined, reason: "No report", status: "failed" });
    const card = renderer({ content: [], details: { results: [r] } }, { expanded: true }, theme);
    assert.match(stripTerminalSequences(card.render(80).join("\n")), /No report/);
    assert.doesNotMatch(stripTerminalSequences(card.render(80).join("\n")), /"report"\s*:/);
    assert.match(presentation.reportMarkdown(r), /completion does not imply independent review/);
});

test("shared display sanitization hides terminal strings without altering activity bounds or inputs", () => {
    const text = "界👩‍💻é\x1bPPRIVATE_DCS\x1b\\\x1b]52;c;PRIVATE_OSC\x07\u061c\u200e\u202e\n safe";
    assert.equal(activity.compactText(text), "界👩‍💻é safe");
    assert.equal(activity.compactText("safe\x1b]unterminated PRIVATE_OSC"), "safe");
    const args = {
        path: text,
        edits: [{ oldText: text + "x".repeat(10000), newText: text }],
    };
    const before = JSON.stringify(args);
    const preview = activity.activityPreview("worker", "edit", args, "pending");
    assert.ok(preview.focus.length <= 240);
    assert.ok(preview.snippets.every((snippet) => snippet.text.length <= 160));
    assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_|\u061c|\u200e|\u202e/);
    assert.equal(JSON.stringify(args), before);
});

test("snippet extraction removes whole multiline terminal strings before selecting rows", () => {
    const strings = [
        ["OSC/BEL", "\x1b]52;c;", "\x07"],
        ["OSC/ST", "\x1b]52;c;", "\x1b\\"],
        ["DCS/ST", "\x1bP", "\x1b\\"],
        ["C1 OSC/ST", "\u009d52;c;", "\u009c"],
        ["C1 DCS/ST", "\u0090", "\u009c"],
    ];
    for (const separator of ["\n", "\r\n", "\r", "\u0085", "\u2028", "\u2029"]) {
        for (const [name, start, end] of strings) {
            for (const terminated of [true, false]) {
                const label = `${name} ${JSON.stringify(separator)} terminated=${terminated}`;
                const text = `before${start}HIDDEN_FIRST${separator}HIDDEN_SECOND`
                    + (terminated
                        ? `${end}after${separator}\t ordinary\tline ${separator}third`
                        : "");
                const expected = terminated ? ["beforeafter", "ordinary line"] : ["before"];
                for (const toolName of ["edit", "write"]) {
                    const args = Object.freeze({
                        path: "a.ts",
                        oldText: text,
                        newText: text,
                        content: text,
                    });
                    const before = JSON.stringify(args);
                    const preview = activity.activityPreview("worker", toolName, args, "pending");
                    assert.deepEqual(
                        preview.snippets,
                        (toolName === "edit" ? ["-", "+"] : ["+"]).flatMap((sign) =>
                            expected.map((text) => ({ sign, text }))
                        ),
                        label,
                    );
                    assert.doesNotMatch(JSON.stringify(preview), /HIDDEN_|third/, label);
                    assert.equal(JSON.stringify(args), before, label);
                    assert.ok(Object.isFrozen(preview));
                    assert.ok(Object.isFrozen(preview.snippets));
                    assert.ok(preview.snippets.every(Object.isFrozen));
                }
            }
        }
    }
});

test("sanitized snippets preserve empty rows, ordinary whitespace and preview limits", () => {
    for (const separator of ["\n", "\r\n", "\r", "\u0085", "\u2028", "\u2029"]) {
        for (
            const [content, expected] of [
                ["", ["(empty)"]],
                [`\t ${separator} one\t two ${separator}third`, ["(empty)", "one two"]],
                [`one${separator}${separator}third`, ["one", "(empty)"]],
                [`one${separator}`, ["one", "(empty)"]],
                [`${"x".repeat(200)}${separator}${"y".repeat(200)}${separator}third`, [
                    "x".repeat(160),
                    "y".repeat(160),
                ]],
            ]
        ) {
            const args = { content };
            const before = JSON.stringify(args);
            const preview = activity.activityPreview("worker", "write", args, "pending");
            assert.deepEqual(preview.snippets.map((s) => s.text), expected);
            assert.equal(JSON.stringify(args), before);
        }
    }
});

test("snippet sanitization keeps the 4096 input bound and discards truncated terminal tails", () => {
    for (const start of ["\x1b]52;c;", "\x1bP", "\u009d", "\u0090"]) {
        const prefix = `before${start}HIDDEN_FIRST\nHIDDEN_SECOND`;
        const text = prefix + "x".repeat(4096 - prefix.length) + "\x1b\\OUTSIDE_BOUND";
        const args = { oldText: text, newText: text };
        const before = JSON.stringify(args);
        const preview = activity.activityPreview("worker", "edit", args, "pending");
        assert.deepEqual(preview.snippets, [
            { sign: "-", text: "before" },
            { sign: "+", text: "before" },
        ]);
        assert.equal(JSON.stringify(args), before);
    }
    const preview = activity.activityPreview("worker", "write", {
        content: "first\n" + " ".repeat(4096 - 6) + "OUTSIDE_BOUND",
    }, "pending");
    assert.deepEqual(preview.snippets, [
        { sign: "+", text: "first" },
        { sign: "+", text: "(empty)" },
    ]);
});

test("cards and fleet normalize invalid/fractional widths without modifying domain packets", () => {
    initTheme("dark");
    const r = run({ agent: "界👩‍💻é worker" });
    const before = JSON.stringify(r);
    const components = [
        new presentation.AgentCards([r], theme, false),
        new presentation.AgentCards([r], theme, true),
        new ui.FleetComponent(
            () => [{ live: true, rows: new Map([[r.id, r]]) }],
            theme,
            () => {},
        ),
    ];
    for (const component of components) {
        for (const width of [NaN, Infinity, -Infinity, -1, 0, 0.9]) {
            assert.deepEqual(component.render(width), []);
        }
        for (const width of [1, 1.9, 2.9, 3.9, 20.9, 80.9]) {
            const rows = component.render(width);
            assert.deepEqual(rows, component.render(Math.floor(width)));
            assert.ok(rows.every((row) => visibleWidth(row) <= Math.floor(width)));
        }
    }
    assert.equal(JSON.stringify(r), before);
});

test("settled Markdown is lazy and cached across renders, and rebuilt with the active theme", () => {
    initTheme("dark");
    let reads = 0;
    const r = run({ report: report(), lastActivity: "finished" });
    Object.defineProperty(r.report, "summary", {
        get() {
            reads++;
            return "CACHED_SUMMARY";
        },
    });
    const card = new presentation.AgentCards([r], theme, true);
    assert.equal(reads, 0);
    assert.deepEqual(card.render(NaN), []);
    assert.equal(reads, 0);
    const first = card.render(80);
    assert.equal(reads, 1);
    assert.match(stripTerminalSequences(first.join("\n")), /CACHED_SUMMARY/);
    assert.deepEqual(card.render(80), first);
    card.render(100);
    assert.equal(reads, 1, "width changes reuse the report structure and host Markdown component");
    initTheme("light");
    card.invalidate();
    const changed = card.render(80);
    assert.equal(reads, 2);
    const fresh = new presentation.AgentCards([r], theme, true).render(80);
    assert.deepEqual(changed, fresh);
    card.render(80);
    assert.equal(reads, 3, "subsequent draws retain the rebuilt cache");
    initTheme("dark");
});

test("native tool/message adapters use active themes, width-safe rows and display-only sanitization", async (t) => {
    const h = await harness(t);
    const fg = { fg: (_token, text) => `\x1b[31m${text}\x1b[39m` };
    const args = { tasks: [{ agent: "界👩‍💻é\x1bPPRIVATE_DCS\x1b\\" }] };
    const before = JSON.stringify(args);
    const call = h.tools.get("subagents_run").renderCall(args, fg);
    const first = call.render(80);
    fg.fg = (_token, text) => `\x1b[32m${text}\x1b[39m`;
    call.invalidate();
    assert.notDeepEqual(call.render(80), first);
    assert.equal(JSON.stringify(args), before);
    const content = "界👩‍💻é\x1b]52;c;PRIVATE_OSC\x07\u202e\nnext line";
    for (const renderer of h.renderers.values()) {
        for (const outputPad of [0, 1]) {
            const message = { content };
            const component = renderer(message, { outputPad });
            for (const width of [NaN, Infinity, -1, 0, 0.9, 1, 2, 3, 8.9, 80]) {
                const rows = component.render(width);
                if (!Number.isFinite(width) || width < 1) assert.deepEqual(rows, []);
                else assert.ok(rows.every((row) => visibleWidth(row) <= Math.floor(width)));
                assert.doesNotMatch(rows.join("\n"), /PRIVATE_|\u202e/);
                if (width === 80) {
                    assert.match(rows.join("\n"), /界👩‍💻é/);
                    assert.equal(rows[0].startsWith(" "), outputPad === 1);
                }
            }
            assert.equal(message.content, content);
        }
    }
    for (const width of [NaN, Infinity, -1, 0, 0.9, 1, 2, 8.9, 80]) {
        const rows = call.render(width);
        if (!Number.isFinite(width) || width < 1) assert.deepEqual(rows, []);
        else assert.ok(rows.every((row) => visibleWidth(row) <= Math.floor(width)));
        assert.doesNotMatch(rows.join("\n"), /PRIVATE_DCS/);
    }
});

test("fleet retains eight status-only rows, active priority and overflow without margin", () => {
    let component;
    const manager = new ui.FleetUI({ everySecond: () => () => {} });
    const ctx = {
        mode: "tui",
        hasUI: true,
        ui: {
            setWidget(_key, factory) {
                component = factory?.({ requestRender() {} }, theme);
            },
        },
    };
    const lease = manager.begin("call", ctx);
    lease.update({
        results: Array.from(
            { length: 12 },
            (_, i) =>
                run({
                    id: String(i),
                    agent: `worker-${i}`,
                    model: "provider/long-model-name",
                    status: i > 8 ? "running" : "complete",
                    activity: activity.activityPreview("worker", "edit", {
                        path: `src/${"long-path/".repeat(12)}a.ts`,
                        edits: [{
                            oldText: "OLD_SENTINEL\nold second\x1b[2J\u202e",
                            newText: "NEW_SENTINEL\nnew second\x1b[2J\u202e",
                        }],
                    }, "pending"),
                }),
        ),
        partial: false,
    });
    for (const width of [0, 1, 2, 20, 80, 100, 240]) {
        const lines = component.render(width);
        const plain = lines.map(stripTerminalSequences);
        assert.equal(lines.length, width === 0 ? 0 : 1 + 8);
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
        assert.ok(plain.every((line) => !line.startsWith(" ")));
        assert.ok(plain.every((line) => !/[\x00-\x1f\x7f-\x9f\u202e]/.test(line)));
        if (width === 1) assert.ok(plain.every((line) => line === "."));
        if (width === 80 || width === 100) {
            assert.match(plain[0], /^Agents.*\+4 more/);
            assert.equal(plain.filter((line) => /^worker-/.test(line)).length, 8);
            assert.deepEqual(plain.slice(1, 4), [
                "worker-9 · running · 2s",
                "worker-10 · running · 2s",
                "worker-11 · running · 2s",
            ]); // Active runs outrank settled overflow.
            assert.deepEqual(
                plain.slice(4),
                Array.from({ length: 5 }, (_, i) => `worker-${i} · complete · 2s`),
            );
            assert.doesNotMatch(
                plain.join("\n"),
                /OLD_SENTINEL|NEW_SENTINEL|old second|new second|long-path|long-model|proposed|edit|#/,
            );
            const cards = new presentation.AgentCards(
                [...Array(8)].map(() =>
                    run({
                        activity: activity.activityPreview("worker", "edit", {
                            path: "a.ts",
                            edits: [{
                                oldText: "OLD_SENTINEL\nold second",
                                newText: "NEW_SENTINEL\nnew second",
                            }],
                        }, "running"),
                    })
                ),
                theme,
                false,
            ).render(width);
            for (
                const snippet of [
                    "- OLD_SENTINEL",
                    "- old second",
                    "+ NEW_SENTINEL",
                    "+ new second",
                ]
            ) {
                assert.equal(
                    cards.map(stripTerminalSequences).filter((line) => line === snippet).length,
                    8,
                );
            }
        }
    }
    lease.finish();
});
