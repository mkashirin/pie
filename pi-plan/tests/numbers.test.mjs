import { test } from "node:test";
import assert from "node:assert/strict";
import { jiti } from "./helpers.mjs";

const { runQuestionnaire } = await jiti.import("../src/picker-ui.ts");
const { createTuiHarness } = await jiti.import("@narumitw/pi-tui-kit/testing");
const question = {
    id: "original:id",
    header: "Choice",
    prompt: "Which answer?",
    options: [{ label: "First raw answer" }, { label: "Second raw answer" }],
};

async function open(options = {}) {
    const tui = createTuiHarness({ width: 60, rows: 100 });
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
