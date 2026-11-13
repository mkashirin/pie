import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { createJiti } from "jiti";
import { createRpcHarness, createTuiHarness } from "../../tests/interaction-harness.mjs";

const jiti = createJiti(import.meta.url);
const { CURSOR_MARKER, runMenu, runQuestionnaire, visibleWidth } = await jiti.import(
    "../src/index.ts",
);
const question = {
    id: "raw:id",
    header: "Choice",
    prompt: "Choose?",
    options: [{ label: "First" }, { label: "Second" }],
};
const runtime = { getState: () => undefined };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
const definition = (screen, action) => ({
    start: "main",
    screens: { main: () => screen },
    actions: { pick: action },
});
const choice = {
    kind: "choice",
    title: "Pick",
    action: "pick",
    items: [{ id: "raw:item", label: "First" }],
};

test("questionnaire abort interrupts an uncooperative RPC select, input or editor wait", {
    timeout: 2000,
}, async () => {
    for (const waiting of ["select", "input", "editor"]) {
        const owner = new AbortController();
        const pending = deferred();
        let entered;
        const ui = {
            select: () => {
                if (waiting === "select") {
                    entered = "select";
                    return pending.promise;
                }
                return Promise.resolve(waiting === "input" ? "3. Other (free-form)" : "Add notes");
            },
            input: () => {
                entered = "input";
                return pending.promise;
            },
            editor: () => {
                entered = "editor";
                return pending.promise;
            },
        };
        const running = runQuestionnaire({ mode: "rpc", hasUI: true, ui }, {
            questions: [question],
            allowNotes: true,
            signal: owner.signal,
        });
        await tick();
        assert.equal(entered, waiting);
        owner.abort();
        assert.deepEqual(await running, { kind: "stale" });
        pending.reject(new Error("late host rejection"));
        await tick();
    }
});

test(
    "abort before a delayed custom factory opens returns stale and the late component stays inert",
    { timeout: 2000 },
    async () => {
        for (const kind of ["menu", "questionnaire"]) {
            const owner = new AbortController();
            let factory;
            const host = deferred();
            const ctx = {
                mode: "tui",
                hasUI: true,
                ui: {
                    custom: (value) => {
                        factory = value;
                        return host.promise;
                    },
                },
            };
            const running = kind === "menu"
                ? runMenu(ctx, definition(choice, () => ({ kind: "close" })), {
                    ...runtime,
                    signal: owner.signal,
                })
                : runQuestionnaire(ctx, { questions: [question], signal: owner.signal });
            owner.abort();
            assert.deepEqual(await running, { kind: "stale" });
            let completed;
            const component = factory(
                { terminal: { rows: 24 }, requestRender() {} },
                { fg: (_role, text) => text },
                { matches: () => false, getKeys: () => [] },
                (result) => {
                    completed = result;
                    host.resolve(result);
                },
            );
            assert.deepEqual(completed, { kind: "stale" });
            assert.deepEqual(component.render(80), []);
            component.handleInput("1");
            component.dispose();
        }
    },
);

test("questionnaire disposal tolerates repeated callbacks and re-entry without leaking notes or focus", async () => {
    const tui = createTuiHarness({ width: 20, rows: 8 });
    const ctx = { mode: "tui", hasUI: true, ui: { custom: tui.custom } };
    const first = runQuestionnaire(ctx, { questions: [question], allowNotes: true });
    await tui.waitForOpen();
    tui.send("n");
    assert.ok(tui.render().join("").includes(CURSOR_MARKER));
    tui.setFocused(false);
    assert.ok(!tui.render().join("").includes(CURSOR_MARKER));
    tui.setFocused(true);
    tui.type("not carried forward");
    const old = tui.component;
    tui.press("ctrl+c");
    assert.deepEqual(await first, { kind: "closed", reason: "close" });
    const renders = tui.renderRequests;
    old.focused = true;
    old.invalidate();
    old.handleInput("1");
    old.dispose();
    assert.deepEqual(old.render(20), []);
    assert.equal(tui.renderRequests, renders);
    const second = runQuestionnaire(ctx, { questions: [question], allowNotes: true });
    await tui.waitForOpen();
    assert.equal(tui.opens, 2);
    old.handleInput("\x03");
    assert.equal(tui.settled, false);
    tui.send("1");
    assert.deepEqual(await second, {
        kind: "submitted",
        answers: [{ questionId: question.id, answer: "First", wasCustom: false, optionIndex: 1 }],
    });
    assert.equal(tui.disposals, 2);
});

