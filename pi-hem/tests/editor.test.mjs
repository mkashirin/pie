import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { createJiti } from "jiti";
import assert from "node:assert/strict";
import { test } from "node:test";

// Pi loads TypeScript extensions with jiti; use the same loader with local dev dependencies.
const jiti = createJiti(import.meta.url);
const { HelixEditor } = await jiti.import("../index.ts");
const matches = {
    "app.interrupt": "\x1b",
    "app.clear": "\x03",
    "app.exit": "\x04",
    "tui.input.submit": "\r",
    "tui.input.newLine": "\n",
    "tui.input.tab": "\t",
    "tui.editor.cursorLeft": "\x1b[D",
    "tui.editor.cursorRight": "\x1b[C",
    "tui.editor.cursorUp": "\x1b[A",
    "tui.editor.cursorDown": "\x1b[B",
    "tui.editor.deleteCharBackward": "\x7f",
    "tui.editor.deleteToLineEnd": "\x0b",
};

function editor() {
    let renders = 0;
    const tui = {
        terminal: { rows: 24 },
        requestRender() {
            renders++;
        },
    };

    const identity = (s) => s;

    const theme = {
        borderColor: identity,
        selectList: Object.fromEntries(
            ["selectedPrefix", "selectedText", "description", "scrollInfo", "noMatch"].map((
                k,
            ) => [k, identity]),
        ),
    };
    const bindings = { matches: (data, id) => matches[id] === data };
    const e = new HelixEditor(tui, theme, bindings);
    const input = e.handleInput.bind(e);
    e.handleInput = (data) => {
        input(data);
        if (data === "\x1b") {
            for (const event of e.decoder.flushEscape()) e.handleKey(event.key, data);
        }
    };
    return { e, renders: () => renders };
}

test("configured Pi line-end deletion handles multiple Unicode cursors", () => {
    const { e } = editor();
    e.setText("😀abc\n😀def");
    e.buffer.setSelections([
        { id: "a", start: 2, end: 2, reversed: false },
        { id: "b", start: 8, end: 8, reversed: false },
    ], "a");
    e.handleInput("\x0b");
    assert.equal(e.getText(), "😀\n😀");
    assert.equal(e.controller.hasPending, false);
    e.dispose();
});

test("accepted completion macro replay inserts literal text without provider or submit", async () => {
    const { e } = editor();
    e.setText("prefix ");
    e.handleInput("\x1b");
    e.handleInput("Q");
    e.handleInput("a");
    let calls = 0;
    let submits = 0;
    e.onSubmit = () => submits++;
    e.setAutocompleteProvider({
        async getSuggestions() {
            calls++;
            return { prefix: "", items: [{ value: "hé😀", label: "hé😀" }] };
        },
        applyCompletion(lines, line, col) {
            calls++;
            return { lines: [lines[0].slice(0, col) + "hé😀"], cursorLine: 0, cursorCol: col + 4 };
        },
    });
    e.handleInput("\t");
    await new Promise((resolve) => setTimeout(resolve, 40));
    e.handleInput("\t");
    assert.equal(e.getText(), "prefix hé😀");
    e.handleInput("\x1b");
    e.handleInput("Q");
    const beforeCalls = calls;
    e.setText("");
    e.handleInput("\x1b");
    e.handleInput("q");
    assert.equal(e.getText(), "hé😀");
    assert.equal(calls, beforeCalls);
    assert.equal(submits, 0);
    e.dispose();
});

for (
    const [original, completed, divergent, head, cursor, prefix] of [
        ["fox", "foo", "fax", 1, 2, "f"],
        ["😀éx", "😀éo", "😀áx", 2, 4, "😀"],
        ["fox", "foo", "fax", 1, 1, "unverified"],
    ]
) {
    for (const replay of ["q", "."]) {
        test(`logical completion ${original} replays with ${replay}`, async () => {
            const { e } = editor();
            e.setText(original);
            e.handleInput("\x1b");
            e.handleInput("Q");
            e.handleInput("i");
            e.buffer.moveTo(head);
            let calls = 0, submits = 0;
            e.onSubmit = () => submits++;
            e.setAutocompleteProvider({
                async getSuggestions() {
                    calls++;
                    return { prefix, items: [{ value: completed, label: completed }] };
                },
                applyCompletion() {
                    calls++;
                    return { lines: [completed], cursorLine: 0, cursorCol: cursor };
                },
            });
            e.handleInput("\t");
            await new Promise((resolve) => setTimeout(resolve, 40));
            e.handleInput("\t");
            assert.equal(e.getText(), completed);
            assert.equal(e.buffer.visualHead(), cursor);
            e.handleInput("\x1b");
            e.handleInput("Q");
            const beforeCalls = calls;
            e.setText(divergent);
            e.handleInput("\x1b");
            e.buffer.moveTo(head);
            e.handleInput(replay);
            assert.equal(e.getText(), completed);
            assert.ok(e.buffer.visualHead() <= completed.length);
            assert.equal(calls, beforeCalls);
            assert.equal(submits, 0);
            e.dispose();
        });
    }
}

