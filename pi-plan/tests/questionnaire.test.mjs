import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as plain } from "node:util";
import { jiti, visibleWidth } from "./helpers.mjs";

const { runQuestionnaire } = await jiti.import("@pi-extensions/tui");
const { createTuiHarness, createRpcHarness } = await import("../../tests/interaction-harness.mjs");
const { answerPlanModeQuestions } = await jiti.import("../src/question-tool.ts");
const label = "Keep ordinary words together while choosing";
const question = {
    id: "raw:question",
    header: "Wrapping",
    prompt: "Which wrapping policy should this questionnaire follow?",
    options: [
        { label, description: "Helpful details remain readable" },
        { label: "Second option" },
    ],
};

const texts = (frame) => frame.map(plain);

function optionRows(frame) {
    const rows = texts(frame);
    return rows.slice(
        rows.findIndex((line) => line.includes("→ 1.")),
        rows.findIndex((line) => line.startsWith("   2.")),
    );
}

async function open(options = {}, harnessOptions = {}) {
    const tui = createTuiHarness({ width: 24, rows: 100, ...harnessOptions });
    const ctx = { mode: "tui", hasUI: true, ui: { custom: tui.custom, notify() {} } };
    const running = runQuestionnaire(ctx, { questions: [question], ...options });
    await tui.waitForOpen();
    return { tui, running };
}

test(
    "questionnaire prose and options wrap whole words with "
        + "hanging indentation and live resize",
    async () => {
        const { tui, running } = await open();
        assert.deepEqual(optionRows(tui.render()), [
            " → 1. Keep ordinary",
            "      words together",
            "      while choosing -",
            "      Helpful details",
            "      remain readable",
        ]);
        assert.ok(texts(tui.render()).includes(" Which wrapping policy"));
        assert.ok(texts(tui.render()).includes(" questionnaire follow?"));
        assert.equal(optionRows(tui.resize({ width: 100 })).length, 1);
        assert.equal(optionRows(tui.resize({ width: 24 })).length, 5);
        tui.press("tui.select.confirm");
        assert.deepEqual(await running, {
            kind: "submitted",
            answers: [
                { questionId: question.id, answer: label, wasCustom: false, optionIndex: 1 },
            ],
        });
    },
);

test(
    "real Plan Mode question caller uses word wrapping and "
        + "retains original IDs and option labels",
    async () => {
        const tui = createTuiHarness({ width: 24, rows: 100 });
        const questions = [{
            id: "original:id",
            header: question.header,
            question: question.prompt,
            options: question.options,
        }];
        const running = answerPlanModeQuestions(questions, {
            mode: "tui",
            hasUI: true,
            ui: { custom: tui.custom },
        }, { isCurrent: () => true, isEnabled: () => true });
        await tui.waitForOpen();
        assert.deepEqual(optionRows(tui.render()), [
            " → 1. Keep ordinary",
            "      words together",
            "      while choosing -",
            "      Helpful details",
            "      remain readable",
        ]);
        tui.press("tui.select.down");
        tui.press("tui.select.confirm");
        const result = await running;
        assert.equal(result.details.cancelled, false);
        assert.equal(result.details.answers[0].id, "original:id");
        assert.equal(result.details.answers[0].answer, "Second option");
        assert.equal(result.details.answers[0].optionIndex, 2);
    },
);

test(
    "oversized tokens ellipsize safely at Unicode cell "
        + "boundaries without altering answers",
    async () => {
        for (
            const token of [
                "https://example.test/very-long-identifier",
                "👩‍💻".repeat(10),
                "界".repeat(20),
                "e\u0301".repeat(30),
            ]
        ) {
            const { tui, running } = await open({
                questions: [{ ...question, options: [{ label: token + " next" }] }],
            }, { width: 20 });
            const rows = texts(tui.render());
            assert.ok(rows.some((line) => line.includes("...")), rows.join("\n"));
            assert.ok(rows.includes("      next"));
            for (const width of [1, 2, 3, 4, 5, 6, 8, 12, 20, 40, 100]) {
                const frame = tui.resize({ width });
                assert.ok(
                    frame.every((line) => visibleWidth(line) <= width),
                    JSON.stringify(texts(frame)),
                );
                assert.ok(frame.every((line) => !line.includes("\ufffd")));
            }
            tui.press("tui.select.confirm");
            assert.equal((await running).answers[0].answer, token + " next");
        }
    },
);

