import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { stripVTControlCharacters as plain } from "node:util";
import { jiti, visibleWidth } from "./helpers.mjs";

const { runMenu, defineMenu } = await jiti.import("@pi-extensions/pi-kit");
const { createTuiHarness, createRpcHarness } = await import("../../tests/interaction-harness.mjs");
const { createMenuScreenComponent } = await jiti.import(
    "../../pi-kit/src/interaction/menu-components.ts",
);
const { wrapWords } = await jiti.import("../../pi-kit/src/interaction/layout.ts");
const callers = await jiti.import("../src/interactive-ui.ts");
const identityTheme = { fg: (_color, text) => text, bold: (text) => text };
const keybindings = { matches: () => false, getKeys: () => [] };
const runtime = { getState: () => undefined };

const text = (frame) => frame.map(plain);

const selected = (frame) => {
    const rows = text(frame);
    // Match the native selection arrow, not the search input's > prompt.
    const start = rows.findLastIndex((line) => /^→/u.test(line));
    if (start < 0) return [];
    const selectedRows = [rows[start]];
    for (let index = start + 1; index < rows.length && /^│/u.test(rows[index]); index++) {
        selectedRows.push(rows[index]);
    }
    return selectedRows;
};

const menuFor = (screen, actions = {}) =>
    defineMenu({ start: "main", screens: { main: () => screen }, actions });

function bounded(frame, width, rows) {
    assert.ok(frame.every((line) => visibleWidth(line) <= width), JSON.stringify(text(frame)));
    assert.ok(frame.length <= Math.max(1, rows - 3), `${frame.length} rows at height ${rows}`);
}

async function open(screen, actions, options = {}, owner = {}) {
    const tui = createTuiHarness({ width: 24, rows: 60, ...options });
    const ctx = { mode: "tui", hasUI: true, ui: { custom: tui.custom, notify: () => {} } };
    const running = runMenu(ctx, menuFor(screen, actions), { ...runtime, ...owner });
    await tui.waitForOpen();
    return { tui, running, ctx };
}

async function close(tui, running) {
    tui.press("ctrl+c");
    await tui.waitForPending();
    assert.deepEqual(await running, { kind: "closed", reason: "close" });
}

// Exact output proves normal words move intact, rather than merely fitting width.
test("strict whitespace wrapping, indivisible URLs/CJK/emoji and grapheme-safe ellipsis", () => {
    assert.deepEqual(wrapWords("hello world from Plan Mode", 15).map(plain), [
        "hello world",
        "from Plan Mode",
    ]);
    assert.deepEqual(wrapWords("alpha beta gamma", 8).map(plain), ["alpha", "beta", "gamma"]);
    assert.deepEqual(wrapWords("x abcdefghijkl y", 7).map(plain), ["x", "abcd...", "y"]);
    assert.deepEqual(wrapWords("https://example.test/very-long-id next", 12).map(plain), [
        "https://e...",
        "next",
    ]);
    assert.deepEqual(wrapWords("👩‍💻👩‍💻👩‍💻 end", 5).map(plain), ["👩‍💻...", "end"]);
    assert.deepEqual(wrapWords("界界界 abc", 5).map(plain), ["界...", "abc"]);
    assert.deepEqual(wrapWords("e\u0301".repeat(5), 4).map(plain), ["e\u0301..."]);
    assert.deepEqual(wrapWords("a\t b\n c", 3), ["a b", "c"]);
    assert.deepEqual(wrapWords("\x1b[31malpha\x1b[0m \u202ebeta", 5), ["alpha", "beta"]);
    assert.deepEqual(wrapWords("\x1b]8;;https://evil\x07safe\x1b]8;;\x07", 8), ["safe"]);
    assert.deepEqual(wrapWords("ignored", 0), []);
    for (const width of [1, 2, 3, 4, 8, 15, 40, 80]) {
        const rows = wrapWords("a 👩‍💻".repeat(5) + " https://example.test/a/b/c", width);
        assert.ok(rows.every((row) => visibleWidth(row) <= width));
    }
});