test("completion document edits spanning tokens retain explicit diff replay", async () => {
    const { e } = editor();
    e.setText("fox tail");
    e.handleInput("\x1b");
    e.handleInput("Q");
    e.handleInput("i");
    e.buffer.moveTo(1);
    let calls = 0, submits = 0;
    e.onSubmit = () => submits++;
    e.setAutocompleteProvider({
        async getSuggestions() {
            calls++;
            return { prefix: "f", items: [{ value: "foo", label: "foo" }] };
        },
        applyCompletion() {
            calls++;
            return { lines: ["foo sail"], cursorLine: 0, cursorCol: 1 };
        },
    });
    e.handleInput("\t");
    await new Promise((resolve) => setTimeout(resolve, 40));
    e.handleInput("\t");
    assert.equal(e.getText(), "foo sail");
    e.handleInput("\x1b");
    e.handleInput("Q");
    const beforeCalls = calls;
    e.setText("fax tail");
    e.handleInput("\x1b");
    e.buffer.moveTo(1);
    e.handleInput("q");
    assert.equal(e.getText(), "fao sail");
    assert.equal(calls, beforeCalls);
    assert.equal(submits, 0);
    e.dispose();
});

for (const direction of ["/", "?"]) {
    test(`${direction} search accepts decoded spaces without submitting`, () => {
        const { e } = editor();
        e.setText("one two one");
        e.handleInput("\x1b");
        let submits = 0;
        e.onSubmit = () => submits++;
        for (const key of [direction, "o", "n", "e", " ", "t", "w", "o"]) e.handleInput(key);
        assert.equal(e.controller.search.pattern, "one two");
        e.handleInput("\r");
        assert.equal(submits, 0);
        e.dispose();
    });
}

test("insert controls delete Unicode words independently at each cursor", () => {
    const { e } = editor();
    e.setText("😀 one\n😀 two");
    e.buffer.setSelections([
        { id: "a", start: 6, end: 6, reversed: false },
        { id: "b", start: 13, end: 13, reversed: false },
    ], "a");
    let changes = 0;
    e.onChange = () => changes++;
    e.handleInput("\x17");
    assert.equal(e.getText(), "😀 \n😀 ");
    assert.equal(changes, 1);
    e.dispose();
});

test("replace typing, restoration, Enter and undo stay in controller", () => {
    const { e } = editor();
    e.setText("😀ab");
    e.buffer.moveTo(0);
    e.buffer.mode = "replace";
    e.handleInput("x");
    assert.equal(e.getText(), "xab");
    e.handleInput("\x7f");
    assert.equal(e.getText(), "😀ab");
    let submits = 0;
    e.onSubmit = () => submits++;
    e.handleInput("\r");
    assert.equal(submits, 0);
    assert.ok(e.getText().includes("\n"));
    e.dispose();
});

test("insert register pending Enter is not a prompt submission", () => {
    const { e } = editor();
    e.setText("draft");
    let submits = 0;
    e.onSubmit = () => submits++;
    e.handleInput("\x12");
    e.handleInput("\r");
    assert.equal(submits, 0);
    e.dispose();
});

