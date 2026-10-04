import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import test from "node:test";
import { activity, presentation } from "./helpers.mjs";

const host = (relative) =>
    import(new URL(relative, import.meta.resolve("@earendil-works/pi-coding-agent")));

const { getThemeByName } = await host("./modes/interactive/theme/theme.js");
const { readRenderers } = await host("./core/tools/renderers/read.js");
const { editRenderers } = await host("./core/tools/renderers/edit.js");
const { createShellRenderers } = await host("./core/tools/renderers/bash.js");
const { ToolExecutionComponent } = await host("./modes/interactive/components/tool-execution.js");

const row = (preview) => ({
    agent: "worker",
    profile: "worker",
    model: "test/model",
    status: "running",
    durationMs: 1000,
    activity: preview,
});

test("native installed headers: bold action/command, accent path, warning read window", () => {
    initTheme("dark");
    for (const palette of ["dark", "light", "system"]) {
        const theme = Object.create(getThemeByName(palette));
        // Chalk disables attributes in a non-TTY test process; exercise the actual bold calls.
        theme.bold = (value) => `\x1b[1m${value}\x1b[22m`;
        for (
            const [tool, args, renderer] of [
                ["read", { path: "src/example.ts", offset: 20, limit: 10 }, readRenderers],
                ["edit", { path: "src/example.ts" }, editRenderers],
                ["bash", { command: "printf '界👩‍💻é'" }, createShellRenderers("$")],
            ]
        ) {
            const preview = activity.activityPreview("worker", tool, args, "running");
            const ours = presentation.compactRunLines(row(preview), theme)[4];
            const native = renderer.renderCall(args, theme, {
                cwd: process.cwd(),
                state: {},
                argsComplete: false,
                expanded: true,
            }).render(200).find((line) => stripTerminalSequences(line).trim());
            assert.equal(stripTerminalSequences(ours), stripTerminalSequences(native).trim());
            assert.match(ours, /\x1b\[1m/);
            if (tool !== "bash") assert.ok(ours.includes(theme.getFgAnsi("accent")));
            if (tool === "read") assert.ok(ours.includes(theme.getFgAnsi("warning")));
        }
    }
});

test("default/null/invalid read windows remain bounded, complete and presentation-only", () => {
    const theme = getThemeByName("dark");
    for (
        const [args, range] of [
            [{}, "1-2000"],
            [{ offset: null, limit: null }, "1-2000"],
            [{ offset: 3 }, "3-2002"],
            [{ limit: 4 }, "1-4"],
            [{ offset: -1, limit: Infinity }, "1-2000"],
        ]
    ) {
        const input = { path: "界/".repeat(2000), ...args };
        const before = JSON.stringify(input);
        const preview = activity.activityPreview("scout", "read", input, "running");
        assert.ok(preview.focus.endsWith(`:${range}`));
        assert.ok(preview.focus.length <= 240);
        assert.equal(JSON.stringify(input), before);
        assert.match(
            stripTerminalSequences(presentation.compactRunLines(row(preview), theme)[4]),
            /^read /,
        );
    }
});

test("installed tool shell keeps exactly one blank around bounded diffs in both expansion modes", () => {
    initTheme("dark");
    const theme = getThemeByName("dark");
    const run = row(activity.activityPreview("worker", "edit", {
        path: "src/a.ts",
        edits: [{ oldText: "OLD\nSECOND\nOMITTED", newText: "NEW\nSECOND\nOMITTED" }],
    }, "running"));
    const before = JSON.stringify(run);
    for (const expanded of [false, true]) {
        const definition = {
            renderCall: () => ({ render: () => [], invalidate() {} }),
            renderResult: () => new presentation.AgentCards([run, run], theme, expanded),
        };
        const shell = new ToolExecutionComponent("subagents_run", "test", {}, {}, definition, {
            requestRender() {},
        }, process.cwd());
        shell.updateResult({ content: [], details: {} }, true);
        shell.setExpanded(expanded);
        for (const width of [20, 80, 100]) {
            const lines = shell.render(width);
            assert.ok(lines.every((line) => visibleWidth(line) <= width));
            const plain = lines.map((line) => stripTerminalSequences(line).trim());
            for (let i = 0; i < plain.length; i++) {
                if (plain[i] === "- OLD") {
                    assert.equal(plain[i - 1], "");
                    assert.notEqual(plain[i - 2], "");
                }
                if (plain[i] === "+ SECOND") {
                    assert.equal(plain[i + 1], "");
                    // The default host Box owns its final padding row (not a child margin).
                    if (i + 2 < plain.length - 1) assert.notEqual(plain[i + 2], "");
                }
            }
            assert.equal(plain.filter((line) => line === "- OLD").length, 2);
            assert.doesNotMatch(plain.join("\n"), /OMITTED/);
        }
    }
    assert.equal(JSON.stringify(run), before);
    assert.match(
        stripTerminalSequences(
            presentation.compactRunLines({ ...run, activity: undefined }, theme).join("\n"),
        ),
        /Status: awaiting model/,
    );
});