test(
    "actions and choice descriptions wrap below 40 columns, with "
        + "no repeated token fragments",
    async () => {
        for (const kind of ["actions", "choice"]) {
            const screen = {
                kind,
                title: "Word wrapped picker",
                action: "pick",
                items: [
                    {
                        id: "raw-id",
                        label: "Start fresh and implement",
                        description: "Keep approved plan intact",
                        action: "pick",
                    },
                    { id: "other", label: "Another option", action: "pick" },
                ],
            };
            const { tui, running } = await open(screen, { pick: () => ({ kind: "close" }) }, {
                width: 18,
            });
            assert.deepEqual(selected(tui.render()), [
                "→ Start fresh and",
                "│ implement · Keep",
                "│ approved plan",
                "│ intact",
            ]);
            const wide = tui.resize({ width: 70, rows: 60 });
            assert.ok(
                text(wide).includes("→ Start fresh and implement · Keep approved plan intact"),
            );
            assert.deepEqual(selected(tui.resize({ width: 18 })), [
                "→ Start fresh and",
                "│ implement · Keep",
                "│ approved plan",
                "│ intact",
            ]);
            await close(tui, running);
        }
    },
);

test(
    "all picker kinds obey cell and live physical-row budgets, "
        + "retaining selected visibility on resize",
    () => {
        for (const kind of ["actions", "choice", "multiSelect", "settings"]) {
            const screen = {
                kind,
                title: "A title with several ordinary words",
                lines: ["context words for resize"],
                action: "pick",
                enableSearch: kind !== "actions",
                viewportSize: 10,
                items: Array.from({ length: 20 }, (_, index) => ({
                    id: `id-${index}`,
                    label: `Option ${index} with several readable words`,
                    action: "pick",
                    currentValue: "A fairly long value",
                    values: ["A fairly long value", "Next value"],
                    selected: false,
                    description: "A description with multiple useful words and "
                        + "https://example.test/oversized-token",
                    details: [
                        "Selected details include averyveryveryverylongtoken and readable prose",
                    ],
                })),
            };
            const component = createMenuScreenComponent({
                screen,
                selectedItemId: "id-19",
                tui: { terminal: { rows: 24 }, requestRender() {} },
                theme: identityTheme,
                keybindings,

                onEvent() {},
            });
            for (const rows of [4, 5, 8, 12, 24, 60]) {
                for (const width of [1, 2, 3, 4, 8, 15, 40, 80]) {
                    const optionsTui = { terminal: { rows }, requestRender() {} };
                    const resized = createMenuScreenComponent({
                        screen,
                        selectedItemId: "id-19",
                        tui: optionsTui,
                        theme: identityTheme,
                        keybindings,

                        onEvent() {},
                    });
                    const frame = resized.render(width);
                    bounded(frame, width, rows);
                    assert.ok(
                        selected(frame).some((line) => line.startsWith("→")),
                        `${kind} width ${width} height ${rows}: ${JSON.stringify(frame)}`,
                    );
                    resized.dispose();
                }
            }
            assert.deepEqual(component.render(0), []);
            assert.deepEqual(component.render(-1), []);
            bounded(component.render(15.9), 15, 24);
            component.dispose();
        }
    },
);