test("theme styling survives continuation rows, selection changes and invalidation", async () => {
    let accent = 35;
    const { tui, running } = await open({}, {
        theme: {
            fg: (role, value) =>
                `\x1b[${role === "accent" ? accent : role === "muted" ? 36 : 37}m${value}\x1b[0m`,
            bold: (value) => `\x1b[1m${value}\x1b[22m`,
        },
    });
    const frame = tui.render();
    assert.ok(
        frame.filter((line) => plain(line).startsWith("      ")).every((line) =>
            line.includes("\x1b[35m")
        ),
    );
    tui.press("tui.select.down");
    const unselected = tui.render().find((line) => plain(line).includes("Helpful details"));
    assert.ok(unselected.includes("\x1b[36m"));
    accent = 32;
    tui.invalidate();
    const after = tui.render();
    assert.ok(after.some((line) => line.includes("\x1b[32m")));
    assert.ok(after.every((line) => !line.includes("\x1b[35m")));
    tui.press("tui.select.cancel");
    assert.deepEqual(await running, { kind: "closed", reason: "back" });
});

test(
    "multi-question review, notes, custom answers and editor "
        + "focus retain native behavior",
    async () => {
        const { tui, running } = await open({
            questions: [question, { ...question, id: "second" }],
            allowNotes: true,
        });
        tui.send("n");
        tui.setFocused(true);
        assert.equal(tui.focused, true);
        const note = "Raw\ttext\nwith\x1b[31mcontrols";
        tui.send(`\x1b[200~${note}\x1b[201~`);
        tui.press("tui.input.submit");
        tui.press("tui.select.confirm");
        tui.press("tui.select.down");
        tui.press("tui.select.down");
        tui.press("tui.select.confirm");
        const custom = "A custom answer with several intact words";
        tui.type(custom);
        tui.press("tui.input.submit");
        assert.ok(texts(tui.render()).some((line) => line.includes("Review answers")));
        assert.ok(texts(tui.render()).every((line) => visibleWidth(line) <= 24));
        tui.press("tui.select.confirm");
        assert.deepEqual((await running).answers, [
            { questionId: question.id, answer: label, wasCustom: false, optionIndex: 1, note },
            { questionId: "second", answer: custom, wasCustom: true },
        ]);
    },
);

test(
    "questionnaire cancellation, owner abort and stale ownership "
        + "retain typed results",
    async () => {
        for (const [key, reason] of [["tui.select.cancel", "back"], ["ctrl+c", "close"]]) {
            const { tui, running } = await open();
            tui.press(key);
            assert.deepEqual(await running, { kind: "closed", reason });
        }
        const owner = new AbortController();
        const { running } = await open({ signal: owner.signal });
        owner.abort();
        assert.deepEqual(await running, { kind: "stale" });
        let current = true;
        const active = await open({ isCurrent: () => current });
        current = false;
        active.tui.press("tui.select.confirm");
        assert.deepEqual(await active.running, { kind: "stale" });
    },
);

test("RPC and unsupported questionnaire dispatch obey explicit dialog/result contracts", async () => {
    for (const response of [`2. Second option`, undefined]) {
        async function drive(runner) {
            const rpc = createRpcHarness([{
                kind: "select",
                title: `${question.header}: ${question.prompt}`,
                options: [
                    `1. ${label} — Helpful details remain readable`,
                    "2. Second option",
                    "3. Other (free-form)",
                ],
                response,
            }]);
            const result = await runner({ mode: "rpc", hasUI: true, ui: rpc.ui }, {
                questions: [question],
            });
            rpc.assertConsumed();
            return result;
        }

        assert.deepEqual(
            await drive(runQuestionnaire),
            response === undefined
                ? { kind: "closed", reason: "back" }
                : {
                    kind: "submitted",
                    answers: [{
                        questionId: question.id,
                        answer: "Second option",
                        wasCustom: false,
                        optionIndex: 2,
                    }],
                },
        );
    }
    for (const [mode, hasUI] of [["tui", false], ["rpc", false], ["print", true]]) {
        async function drive(runner) {
            const calls = [];
            const result = await runner({ mode, hasUI }, {
                questions: [question],
                onUnsupportedMode: (_ctx, value) => calls.push(value),
            });
            return { result, calls };
        }

        assert.deepEqual(await drive(runQuestionnaire), {
            result: { kind: "unsupported", mode },
            calls: [mode],
        });
    }
});