test("async menu rejection rolls back optimistic state, reports safely, and remains usable", async () => {
    const pending = deferred();
    const notices = [];
    let calls = 0;
    const tui = createTuiHarness();
    const screen = {
        kind: "settings",
        title: "Settings",
        items: [{
            id: "raw",
            label: "Mode",
            currentValue: "old",
            values: ["old", "next"],
            action: "pick",
        }],
    };
    const running = runMenu(
        {
            mode: "tui",
            hasUI: true,
            ui: { custom: tui.custom, notify: (...args) => notices.push(args) },
        },
        definition(screen, () => {
            calls++;
            return calls === 1 ? pending.promise : { kind: "close" };
        }),
        runtime,
    );
    await tui.waitForOpen();
    tui.press("tui.select.confirm");
    assert.match(tui.render().map(plain).join("\n"), /Mode: next/u);
    tui.press("tui.select.confirm");
    assert.equal(calls, 1, "pending actions are serialized");
    pending.reject(new Error("failed\x1b]52;c;secret\x07\u202e"));
    await tui.waitForPending();
    assert.match(tui.render().map(plain).join("\n"), /Mode: old/u);
    assert.equal(notices.length, 1);
    assert.equal(notices[0][1], "error");
    assert.ok(!["secret", "\x1b", "\u202e"].some((value) => notices[0][0].includes(value)));
    tui.press("tui.select.confirm");
    assert.deepEqual(await running, { kind: "closed", reason: "close" });
});

test("Back during a pending action releases the new screen and ignores late routing", async () => {
    const pending = deferred();
    const tui = createTuiHarness();
    const menu = {
        start: "main",
        screens: {
            main: () => ({
                kind: "actions",
                title: "Main",
                items: [{ id: "open", label: "Open", to: "nested" }],
            }),
            nested: () => choice,
        },
        actions: { pick: () => pending.promise },
    };
    const running = runMenu(
        { mode: "tui", hasUI: true, ui: { custom: tui.custom } },
        menu,
        runtime,
    );
    await tui.waitForOpen();
    tui.press("tui.select.confirm");
    tui.press("tui.select.confirm");
    tui.press("tui.select.cancel");
    assert.match(tui.render().map(plain).join("\n"), /Main/u);
    tui.press("tui.select.confirm");
    assert.match(tui.render().map(plain).join("\n"), /Pick/u);
    pending.resolve({ kind: "close" });
    await tui.waitForPending();
    assert.equal(tui.settled, false, "an old action cannot close its replacement screen");
    tui.press("ctrl+c");
    assert.deepEqual(await running, { kind: "closed", reason: "close" });
});

test("closing or aborting a pending menu action prevents late notifications and stale routing", async () => {
    for (const ending of ["close", "abort"]) {
        const owner = new AbortController();
        const pending = deferred();
        const notices = [];
        let signal;
        const tui = createTuiHarness();
        const running = runMenu(
            {
                mode: "tui",
                hasUI: true,
                ui: { custom: tui.custom, notify: (...args) => notices.push(args) },
            },
            definition(choice, (context) => {
                signal = context.signal;
                return pending.promise;
            }),
            { ...runtime, signal: owner.signal },
        );
        await tui.waitForOpen();
        tui.press("tui.select.confirm");
        const old = tui.component;
        if (ending === "abort") owner.abort();
        else tui.press("ctrl+c");
        assert.deepEqual(
            await running,
            ending === "abort" ? { kind: "stale" } : { kind: "closed", reason: "close" },
        );
        assert.equal(signal.aborted, true);
        pending.reject(new Error("late failure"));
        await tui.waitForPending();
        old.handleInput("\r");
        old.invalidate();
        old.dispose();
        assert.deepEqual(old.render(80), []);
        assert.deepEqual(notices, []);
        assert.equal(tui.disposals, 1);
    }
});