test("empty and no-match statuses wrap at narrow widths with physical-row pinning", () => {
    for (const kind of ["choice", "settings", "multiSelect"]) {
        for (const empty of [true, false]) {
            const noun = kind === "choice" ? "choices" : kind === "settings" ? "settings" : "items";
            const messageRows = empty && noun !== "settings"
                ? [`  No ${noun}`, "  available"]
                : ["  No", `  ${empty ? noun : "matching"}`, `  ${empty ? "available" : noun}`];
            const tui = { terminal: { rows: 60 }, requestRender() {} };
            const component = createMenuScreenComponent({
                screen: {
                    kind,
                    title: "Picker",
                    enableSearch: true,
                    items: empty ? [] : [
                        {
                            id: "alpha",
                            label: "Alpha",
                            selected: false,
                            currentValue: "on",
                            values: ["on", "off"],
                        },
                    ],
                    ...(kind === "multiSelect"
                        ? { actions: [{ id: "done", label: "Done", description: "Helpful words" }] }
                        : {}),
                },
                tui,
                theme: identityTheme,
                keybindings,
                interactionHint: "Close",

                onEvent() {},
            });
            component.focused = true;
            if (!empty) {
                component.handleInput("zzzz");
                assert.ok(text(component.render(24)).some((line) => line.includes("zzzz")));
            }
            for (const rows of [60, kind === "multiSelect" ? 13 : 12]) {
                tui.terminal.rows = rows;
                const frame = component.render(12);
                bounded(frame, 12, rows);
                const lines = text(frame);
                const start = lines.indexOf(messageRows[0]);
                assert.ok(start >= 0, `${kind} empty=${empty}: ${JSON.stringify(lines)}`);
                assert.deepEqual(lines.slice(start, start + messageRows.length), messageRows);
                assert.ok(lines.some((line) => line.includes(">")), JSON.stringify(lines));
                if (kind === "multiSelect") {
                    assert.deepEqual(selected(frame), ["→ Done"]);
                    assert.ok(lines.includes("Helpful"));
                    assert.ok(lines.includes("words"));
                }
            }
            for (const rows of [4, 5, 8, 12, 24]) {
                tui.terminal.rows = rows;
                for (const width of [1, 2, 3, 8, 12, 18]) {
                    const frame = component.render(width);
                    bounded(frame, width, rows);
                    if (kind === "multiSelect") {
                        assert.ok(selected(frame).some((line) => line.startsWith("→")));
                    }
                    assert.equal(component.focused, true);
                }
            }
            component.dispose();
        }
    }
    // Choice without search still wraps its empty status.
    const component = createMenuScreenComponent({
        screen: { kind: "choice", title: "Picker", items: [] },
        tui: { terminal: { rows: 60 }, requestRender() {} },
        theme: identityTheme,
        keybindings,

        onEvent() {},
    });
    assert.ok(text(component.render(12)).includes("  No choices"));
    assert.ok(text(component.render(12)).includes("  available"));
    component.dispose();
});

test("search reminders wrap and retain selected rows and description-tail indexing", () => {
    for (const kind of ["choice", "multiSelect"]) {
        const tui = { terminal: { rows: 60 }, requestRender() {} };
        const component = createMenuScreenComponent({
            screen: {
                kind,
                title: "Picker",
                enableSearch: true,
                items: [
                    {
                        id: "alpha",
                        label: "Alpha",
                        selected: false,
                        description: "Helpful words",
                        details: ["Helpful words"],
                    },
                ],
            },
            tui,
            theme: identityTheme,
            keybindings,
            interactionHint: "Close",

            onEvent() {},
        });
        for (const rows of [60, kind === "multiSelect" ? 12 : 14]) {
            tui.terminal.rows = rows;
            const frame = component.render(12);
            bounded(frame, 12, rows);
            const lines = text(frame);
            const reminderIndex = lines.indexOf("Type to");
            assert.ok(reminderIndex >= 0, JSON.stringify(lines));
            assert.equal(lines[reminderIndex + 1], "search");
            assert.ok(lines.includes("Helpful"));
            assert.ok(lines.includes("words"));
            assert.ok(selected(frame).some((line) => line.startsWith("→")));
        }
        for (const rows of [4, 5, 8, 12, 24]) {
            tui.terminal.rows = rows;
            for (const width of [1, 2, 3, 8, 12, 18]) {
                const frame = component.render(width);
                bounded(frame, width, rows);
                assert.ok(selected(frame).some((line) => line.startsWith("→")));
            }
        }
        component.dispose();
    }
});

