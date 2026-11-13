import { test } from "node:test";
import assert from "node:assert/strict";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { jiti } from "./helpers.mjs";

const { runQuestionnaire } = await jiti.import("@pi-extensions/pi-kit");
const { createTuiHarness } = await import("../../tests/interaction-harness.mjs");
const question = {
    id: "original:id",
    header: "Choice",
    prompt: "Which answer?",
    options: [{ label: "First raw answer" }, { label: "Second raw answer" }],
};

async function open(options = {}, harnessOptions = {}) {
    const tui = createTuiHarness({ width: 60, rows: 100, ...harnessOptions });
    const running = runQuestionnaire({ mode: "tui", hasUI: true, ui: { custom: tui.custom } }, {
        questions: [question],
        ...options,
    });
    await tui.waitForOpen();
    return { tui, running };
}

test("number keys choose and submit the corresponding raw answer; invalid numbers do nothing", async () => {
    const { tui, running } = await open();
    tui.send("0");
    tui.send("9");
    tui.send("2");
    assert.deepEqual(await running, {
        kind: "submitted",
        answers: [{
            questionId: question.id,
            answer: "Second raw answer",
            wasCustom: false,
            optionIndex: 2,
        }],
    });
});

test("numbers advance multiple questions but do not submit review; digits remain literal in editors", async () => {
    const { tui, running } = await open({
        questions: [question, { ...question, id: "second:id" }],
    });
    tui.send("2");
    tui.send("3"); // Other (free-form).
    tui.type("123 is my custom answer");
    tui.press("tui.input.submit");
    tui.send("1"); // Review still requires its normal confirmation.
    tui.press("tui.select.confirm");
    assert.deepEqual((await running).answers, [
        { questionId: question.id, answer: "Second raw answer", wasCustom: false, optionIndex: 2 },
        { questionId: "second:id", answer: "123 is my custom answer", wasCustom: true },
    ]);
});

test("number shortcuts preserve notes and existing cancellation", async () => {
    const { tui, running } = await open({ allowNotes: true });
    tui.send("n");
    tui.type("123 remains a note");
    tui.press("tui.input.submit");
    tui.send("1");
    assert.equal((await running).answers[0].note, "123 remains a note");
    const cancelled = await open();
    cancelled.tui.press("tui.select.cancel");
    assert.deepEqual(await cancelled.running, { kind: "closed", reason: "back" });
});

test("numeric remappings win over shortcuts, and control bindings retain editor scope", async () => {
    const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
        "tui.select.up": "2",
        "tui.select.down": "1",
        "tui.select.confirm": "ctrl+a",
        "tui.select.cancel": "q",
        "tui.input.submit": "ctrl+e",
    });
    const selected = await open({}, { keybindings });
    selected.tui.send("1"); // Remapped Down, not answer 1.
    selected.tui.press("enter"); // The original confirm is no longer bound.
    assert.equal(selected.tui.settled, false);
    selected.tui.press("ctrl+a");
    assert.equal((await selected.running).answers[0].optionIndex, 2);

    const custom = await open({}, { keybindings });
    custom.tui.send("3");
    custom.tui.type("123"); // Navigation remappings do not steal editor digits.
    custom.tui.send("\x1b[52u"); // Kitty-encoded ordinary digit.
    custom.tui.press("enter");
    assert.equal(custom.tui.settled, false);
    custom.tui.press("ctrl+e");
    assert.deepEqual((await custom.running).answers, [
        { questionId: question.id, answer: "1234", wasCustom: true },
    ]);

    const cancelled = await open({}, { keybindings });
    cancelled.tui.press("escape");
    assert.equal(cancelled.tui.settled, false);
    cancelled.tui.send("q");
    assert.deepEqual(await cancelled.running, { kind: "closed", reason: "back" });
    const closed = await open({}, { keybindings });
    closed.tui.press("ctrl+c");
    assert.deepEqual(await closed.running, { kind: "closed", reason: "close" });
});

test("native encoded digits select answers but modified digits and review digits do not", async () => {
    const active = await open();
    active.tui.send("\x1b[50;5u"); // Ctrl+2 is not answer 2.
    assert.equal(active.tui.settled, false);
    active.tui.send("\x1b[50u");
    assert.equal((await active.running).answers[0].optionIndex, 2);
    const review = await open({ questions: [question, { ...question, id: "second" }] });
    review.tui.send("\x1b[49u");
    review.tui.send("\x1b[50u");
    review.tui.send("\x1b[49u");
    assert.equal(review.tui.settled, false);
    review.tui.press("tui.select.confirm");
    assert.deepEqual((await review.running).answers.map((answer) => answer.optionIndex), [1, 2]);
});