test("RPC detail and input routing preserve title lines, unique labels and raw values", async () => {
    const raw = "raw\tpath\nwith\x1b[31mcontrols";
    const rpc = createRpcHarness([
        { kind: "select", title: "Main", options: ["Open"], response: "Open" },
        {
            kind: "select",
            title: "Details\nSafe line",
            options: ["Back", "Back [2]", "Back [3]"],
            response: "Back [2]",
        },
        {
            kind: "input",
            title: "Export\nEnter a path",
            placeholder: "default.md",
            response: undefined,
        },
        {
            kind: "select",
            title: "Details\nSafe line",
            options: ["Back", "Back [2]", "Back [3]"],
            response: "Back [2]",
        },
        { kind: "input", title: "Export\nEnter a path", placeholder: "default.md", response: raw },
    ]);
    const values = [];
    const menu = {
        start: "main",
        screens: {
            main: () => ({
                kind: "actions",
                title: "Main",
                items: [{ id: "open", label: "Open", to: "detail" }],
            }),
            detail: () => ({
                kind: "detail",
                title: "Details",
                lines: ["Safe\x1b]52;c;secret\x07 line"],
                items: [{ id: "back-looking", label: "Back" }, {
                    id: "input",
                    label: "Back",
                    to: "input",
                }],
            }),
            input: () => ({
                kind: "input",
                title: "Export",
                lines: ["Enter a path"],
                placeholder: "default.md",
                action: "save",
            }),
        },
        actions: {
            save: ({ value }) => {
                values.push(value);
                return { kind: "close" };
            },
        },
    };
    assert.deepEqual(await runMenu({ mode: "rpc", hasUI: true, ui: rpc.ui }, menu, runtime), {
        kind: "closed",
        reason: "close",
    });
    assert.deepEqual(values, [raw]);
    rpc.assertConsumed();
});

test("RPC questionnaire notes, blank custom retries and review editing preserve raw answers", async () => {
    const title = "Choice: Choose?";
    const options = ["1. First", "2. Second", "3. Other (free-form)", "Add notes"];
    const raw = "custom\tanswer\n\x1b[31mraw";
    const note = "note\n\t\x1b]52;c;raw\x07";
    const rpc = createRpcHarness([
        { kind: "select", title, options, response: "Add notes" },
        { kind: "editor", title: "Notes", response: note },
        { kind: "select", title, options, response: "3. Other (free-form)" },
        { kind: "input", title: "Other (free-form)", response: "  " },
        { kind: "select", title, options, response: "3. Other (free-form)" },
        { kind: "input", title: "Other (free-form)", response: raw },
        { kind: "select", title, options, response: "1. First" },
        {
            kind: "select",
            title: "Review answers",
            options: ["Submit answers", "Edit Choice", "Edit Choice [2]"],
            response: "Edit Choice [2]",
        },
        { kind: "select", title, options, response: "2. Second" },
        {
            kind: "select",
            title: "Review answers",
            options: ["Submit answers", "Edit Choice", "Edit Choice [2]"],
            response: "Submit answers",
        },
    ]);
    const result = await runQuestionnaire({ mode: "rpc", hasUI: true, ui: rpc.ui }, {
        questions: [question, { ...question, id: "second" }],
        allowNotes: true,
    });
    assert.deepEqual(result, {
        kind: "submitted",
        answers: [
            { questionId: question.id, answer: raw, wasCustom: true, note },
            { questionId: "second", answer: "Second", wasCustom: false, optionIndex: 2 },
        ],
    });
    rpc.assertConsumed();
});

test("empty questionnaires and zero/one-cell layouts stay bounded through editors and review", async () => {
    assert.deepEqual(
        await runQuestionnaire({
            mode: "tui",
            hasUI: true,
            ui: { custom: () => assert.fail("empty questionnaire opened UI") },
        }, { questions: [] }),
        { kind: "submitted", answers: [] },
    );
    const tui = createTuiHarness({ width: 1, rows: 4 });
    const running = runQuestionnaire({ mode: "tui", hasUI: true, ui: { custom: tui.custom } }, {
        questions: [{ ...question, options: [] }, { ...question, id: "second" }],
        allowNotes: true,
    });
    await tui.waitForOpen();
    const bounded = () => {
        for (const width of [0, 1, 2, 3, NaN, Infinity, -1]) {
            const frame = tui.resize({ width });
            if (!Number.isFinite(width) || width < 1) assert.deepEqual(frame, []);
            else {
                assert.ok(frame.length <= 1);
                assert.ok(frame.every((row) => visibleWidth(row) <= width));
            }
        }
        tui.resize({ width: 1 });
    };
    bounded();
    tui.send("1"); // With no options, the first shortcut opens Other.
    bounded();
    tui.type("👩‍💻 raw");
    bounded();
    tui.press("tui.input.submit");
    bounded();
    tui.send("2");
    bounded();
    tui.press("tui.select.confirm");
    assert.deepEqual((await running).answers, [
        { questionId: question.id, answer: "👩‍💻 raw", wasCustom: true },
        { questionId: "second", answer: "Second", wasCustom: false, optionIndex: 2 },
    ]);
});
