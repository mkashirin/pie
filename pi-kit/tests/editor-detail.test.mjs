import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { createJiti } from "jiti";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { createTuiHarness } from "../../tests/interaction-harness.mjs";

const jiti = createJiti(import.meta.url);
const { runMenu, visibleWidth } = await jiti.import("../src/index.ts");
const { AnswerEditor } = await jiti.import("../src/interaction/editor.ts");

test("editor cursor movement through raw terminal strings never exposes their payload", () => {
    const keys = new KeybindingsManager(TUI_KEYBINDINGS);
    const editor = new AnswerEditor(keys);
    editor.focused = true;
    for (
        const raw of [
            "before\x1b]52;c;secret\x07after",
            "before\u009dsecret\u009cafter",
            "before\x1bPsecret\nprivate\x1b\\after",
            "before\x1b_very private",
        ]
    ) {
        editor.setValue(raw);
        for (let index = 0; index <= raw.length; index++) {
            for (const width of [1, 2, 3, 8, 80]) {
                const frame = editor.render(width);
                const text = frame.map(plain).join("");
                assert.ok(!/secret|private/u.test(text), JSON.stringify(text));
                assert.ok(frame.every((row) => visibleWidth(row) <= width));
            }
            editor.handleInput("\x1b[D");
        }
        assert.equal(editor.getValue(), raw);
    }
});

test("detail prose remains accessible with injected scroll bindings and live physical budgets", async () => {
    const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
        "tui.select.up": "k",
        "tui.select.down": "j",
        "tui.select.pageDown": "f",
        "tui.select.pageUp": "b",
        "tui.select.cancel": "q",
    });
    const tui = createTuiHarness({ width: 20, rows: 7, keybindings });
    const running = runMenu({ mode: "tui", hasUI: true, ui: { custom: tui.custom } }, {
        start: "detail",
        screens: {
            detail: () => ({
                kind: "detail",
                title: "Details",
                lines: Array.from({ length: 20 }, (_, index) => `Line ${index} readable prose`),
            }),
        },
    }, { getState: () => undefined });
    await tui.waitForOpen();
    const first = tui.render();
    assert.ok(first.map(plain).includes("Details"));
    assert.ok(!first.map(plain).join("").includes("No items"));
    tui.press("down");
    assert.deepEqual(tui.render(), first, "default navigation must not override remapping");
    tui.send("j");
    assert.notDeepEqual(tui.render(), first);
    tui.send("f");
    assert.ok(tui.render().map(plain).some((line) => line.includes("Line 2")));
    tui.press("end");
    assert.ok(tui.render().map(plain).some((line) => line.includes("Line 19")));
    for (const width of [1, 2, 12, 80]) {
        const frame = tui.resize({ width, rows: 4 });
        assert.ok(frame.length <= 1);
        assert.ok(frame.every((row) => visibleWidth(row) <= width));
    }
    tui.resize({ width: 20, rows: 7 });
    tui.press("home");
    assert.deepEqual(tui.render(), first);
    tui.send("q");
    assert.deepEqual(await running, { kind: "closed", reason: "back" });
});