test("production pending prefixes consume Enter and Escape cancels", async () => {
    for (const prefix of ["g", "m", "f", "r", "\"", " "]) {
        const { e } = editor();
        e.handleInput = HelixEditor.prototype.handleInput.bind(e);
        let submits = 0;
        e.onSubmit = () => submits++;
        e.setText("draft");
        e.handleInput("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 40));
        e.handleInput(prefix);
        e.handleInput("\r");
        assert.equal(submits, 0, JSON.stringify(prefix));
        assert.equal(e.getText(), "draft");
        e.handleInput("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 40));
        e.dispose();
    }
});

test("gw labels visible Unicode words across wraps and cancels without submission", () => {
    const { e } = editor();
    e.setText("猫 alpha beta gamma");
    e.handleInput("\x1b");
    e.render(12);
    e.handleInput("g");
    e.handleInput("w");
    assert.ok(e.wordTargets.length >= 3);
    const target = e.wordTargets[1];
    for (const line of e.render(12)) assert.ok(visibleWidth(line) <= 12);
    e.handleInput(target.label);
    assert.equal(e.buffer.cursor, target.index);
    e.handleInput("g");
    e.handleInput("w");
    e.handleInput("\x1b");
    assert.equal(e.wordTargets.length, 0);
    e.dispose();
});

test("modal input, submit, render, and Pi app keys", () => {
    const { e } = editor();
    e.focused = true;
    const submitted = [];
    e.onSubmit = (text) => submitted.push(text);
    assert.equal(e.buffer.mode, "insert");
    e.handleInput("h");
    e.handleInput("i");
    e.handleInput("\x1b");
    assert.equal(e.getText(), "hi");
    assert.equal(e.buffer.mode, "normal");
    assert.equal(e.render(20).length, 3);
    e.handleInput("\r");
    assert.deepEqual(submitted, ["hi"]);
    assert.equal(e.getText(), "");
    assert.equal(e.buffer.mode, "insert");
    e.dispose();
});

test("x selects logical lines, repeats, and supports delete and undo", () => {
    const { e, renders } = editor();
    const changes = [];
    e.onChange = (text) => changes.push(text);
    e.setText("first long line\nsecond\nlast");
    e.handleInput("\x1b");
    e.buffer.moveTo(6);
    const before = renders();
    e.render(8); // Soft wrapping must not affect x.
    e.handleInput("x");
    // Helix x selects lines without changing the current mode.
    assert.equal(e.buffer.mode, "normal");
    assert.equal(e.buffer.cells.slice(...e.buffer.selection).join(""), "first long line\n");
    assert.ok(renders() > before);
    assert.deepEqual(changes, ["first long line\nsecond\nlast"]);
    e.handleInput("\x1b[120u"); // Kitty-encoded x.
    assert.equal(e.buffer.cells.slice(...e.buffer.selection).join(""), "first long line\nsecond\n");
    e.handleInput("d");
    assert.equal(e.getText(), "last");
    assert.equal(e.buffer.register, "first long line\nsecond\n");
    e.handleInput("u");
    assert.equal(e.getText(), "first long line\nsecond\nlast");
    e.dispose();
});

test("x is literal in insert mode and honors extension shortcuts in normal mode", () => {
    const { e } = editor();
    e.handleInput("x");
    assert.equal(e.getText(), "x");
    e.handleInput("\x1b");
    e.onExtensionShortcut = (data) => data === "x";
    e.handleInput("x");
    assert.equal(e.buffer.mode, "normal");
    e.onExtensionShortcut = undefined;
    e.handleInput("x");
    e.handleInput("y");
    assert.equal(e.buffer.register, "x");
    e.handleInput("c");
    e.handleInput("!");
    e.handleInput("\x1b");
    assert.equal(e.getText(), "!");
    e.handleInput("u");
    assert.equal(e.getText(), "x");
    e.dispose();
});

test("l reaches the empty end position without a and i appends there", () => {
    for (const key of ["l", "\x1b[108u", "\x1b[C"]) {
        const { e, renders } = editor();
        e.focused = true;
        e.setText("ab\n👩‍💻é");
        e.handleInput("\x1b");
        const before = renders();
        e.handleInput(key);
        assert.equal(e.buffer.cursor, e.buffer.length);
        assert.deepEqual(e.getCursor(), { line: 1, col: "👩‍💻é".length });
        assert.equal(e.buffer.mode, "normal");
        assert.ok(renders() > before);
        for (const width of [1, 3, 5, 20]) {
            const lines = e.render(width);
            assert.ok(lines.some((line) => line.includes(CURSOR_MARKER)));
            assert.ok(lines.every((line) => visibleWidth(line) <= width));
        }
        e.handleInput(key);
        assert.equal(e.buffer.cursor, e.buffer.length);
        e.handleInput("h");
        assert.equal(e.buffer.cursor, e.buffer.length - 1);
        e.handleInput(key);
        e.handleInput("i");
        e.handleInput("!");
        assert.equal(e.getText(), "ab\n👩‍💻é!");
        e.dispose();
    }
});

test("l reaches logical line ends, crosses newlines, and extends selections to EOF", () => {
    const { e } = editor();
    e.setText("ab\ncd");
    e.handleInput("\x1b");
    e.buffer.moveTo(0);
    e.handleInput("l");
    e.handleInput("l");
    assert.deepEqual(e.getCursor(), { line: 0, col: 2 });
    e.handleInput("l");
    assert.deepEqual(e.getCursor(), { line: 1, col: 0 });
    e.handleInput("v");
    e.handleInput("l");
    e.handleInput("l");
    assert.equal(e.buffer.mode, "select");
    // Canonical half-open selections display their last selected grapheme.
    assert.equal(e.buffer.cursor, e.buffer.length - 1);
    assert.equal(e.buffer.cells.slice(...e.buffer.selection).join(""), "cd");
    e.handleInput("d");
    assert.equal(e.getText(), "ab\n");
    e.dispose();
});

test("prefilled prompts default to insert mode with cursor at end", () => {
    const { e } = editor();
    e.setText("existing");
    assert.equal(e.buffer.mode, "insert");
    assert.equal(e.getCursor().col, 8);
    e.handleInput("!");
    assert.equal(e.getText(), "existing!");
    e.dispose();
});

test("Working stays in Pi top border and mode appears on its right", () => {
    const { e } = editor();
    assert.equal(e.embedWorkingStatus, true);
    e.setWorkingStatusIndicator({
        renderInBorder: () => "Working",
        renderSpinnerInBorder: () => "*",
    });
    const top = stripTerminalSequences(e.render(40)[0]);
    assert.ok(top.indexOf("Working") < top.indexOf(" INSERT "), top);
    assert.ok(top.endsWith("── INSERT ──"), top);
    assert.equal(visibleWidth(top), 40);
    const narrow = stripTerminalSequences(e.render(14)[0]);
    assert.ok(narrow.includes("Working"), narrow);
    assert.equal(narrow.includes("INSERT"), false);
    e.handleInput("\x1b");
    assert.ok(stripTerminalSequences(e.render(40)[0]).endsWith("── NORMAL ──"));
    e.dispose();
});

test("Shift+I and Shift+A insert at logical line boundaries", () => {
    const { e } = editor();
    e.setText("first\n  second");
    e.handleInput("\x1b");
    e.handleInput("I");
    e.handleInput("X");
    e.handleInput("\x1b");
    assert.equal(e.getText(), "first\n  Xsecond");
    e.handleInput("A");
    e.handleInput("!");
    e.handleInput("\x1b");
    assert.equal(e.getText(), "first\n  Xsecond!");
    e.buffer.moveTo(1);
    e.handleInput("A");
    e.handleInput("?");
    assert.equal(e.getText(), "first?\n  Xsecond!");
    e.dispose();
});

test("prompt wraps whole words and preserves logical cursor and mouse positions", () => {
    const { e } = editor();
    e.setText("hello world");
    e.buffer.moveTo(0);
    const rows = e.render(10).map(stripTerminalSequences);
    assert.ok(rows[1].startsWith("hello "), rows[1]);
    assert.ok(rows[2].startsWith("world"), rows[2]);
    assert.equal(rows[1].includes("wor"), false);
    e.handleMouse({ type: "click", button: "left", x: 0, y: 2, width: 10, height: 4 });
    assert.equal(e.buffer.cursor, 6);
    assert.equal(e.getText(), "hello world");
    e.setText("unbreakable");
    e.buffer.moveTo(0);
    const fallback = e.render(7).map(stripTerminalSequences);
    assert.ok(fallback[1].startsWith("unbrea"), fallback[1]);
    assert.ok(fallback[2].startsWith("kable"), fallback[2]);
    e.dispose();
});

test("selection rendering fits narrow widths and carries the IME cursor", () => {
    const { e } = editor();
    e.focused = true;
    e.setText("a👩‍💻b\nxyz");
    e.buffer.moveTo(1);
    e.handleInput("\x1b");
    e.handleInput("v");
    e.handleInput("l");
    for (const width of [1, 3, 5, 8, 20]) {
        const lines = e.render(width);
        assert.ok(lines.some((line) => line.includes(CURSOR_MARKER)));
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
    }
    e.dispose();
});

test("v e e selection stays active and highlights spaces between words", () => {
    const { e } = editor();
    e.setText("one   two  three");
    e.buffer.moveTo(0);
    e.handleInput("\x1b");
    e.handleInput("v");
    e.handleInput("e");
    e.handleInput("e");
    assert.equal(e.buffer.mode, "select");
    assert.equal(e.buffer.cells.slice(...e.buffer.selection).join(""), "one   two");
    const line = e.render(40)[1];
    assert.ok(line.includes("\x1b[7m \x1b[0m"));
    e.dispose();
});

test("autocomplete stays visible during refresh without accepting stale items", async () => {
    const { e } = editor();
    let resolveUpdated;
    e.setAutocompleteProvider({
        async getSuggestions(lines) {
            if (lines[0] === "@ab") {
                return new Promise((resolve) => {
                    resolveUpdated = resolve;
                });
            }
            return { prefix: "@a", items: [{ value: "@alpha", label: "@alpha" }] };
        },
        applyCompletion(lines, line, col, item) {
            return { lines: [item.value], cursorLine: 0, cursorCol: item.value.length };
        },
    });
    e.handleInput("@");
    e.handleInput("a");
    await new Promise((resolve) => setTimeout(resolve, 140));
    assert.equal(e.isShowingAutocomplete(), true);
    e.handleInput("b");
    assert.equal(e.isShowingAutocomplete(), true, "do not remove the popup while debouncing");
    await new Promise((resolve) => setTimeout(resolve, 140));
    assert.equal(e.isShowingAutocomplete(), true, "keep the popup while waiting for the provider");
    resolveUpdated({ prefix: "@ab", items: [{ value: "@about", label: "@about" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    e.handleInput("\t");
    assert.equal(e.getText(), "@about");
    e.dispose();
});

test("stale autocomplete cannot be accepted while refresh is pending", async () => {
    const { e } = editor();
    let resolveUpdated;
    e.setAutocompleteProvider({
        async getSuggestions(lines) {
            if (lines[0] === "@ab") {
                return new Promise((resolve) => {
                    resolveUpdated = resolve;
                });
            }
            return { prefix: "@a", items: [{ value: "@alpha", label: "@alpha" }] };
        },
        applyCompletion(lines, line, col, item) {
            return { lines: [item.value], cursorLine: 0, cursorCol: item.value.length };
        },
    });
    e.handleInput("@");
    e.handleInput("a");
    await new Promise((resolve) => setTimeout(resolve, 140));
    e.handleInput("b");
    e.handleInput("\t");
    assert.equal(e.getText(), "@ab");
    resolveUpdated?.({ prefix: "@ab", items: [] });
    e.dispose();
});

test("spaces do not invoke path completion, Tab still requests it", async () => {
    const { e } = editor();
    let requests = 0;
    e.setAutocompleteProvider({
        async getSuggestions() {
            requests++;
            return { prefix: "", items: [{ value: "folder/", label: "folder/" }] };
        },
        shouldTriggerFileCompletion() {
            return true;
        },
        applyCompletion(lines) {
            return { lines, cursorLine: 0, cursorCol: 0 };
        },
    });
    for (const char of "hello world ") e.handleInput(char);
    await new Promise((resolve) => setTimeout(resolve, 140));
    assert.equal(requests, 0);
    assert.equal(e.isShowingAutocomplete(), false);
    e.handleInput("\t");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(requests, 1);
    assert.equal(e.isShowingAutocomplete(), true);
    e.handleInput("x");
    e.handleInput(" ");
    assert.equal(e.isShowingAutocomplete(), false);
    e.dispose();
});

test("paste and asynchronous completion follow public provider protocol", async () => {
    const { e } = editor();
    e.handleInput("\x1b[200~@he\x1b[201~");
    assert.equal(e.getText(), "@he");
    e.setAutocompleteProvider({
        async getSuggestions() {
            return { prefix: "@he", items: [{ value: "hello", label: "hello" }] };
        },
        applyCompletion(lines) {
            return { lines: ["hello"], cursorLine: 0, cursorCol: 5 };
        },
    });
    e.handleInput("\t");
    await new Promise((resolve) => setTimeout(resolve, 40));
    e.handleInput("\t");
    assert.equal(e.getText(), "hello");
    assert.equal(e.getCursor().col, 5);
    e.dispose();
});

for (const matching of [true, false]) {
    test(`completion ${matching ? "broadcasts matching" : "collapses divergent"} Unicode contexts`, async () => {
        const { e } = editor();
        e.setText(`😀 @he\n${matching ? "😀 @he" : "other"}`);
        e.buffer.setSelections([
            { id: "a", start: 6, end: 6, reversed: false },
            { id: "b", start: matching ? 13 : 12, end: matching ? 13 : 12, reversed: false },
        ], "a");
        e.setAutocompleteProvider({
            async getSuggestions() {
                return { prefix: "@he", items: [{ value: "hé😀", label: "hé😀" }] };
            },
            applyCompletion(lines, line, col) {
                const result = [...lines];
                result[line] = lines[line].slice(0, col - 3) + "hé😀" + lines[line].slice(col);
                return { lines: result, cursorLine: line, cursorCol: col + 1 };
            },
        });
        e.handleInput("\t");
        await new Promise((resolve) => setTimeout(resolve, 40));
        e.handleInput("\t");
        assert.equal(e.getText(), `😀 hé😀\n${matching ? "😀 hé😀" : "other"}`);
        assert.deepEqual(e.buffer.selections.map((s) => s.start), matching ? [7, 15] : [7]);
        assert.ok(e.buffer.selections.every((s) => s.start === s.end));
        e.dispose();
    });
}

test("completion rejects changed primary during request and before acceptance", async () => {
    const { e } = editor();
    e.setText("@he\n@he");
    const selections = [
        { id: "a", start: 3, end: 3, reversed: false },
        { id: "b", start: 7, end: 7, reversed: false },
    ];
    e.buffer.setSelections(selections, "a");
    let resolve;
    e.setAutocompleteProvider({
        getSuggestions() {
            return new Promise((done) => {
                resolve = done;
            });
        },
        applyCompletion() {
            throw new Error("stale completion applied");
        },
    });
    e.handleInput("\t");
    await new Promise((done) => setTimeout(done, 10));
    e.buffer.setSelections(selections, "b");
    resolve({ prefix: "@he", items: [{ value: "hello", label: "hello" }] });
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(e.isShowingAutocomplete(), false);
    e.handleInput("\t");
    await new Promise((done) => setTimeout(done, 10));
    resolve({ prefix: "@he", items: [{ value: "hello", label: "hello" }] });
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(e.isShowingAutocomplete(), true);
    e.buffer.setSelections(selections, "a");
    assert.equal(e.acceptCompletion(), false);
    assert.equal(e.getText(), "@he\n@he");
    e.dispose();
});

test("modal priority, same-value reset and staged Escape", () => {
    const { e } = editor();
    let host = 0, interrupts = 0;
    e.onExtensionShortcut = () => {
        host++;
        return true;
    };
    e.onEscape = () => interrupts++;
    e.setText("abc");
    e.handleInput("\x1b");
    e.handleInput("x");
    assert.equal(host, 0);
    e.handleInput("\x1b");
    assert.equal(interrupts, 0);
    assert.equal(e.buffer.primary.start, e.buffer.primary.end);
    e.handleInput("\x1b");
    assert.equal(interrupts, 1);
    e.handleInput("g");
    e.setText(e.getText());
    assert.equal(e.buffer.mode, "insert");
    assert.equal(e.controller.pending, "");
    e.dispose();
});

test("paste broadcasts literal data and disposed input is ignored", () => {
    const { e } = editor();
    e.setText("ab");
    e.buffer.setSelections([{ id: "a", start: 0, end: 0, reversed: false }, {
        id: "b",
        start: 2,
        end: 2,
        reversed: false,
    }]);
    e.handleInput("\x1b[200~d\x1b\x1b");
    e.handleInput("[201~");
    assert.equal(e.getText(), "d\x1babd\x1b");
    e.dispose();
    e.handleInput("x");
    assert.equal(e.getText(), "d\x1babd\x1b");
});

test("excluded prefixes and counts cannot submit, Escape cancels prefixes", () => {
    const { e } = editor();
    let submitted = 0;
    e.onSubmit = () => submitted++;
    e.setText("draft");
    e.handleInput("\x1b");
    e.handleInput("z");
    e.handleInput("\r");
    assert.equal(submitted, 0);
    assert.equal(e.controller.hasPending, false);
    assert.deepEqual(e.modalPrefix, []);
    e.handleInput("2");
    e.handleInput("\r");
    assert.equal(submitted, 0);
    e.handleInput("\x1b");
    e.handleInput("z");
    e.handleInput("\x1b");
    e.handleInput("\r");
    assert.equal(submitted, 1);
    e.dispose();
});

test("helper families run through the real editor and replay suppresses view effects", () => {
    const { e } = editor();
    e.setText("one two\nthree four\nfive six");
    e.handleInput("\x1b");
    const key = (k) => e.controller.handleKey(k);
    e.buffer.moveTo(10);
    key("alt+C");
    assert.equal(e.buffer.selections.length, 2);
    key(",");
    e.buffer.moveTo(0);
    key("tab");
    assert.equal(e.buffer.cursor, 4);
    key("shift+tab");
    assert.equal(e.buffer.cursor, 7);
    key("V");
    assert.equal(e.buffer.mode, "select");
    key("V");
    assert.equal(e.buffer.mode, "normal");
    e.buffer.moveTo(10);
    key("+");
    assert.equal(e.buffer.cursor, 0);
    e.buffer.moveTo(10);
    key("-");
    assert.equal(e.buffer.cursor, 0);
    for (const delimiter of ["\"", "|"]) {
        e.setText(`${delimiter}hello${delimiter}`);
        e.handleInput("\x1b");
        e.buffer.moveTo(2);
        key("m");
        key("i");
        key(delimiter === "\"" ? "q" : "|");
        assert.equal(e.buffer.text.slice(e.buffer.primary.start, e.buffer.primary.end), "hello");
    }
    let calls = 0;
    Object.assign(e.controller.options.view, {
        scroll: () => calls++,
        align: () => calls++,
        middle: () => {
            calls++;
            return 0;
        },
    });
    key("ctrl+e");
    key("ctrl+y");
    assert.equal(calls, 2);
    key("Q");
    for (const k of ["ctrl+e", "ctrl+y", "z", "t", "M", "pageup", "pagedown"]) key(k);
    key("Q");
    const before = calls;
    key("q");
    assert.equal(calls, before);
    e.dispose();
});

test("visual motion preserves each selection row", () => {
    const { e } = editor();
    e.setText("ab\ncd\nef");
    e.handleInput("\x1b");
    e.buffer.setSelections([{ id: "a", start: 0, end: 0, reversed: false }, {
        id: "b",
        start: 3,
        end: 3,
        reversed: false,
    }]);
    e.render(20);
    e.handleInput("j");
    assert.deepEqual(e.buffer.selections.map((s) => s.start), [3, 6]);
    e.dispose();
});

test("production decoder preserves paste at every fragmentation cut", () => {
    const paste = "\x1b[200~\rhello\x1b[201~";
    for (let cut = 1; cut < paste.length; cut++) {
        const { e } = editor();
        let submitted = 0;
        e.onSubmit = () => submitted++;
        e.setText("draft");
        HelixEditor.prototype.handleInput.call(e, paste.slice(0, cut));
        HelixEditor.prototype.handleInput.call(e, paste.slice(cut));
        assert.equal(e.getText(), "draft\nhello", `cut ${cut}`);
        assert.equal(submitted, 0);
        e.dispose();
    }
});

test("secondary line-end cursors render with only one hardware marker", () => {
    const { e } = editor();
    e.focused = true;
    e.setText("ab\ncd");
    e.buffer.setSelections([
        { id: "a", start: 2, end: 2, reversed: false },
        { id: "b", start: 5, end: 5, reversed: false },
    ], "a");
    for (const width of [3, 10]) {
        const rows = e.render(width);
        assert.equal(rows.join("").split(CURSOR_MARKER).length - 1, 1);
        assert.equal(rows.filter((row) => row.includes("\x1b[7;4m \x1b[0m")).length, 2);
        assert.ok(rows.every((row) => visibleWidth(row) <= width));
    }
    e.controller.status = "bad\x1b[2J\r\nstatus";
    for (const width of [1, 2, 10, 40, 80]) {
        const rows = e.render(width);
        assert.ok(rows.every((row) => visibleWidth(row) <= width));
        assert.ok(!rows.join("").includes("\x1b[2J"));
    }
    e.dispose();
});

test("production lone Escape is emitted after the ambiguity timer", async () => {
    const { e } = editor();
    e.setText("draft");
    HelixEditor.prototype.handleInput.call(e, "\x1b");
    assert.equal(e.buffer.mode, "insert");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(e.buffer.mode, "normal");
    e.dispose();
});