test(
    "choice search, stable raw IDs, rejection memory, disabled "
        + "rows and keyboard navigation retain native behavior",
    async () => {
        const invocations = [];
        const items = Array.from(
            { length: 16 },
            (_, index) => ({
                id: `raw:${index}`,
                label: `Model ${index} several words`,
                searchText: `alias${index}`,
            }),
        );
        items[3].disabled = true;
        items[3].disabledReason = "Unavailable model credentials";
        const screen = {
            kind: "choice",
            title: "Models",
            action: "pick",
            enableSearch: true,
            viewportSize: 5,
            currentItemId: "raw:2",
            initialItemId: "raw:2",
            items,
        };
        const { tui, running } = await open(screen, {
            pick: ({ itemId }) => {
                invocations.push(itemId);
                return { kind: "rejected" };
            },
        });
        tui.setFocused(true);
        assert.equal(tui.focused, true);
        assert.match(selected(tui.render())[0], /Model 2/);
        tui.press("tui.select.down");
        tui.press("tui.select.confirm");
        assert.deepEqual(invocations, []);
        assert.match(text(tui.render()).join("\n"), /Unavailable/);
        tui.type("alias12");
        assert.match(selected(tui.render())[0], /Model 12/);
        tui.press("tui.select.confirm");
        await tui.waitForOpen();
        assert.deepEqual(invocations, ["raw:12"]);
        assert.match(selected(tui.render())[0], /Model 12/);
        assert.match(text(tui.render()).join("\n"), /alias12/);
        for (let index = 0; index < 7; index++) tui.send("\x7f"); // Public Pi Input clears the query.
        assert.match(selected(tui.render())[0], /Model 12/);
        tui.press("home");
        assert.match(selected(tui.render())[0], /Model 0/);
        tui.press("tui.select.pageDown");
        assert.match(selected(tui.render())[0], /Model 5/);
        tui.press("end");
        assert.match(selected(tui.render())[0], /Model 15/);
        tui.press("tui.select.down");
        assert.match(selected(tui.render())[0], /Model 0/);
        tui.press("tui.select.up");
        assert.match(selected(tui.render())[0], /Model 15/);
        const compact = tui.resize({ width: 12, rows: 5 });
        bounded(compact, 12, 5);
        assert.ok(selected(compact).length);
        await close(tui, running);
    },
);

test(
    "settings label/value wrapping, immediate saves, rollback "
        + "and focus/search remain intact",
    async () => {
        const changes = [];
        const screen = {
            kind: "settings",
            title: "Settings",
            items: [
                {
                    id: "value:raw",
                    label: "Fresh implementation model",
                    currentValue: "Same as plan",
                    values: ["Same as plan", "New selected model"],
                    action: "save",
                    description: "Choose a default model for next time",
                },
                {
                    id: "blocked",
                    label: "Disabled value",
                    currentValue: "keep",
                    values: ["keep", "change"],
                    action: "save",
                    disabled: true,
                },
            ],
        };
        const { tui, running } = await open(screen, {
            save: ({ itemId, value }) => {
                changes.push({ itemId, value });
                return { kind: "rejected" };
            },
        }, { width: 20 });
        assert.deepEqual(selected(tui.render()), [
            "→ Fresh",
            "│ implementation",
            "│ model: Same as",
            "│ plan",
        ]);
        tui.press("tui.select.confirm");
        assert.match(selected(tui.render()).map((row) => row.slice(2)).join(" "), /New selected/);
        await tui.waitForPending();
        assert.deepEqual(changes, [{ itemId: "value:raw", value: "New selected model" }]);
        assert.match(selected(tui.render()).join(" "), /Same as/);
        tui.setFocused(true);
        assert.equal(tui.focused, true);
        tui.type("Disabled");
        tui.send(" ");
        await tui.waitForPending();
        assert.equal(changes.length, 1);
        tui.press("tui.select.cancel");
        await tui.waitForPending();
        assert.deepEqual(await running, { kind: "closed", reason: "back" });
    },
);

