import { Container, Spacer, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import test from "node:test";
import { activity, presentation, ui } from "./helpers.mjs";

const { createChatViewport } = await import(
    new URL(
        "./modes/interactive/chat-viewport.js",
        import.meta.resolve("@earendil-works/pi-coding-agent"),
    )
);
const { renderLayoutFrame } = await import(
    new URL(
        "./layout.js",
        import.meta.resolve("@earendil-works/pi-tui"),
    )
);
const theme = { fg: (_token, value) => value, bold: (value) => value };

const worker = (i, extra = {}) => ({
    id: `run-${i}`,
    agent: `worker-${i}`,
    profile: "worker",
    model: "provider/very-long-model-name".repeat(8),
    status: "running",
    durationMs: 1000,
    activity: activity.activityPreview("worker", "edit", {
        path: `src/${"long-path/".repeat(20)}a.ts`,
        edits: [{
            oldText: `OLD_${i}_CODE_BUDGET_0123456789\nOLD_SECOND_${i}\x1b[2J\u202e`,
            newText: `NEW_${i}_CODE_BUDGET_0123456789\nNEW_SECOND_${i}\x1b[2J\u202e`,
        }],
    }, "running"),
    ...extra,
});

const fleet = (rows) =>
    new ui.FleetComponent(
        () => [{ live: true, rows: new Map(rows.map((row) => [row.id, row])) }],
        theme,
        () => {},
    );

const text = (...lines) => ({ render: () => lines, invalidate() {} });

for (const width of [80, 100]) {
    for (const count of [4, 8]) {
        test(`installed fullscreen host keeps ${count} status-only rows at ${width}x24`, () => {
            const component = fleet(Array.from({ length: count }, (_, i) => worker(i)));
            // Match InteractiveMode.renderWidgetContainer: one leading spacer, then the factory component.
            const widgetsAbove = new Container();
            widgetsAbove.addChild(new Spacer(1));
            widgetsAbove.addChild(component);
            const viewport = createChatViewport({
                document: text("TRANSCRIPT: delegated edits in progress"),
                pendingMessages: text("PENDING: next instruction"),
                status: text("STATUS: working", ""),
                widgetsAbove,
                editor: text(
                    "EDITOR: ───────────────────",
                    "> representative input",
                    "EDITOR: ───────────────────",
                ),
                widgetsBelow: text(),
                footer: text("FOOTER: ~/project (main)", "FOOTER: 12k tokens | model | high"),
                scrollbar: "hidden",
            });
            const lines = renderLayoutFrame(viewport.root, width, 24, () => {}).lines.map(
                stripTerminalSequences,
            );
            assert.equal(lines.length, 24);
            assert.ok(lines.every((line) => visibleWidth(line) <= width));
            assert.deepEqual(
                lines.filter((line) => /^worker-/.test(line)),
                Array.from({ length: count }, (_, i) => `worker-${i} | running | 1s`),
            );
            assert.doesNotMatch(lines.join("\n"), /OLD_|NEW_|long-path|long-model|proposed|#/);
            for (
                const label of [
                    "TRANSCRIPT:",
                    "PENDING:",
                    "STATUS:",
                    "EDITOR:",
                    "> representative input",
                    "FOOTER: ~/",
                    "FOOTER: 12k",
                ]
            ) {
                assert.ok(lines.some((line) => line.startsWith(label)), `${label} remains visible`);
            }
            const raw = component.render(width).map(stripTerminalSequences);
            assert.equal(raw.length, 1 + count);
            assert.ok(raw.every((line) => !line.startsWith(" ")));
        });
    }
}

test("long tool/path arguments never enter fleet but remain in live chat previews", () => {
    const path = `PRIVATE_PATH/${"long-path/".repeat(50)}a.ts`;
    const command = `PRIVATE_COMMAND ${"--long-argument ".repeat(50)}`;
    const cases = [
        ["worker", "edit", {
            path,
            edits: [{ oldText: "PRIVATE_OLD\nOLD_SECOND", newText: "PRIVATE_NEW\nNEW_SECOND" }],
        }],
        ["worker", "write", { path, content: "PRIVATE_WRITE\nWRITE_SECOND" }],
        ["scout", "read", { path, offset: 20, limit: 10 }],
        ["reviewer", "bash", { command }],
        ["researcher", "openai_search", { queries: [command] }],
    ];
    for (const [profile, tool, args] of cases) {
        for (const stage of ["pending", "running", "succeeded", "failed", "blocked"]) {
            const preview = activity.activityPreview(profile, tool, args, stage);
            const row = worker(0, {
                profile,
                activity: preview,
                task: "PRIVATE_TASK",
                reason: "PRIVATE_REASON",
                lastActivity: "PRIVATE_ACTIVITY",
                report: { summary: "PRIVATE_SUMMARY" },
            });
            const before = JSON.stringify(row);
            assert.deepEqual(fleet([row]).render(2000), [
                "Agents | 1 calls | 1 runs",
                "worker-0 | running | 1s",
            ]);
            assert.deepEqual(presentation.compactRunLines(row, theme, true), [
                "worker-0 | running | 1s",
            ]);
            for (const expanded of [false, true]) {
                const chat = new presentation.AgentCards([row], theme, expanded).render(2000);
                assert.equal(chat[0], "worker-0 | running");
                assert.equal(chat[1], `Role: ${profile} | Model: ${row.model}`);
                assert.equal(chat[2], "Elapsed: 1s | 0 turns");
                assert.equal(
                    chat[3],
                    `${
                        stage === "succeeded"
                            ? "x "
                            : stage === "failed"
                            ? "x "
                            : ""
                    }${stage} | ${preview.action} | ${tool}`,
                );
                assert.equal(
                    chat[4],
                    tool === "bash"
                        ? `$ ${preview.focus}`
                        : ["read", "edit", "write"].includes(tool)
                        ? `${tool} ${preview.focus}`
                        : `Focus: ${preview.focus}`,
                );
                if (stage === "succeeded") {
                    assert.equal(chat[5], "tool reported success (not diff verification)");
                }
                assert.deepEqual(
                    chat.slice(stage === "succeeded" ? 6 : 5),
                    preview.snippets.length
                        ? ["", "...", ...preview.snippets.map((s) => `${s.sign} ${s.text}`), "..."]
                        : [],
                );
            }
            assert.equal(JSON.stringify(row), before);
        }
    }
});

test("status-only fleet sanitizes names, clips widths and styles at render time without diff colors", () => {
    const row = worker(0, { agent: "worker\x1b[2J\u202e\nSAFE" });
    const dynamicTheme = { fg: (_token, value) => `\x1b[31m${value}\x1b[0m` };
    const component = new ui.FleetComponent(
        () => [{ live: true, rows: new Map([[row.id, row]]) }],
        dynamicTheme,
        () => {},
    );
    for (const width of [0, 1, 2, 20, 80, 100]) {
        const lines = component.render(width);
        const plain = lines.map(stripTerminalSequences);
        assert.equal(lines.length, width ? 2 : 0);
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
        assert.ok(plain.every((line) => !line.startsWith(" ")));
        assert.ok(plain.every((line) => !/[\x00-\x1f\x7f-\x9f\u202e]/.test(line)));
        if (width >= 80) assert.equal(plain[1], "worker SAFE | running | 1s");
    }
    const before = component.render(80);
    const tokens = [];
    dynamicTheme.fg = (token, value) => {
        tokens.push(token);
        return `\x1b[32m${value}\x1b[0m`;
    };
    component.invalidate();
    const after = component.render(80);
    assert.notDeepEqual(after, before);
    assert.deepEqual(after.map(stripTerminalSequences), before.map(stripTerminalSequences));
    assert.deepEqual(tokens, ["accent", "accent", "muted"]);
});
