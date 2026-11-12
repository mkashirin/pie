import { test } from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters as plain } from "node:util";
import { jiti, visibleWidth } from "./helpers.mjs";

const { initTheme } = await jiti.import("@earendil-works/pi-coding-agent");
initTheme("dark");
const chat = await jiti.import("../src/chat.ts");
const { Markdown } = await jiti.import("@pi-extensions/tui");
const questions = await jiti.import("../src/question-tool.ts");
const completion = await jiti.import("../src/completion-tool.ts");
const theme = { fg: (_role, text) => text, bold: (text) => text };
const question = {
    id: "raw:id",
    header: "Architecture",
    question: "Which implementation should preserve ordinary words?",
    options: [
        { label: "Focused source modules", description: "Keep the implementation simple" },
        { label: "Keep the bundled runtime", description: "Keep existing bundles" },
    ],
};

function text(component, width = 40) {
    return component.render(width).map((line) => plain(line).trimEnd()).join("\n");
}

test("question calls and answers are Markdown cards, not serialized JSON", () => {
    const call = chat.renderPlanQuestionCall({ questions: [question] }, theme);
    assert.match(text(call, 100), /1\. Focused source modules/u);
    assert.match(text(call, 100), /Which implementation should preserve ordinary words/u);
    const answer = {
        id: question.id,
        header: question.header,
        question: question.question,
        answer: question.options[0].label,
        wasCustom: false,
        optionIndex: 1,
        note: "Keep all words intact\nincluding notes",
    };
    const result = questions.planModeQuestionAnswered([question], [answer]);
    const before = JSON.stringify(result);
    for (const details of [result.details, undefined]) {
        const card = chat.renderPlanQuestionResult(
            { ...result, details },
            { isPartial: false },
            theme,
        );
        const rendered = text(card, 100);
        assert.match(rendered, /Plan · Answers · answered/u);
        assert.match(rendered, /Answer: 1\. Focused source modules/u);
        assert.match(rendered, /including notes/u);
        assert.ok(!rendered.includes("\"cancelled\""));
        assert.ok(!rendered.includes("\"optionIndex\""));
    }
    assert.equal(JSON.stringify(result), before);
});

test("cards wrap words and long tokens without ellipsis, with resize and invalidation", () => {
    const token = "indivisible".repeat(10);
    const card = new chat.PlanChatCard(
        "Plan",
        `ordinary words stay intact\n\n${token}`,
        theme,
        "ready",
    );
    assert.match(text(card, 16), /ordinary words\nstay intact/u);
    assert.ok(!text(card, 16).includes("..."));
    assert.equal(text(card, 16).split("\n\n").at(-1).replaceAll("\n", ""), token);
    for (const width of [0, 1, 2, 8, 16, 40, 100]) {
        card.invalidate();
        assert.ok(card.render(width).every((line) => visibleWidth(line) <= width));
    }
});

test("retained Plan cards reuse Markdown across redraws and resize, but refresh on invalidate", (t) => {
    const hosts = [];
    const render = Markdown.prototype.render;
    t.mock.method(Markdown.prototype, "render", function(width) {
        hosts.push(this);
        return render.call(this, width);
    });
    const body = "  # Implementation\n\n```ts\nconst value = 1;\n```\n\n"
        + "界ordinary\twords\x1b]52;c;hidden\x07\u202e  ";
    const card = new chat.PlanChatCard("A heading that must still wrap", body, theme, "ready");
    const first = card.render(20);
    assert.deepEqual(card.render(20), first);
    assert.equal(hosts.length, 1);
    assert.ok(first.slice(0, 2).every((row) => visibleWidth(row) <= 20));
    card.render(40);
    card.render(20);
    assert.equal(hosts.length, 3);
    assert.ok(hosts.every((host) => host === hosts[0]));
    for (const width of [NaN, Infinity, -1, 0, 0.9, 1, 2, 3]) {
        assert.ok(card.render(width).every((row) => visibleWidth(row) <= width));
    }
    card.invalidate();
    const refreshed = card.render(20);
    assert.notStrictEqual(hosts.at(-1), hosts[0]);
    assert.deepEqual(refreshed, first);
    assert.ok(!text(card, 80).includes("hidden"));
    assert.ok(body.includes("hidden"), "display cleanup does not change the payload");
});

test("cancelled, partial and completed tool surfaces stay readable and sanitize answer prose", () => {
    const cancelled = questions.planModeQuestionCancelled(
        [question],
        "cancelled",
        "User cancelled.",
    );
    const card = chat.renderPlanQuestionResult(cancelled, { isPartial: false }, theme);
    assert.match(text(card), /cancelled/u);
    assert.match(text(card), /User cancelled\./u);
    const waiting = chat.renderPlanQuestionResult({ content: [] }, { isPartial: true }, theme);
    assert.match(text(waiting), /Waiting for answers/u);
    assert.ok(
        !text(chat.renderPlanCompletionCall({ plan: "raw plan args" }, theme)).includes(
            "raw plan args",
        ),
    );
    const complete = completion.renderPlanModeCompletion(
        completion.planModeCompleted("# Implementation\n\nKeep ordinary words together."),
        { isPartial: false },
        theme,
    );
    assert.match(text(complete, 100), /Plan · ready/u);
    assert.match(text(complete, 100), /Keep ordinary words together/u);
    const hostile = questions.planModeQuestionAnswered([question], [{
        header: "Literal heading",
        question: "Prompt",
        answer: "\x1b[31m**literal**\u202e",
        wasCustom: true,
    }]);
    assert.match(
        text(chat.renderPlanQuestionResult(hostile, { isPartial: false }, theme)),
        /\*\*literal\*\*/u,
    );
});