test(
    "multi-select wraps tools and action rows, serializes "
        + "toggles, rolls back rejection and pins actions in search",
    async () => {
        const changes = [];
        const screen = {
            kind: "multiSelect",
            title: "Tools",
            action: "toggle",
            enableSearch: true,
            viewportSize: 5,
            items: [
                {
                    id: "tool:raw",
                    label: "Read repository metadata and documentation",
                    selected: false,
                    description: "Read without mutating files",
                },
                {
                    id: "blocked",
                    label: "Blocked tool",
                    selected: false,
                    disabled: true,
                    disabledReason: "Policy disallows this tool",
                },
            ],
            actions: [{ id: "done:raw", label: "Done - start with this policy", action: "done" }],
        };
        const { tui, running } = await open(screen, {
            toggle: ({ itemId, selected }) => {
                changes.push({ itemId, selected });
                return { kind: "rejected" };
            },
            done: ({ itemId }) => {
                changes.push({ itemId });
                return { kind: "close" };
            },
        }, { width: 22 });
        assert.deepEqual(selected(tui.render()), [
            "→ [ ] Read repository",
            "│ metadata and",
            "│ documentation",
        ]);
        tui.send(" ");
        assert.match(selected(tui.render())[0], /\[x\]/);
        await tui.waitForPending();
        assert.deepEqual(changes, [{ itemId: "tool:raw", selected: true }]);
        assert.match(selected(tui.render())[0], /\[ \]/);
        tui.press("tui.select.down");
        tui.send(" ");
        await tui.waitForPending();
        assert.equal(changes.length, 1);
        tui.type("no-matching-toggle");
        assert.deepEqual(selected(tui.render()), ["→ Done - start with", "│ this policy"]);
        assert.match(text(tui.render()).join("\n"), /No matching items/);
        tui.press("tui.select.confirm");
        await tui.waitForPending();
        assert.deepEqual(await running, { kind: "closed", reason: "close" });
        assert.deepEqual(changes[1], { itemId: "done:raw" });
    },
);

test(
    "action routing, disabled actions, nested Back and remapped "
        + "bindings survive multiline presentation",
    async () => {
        let activated;
        const tui = createTuiHarness({
            width: 18,
            rows: 60,
            keybindings: {
                matches: (data, action) =>
                    ({
                        "tui.select.up": "k",
                        "tui.select.down": "j",
                        "tui.select.confirm": "x",
                        "tui.select.cancel": "q",
                    })[action] === data,
                getKeys: (action) =>
                    [
                        {
                            "tui.select.up": "k",
                            "tui.select.down": "j",
                            "tui.select.confirm": "x",
                            "tui.select.cancel": "q",
                        }[action],
                    ].filter(Boolean),
            },
        });
        const ctx = { mode: "tui", hasUI: true, ui: { custom: tui.custom, notify() {} } };
        const menu = defineMenu({
            start: "main",
            screens: {
                main: () => ({
                    kind: "actions",
                    title: "Actions",
                    items: [
                        {
                            id: "disabled",
                            label: "Unavailable action with words",
                            action: "pick",
                            disabled: true,
                            disabledReason: "Missing required credentials",
                        },
                        { id: "nested", label: "Open nested thinking picker", to: "nested" },
                    ],
                }),
                nested: () => ({
                    kind: "choice",
                    title: "Thinking",
                    action: "pick",
                    items: [{ id: "thinking:raw", label: "Deep reasoning with words" }],
                }),
            },
            actions: {
                pick: ({ itemId }) => {
                    activated = itemId;
                    return { kind: "close" };
                },
            },
        });
        const running = runMenu(ctx, menu, runtime);
        await tui.waitForOpen();
        tui.send("x");
        assert.equal(activated, undefined);
        tui.send("j");
        tui.send("x");
        await tui.waitForOpen();
        assert.match(text(tui.render()).join("\n"), /Thinking/);
        tui.send("q");
        await tui.waitForOpen();
        assert.match(selected(tui.render()).join(" "), /Open nested/);
        tui.send("x");
        await tui.waitForOpen();
        tui.send("x");
        assert.deepEqual(await running, { kind: "closed", reason: "close" });
        assert.equal(activated, "thinking:raw");
    },
);

test(
    "theme invalidation recomputes styled lines, owner abort "
        + "remains stale and Ctrl+C remains hard close",
    async () => {
        let color = 31;
        const owner = new AbortController();
        const { tui, running } = await open(
            {
                kind: "choice",
                title: "Models",
                action: "pick",
                items: [{ id: "raw", label: "One long readable choice" }],
            },
            { pick: () => ({ kind: "stay" }) },
            {
                width: 14,
                theme: {
                    fg: (_role, value) => `\x1b[${color}m${value}\x1b[0m`,
                    bold: (value) => value,
                },
            },
            { signal: owner.signal },
        );
        const before = tui.render();
        assert.ok(before.some((line) => line.includes("\x1b[31m")));
        color = 32;
        tui.invalidate();
        const after = tui.resize({ width: 10, rows: 12 });
        assert.ok(after.some((line) => line.includes("\x1b[32m")));
        assert.ok(after.every((line) => !line.includes("\x1b[31m")));
        bounded(after, 10, 12);
        owner.abort();
        assert.deepEqual(await running, { kind: "stale" });
    },
);

test(
    "RPC adapter explicitly preserves dialogs across all picker "
        + "kinds, duplicate labels, raw IDs and cancellation",
    async () => {
        for (const kind of ["actions", "choice", "multiSelect", "settings"]) {
            const screen = {
                kind,
                title: "RPC picker",
                action: "pick",
                enableSearch: true,
                items: [
                    {
                        id: "raw:\x1b:1",
                        label: "Same label",
                        action: "pick",
                        selected: false,
                        currentValue: "old",
                        values: ["old", "next"],
                    },
                    {
                        id: "raw:2",
                        label: "Same label",
                        action: "pick",
                        selected: false,
                        currentValue: "old",
                        values: ["old", "next"],
                    },
                ],
            };
            const expected = kind === "multiSelect"
                ? ["[ ] Same label", "[ ] Same label [2]", "Back"]
                : kind === "settings"
                ? ["Same label (old)", "Same label (old) [2]", "Back"]
                : kind === "choice"
                ? ["Same label", "Same label [2]", "Back"]
                : ["Same label", "Same label [2]"];

            async function drive(runner) {
                const calls = [];
                const rpc = createRpcHarness([
                    {
                        kind: "select",
                        title: "RPC picker",
                        options: expected,
                        response: expected[1],
                    },
                    { kind: "select", title: "RPC picker", options: expected, response: undefined },
                ]);
                const ctx = { mode: "rpc", hasUI: true, ui: { ...rpc.ui, notify() {} } };
                const result = await runner(
                    ctx,
                    menuFor(screen, {
                        pick: ({ itemId, value, selected }) => {
                            calls.push({ itemId, value, selected });
                            return { kind: "rejected" };
                        },
                    }),
                    runtime,
                );
                rpc.assertConsumed();
                return { result, calls };
            }

            assert.deepEqual(await drive(runMenu), {
                result: { kind: "closed", reason: "back" },
                calls: [{
                    itemId: "raw:2",
                    value: kind === "settings" ? "next" : undefined,
                    selected: kind === "multiSelect" ? true : undefined,
                }],
            });
        }
    },
);

test(
    "real Plan Mode launch caller uses wrapped tool/action "
        + "labels and preserves raw tool names",
    async () => {
        const tui = createTuiHarness({ width: 24, rows: 60 });
        const raw = "provider/very-long-raw-tool-name";
        let started;
        const ctx = { mode: "tui", hasUI: true, ui: { custom: tui.custom } };
        const running = callers.showPlanLaunchMenu(ctx, {
            initialScreen: "tools",
            statusText: "Ready",
            getSelectedNames: () => [],
            toolSummary: () => "Policy",
            tools: [{ name: raw, label: "Read repository metadata and docs" }],
            isCurrent: () => true,
            startWithTools: (names) => {
                started = names;
            },
        });
        await tui.waitForOpen();
        assert.deepEqual(selected(tui.render()), ["→ [ ] Read repository", "│ metadata and docs"]);
        tui.send(" ");
        await tui.waitForPending();
        await tui.waitForOpen();
        tui.press("tui.select.down");
        // At 24 columns, the 2-cell selection inset leaves 22 cells for text.
        assert.deepEqual(selected(tui.render()), ["→ Done - start with this", "│ policy"]);
        tui.press("tui.select.confirm");
        await tui.waitForPending();
        await running;
        assert.deepEqual(started, [raw]);
    },
);

test("real Plan Mode main menu uses the questionnaire arrow marker", async () => {
    const tui = createTuiHarness({ width: 60, rows: 60 });
    let started = false;
    const running = callers.showPlanLaunchMenu({
        mode: "tui",
        hasUI: true,
        ui: { custom: tui.custom },
    }, {
        statusText: "Ready",
        getSelectedNames: () => [],
        toolSummary: () => "Policy",
        tools: [],
        isCurrent: () => true,
        start: () => {
            started = true;
        },
    });
    await tui.waitForOpen();
    assert.deepEqual(selected(tui.render()), ["→ Start Plan mode"]);
    tui.press("tui.select.confirm");
    await running;
    assert.equal(started, true);
});

test("real Plan Mode caller retains RPC labels and unsupported-mode routing", async () => {
    const rpc = createRpcHarness([{
        kind: "select",
        title: "Plan mode\nReady\nPolicy",
        options: [
            "Start Plan mode",
            "Choose tools, then start...",
            "Settings",
            "How Plan mode works",
        ],
        response: "Start Plan mode",
    }]);
    let started = false;
    await callers.showPlanLaunchMenu({ mode: "rpc", hasUI: true, ui: rpc.ui }, {
        statusText: "Ready",
        getSelectedNames: () => [],
        toolSummary: () => "Policy",
        tools: [],
        isCurrent: () => true,
        start: () => {
            started = true;
        },
    });
    rpc.assertConsumed();
    assert.equal(started, true);
    for (const [mode, hasUI] of [["tui", false], ["rpc", false], ["print", true]]) {
        async function drive(runner) {
            const unsupported = [];
            const result = await runner(
                { mode, hasUI },
                menuFor({ kind: "actions", title: "Unused", items: [] }),
                {
                    ...runtime,
                    onUnsupportedMode: (_ctx, value) => {
                        unsupported.push(value);
                    },
                },
            );
            return { result, unsupported };
        }

        assert.deepEqual(await drive(runMenu), {
            result: { kind: "unsupported", mode },
            unsupported: [mode],
        });
    }
});

test(
    "shared runtime and declaration closure has no vendor dependency or generated chunks",
    () => {
        const root = new URL("../../pi-kit/", import.meta.url);
        assert.equal(existsSync(new URL("vendor/", root)), false);
        assert.equal(existsSync(new URL("src/chunks/", root)), false);
        const files = [];

        function walk(directory) {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const file = new URL(entry.name, directory);
                if (entry.isDirectory()) {
                    walk(new URL(entry.name + "/", directory));
                    continue;
                }
                assert.ok(/\.(?:ts|js)$/u.test(entry.name), entry.name);
                files.push(file);
                const source = readFileSync(file, "utf8");
                assert.ok(!source.includes("@ts-nocheck"), entry.name);
                assert.ok(!source.includes("@narumitw"), `${entry.name}: vendor reference`);
                assert.ok(
                    !/node_modules|\/tmp\/|pi-independent-baseline/u.test(source),
                    entry.name,
                );
                for (
                    const [, , specifier] of source.matchAll(
                        /(?:from\s*|import\s*\(|require\s*\()(["'])([^"']+)\1/gu,
                    )
                ) {
                    if (specifier.startsWith(".")) {
                        assert.ok(
                            existsSync(new URL(specifier, file)),
                            `${entry.name}: ${specifier}`,
                        );
                    } else if (!specifier.startsWith("@earendil-works/")) {
                        const resolved = import.meta.resolve(specifier);
                        assert.ok(
                            resolved.startsWith("node:") || existsSync(new URL(resolved)),
                            specifier,
                        );
                    }
                }
            }
        }

        walk(new URL("src/", root));
        const ui = files.filter((file) => file.pathname.includes("/interaction/"));
        assert.ok(ui.length > 0, "interaction sources are present");
        for (const file of ui) {
            assert.ok(
                !/grok-mermaid|highlight\.js/u.test(
                    readFileSync(file, "utf8"),
                ),
                file.pathname,
            );
        }
        for (const kind of ["browse", "review"]) {
            assert.throws(
                () => createMenuScreenComponent({ screen: { kind } }),
                /Unsupported Plan Mode screen/u,
            );
        }
    },
);
