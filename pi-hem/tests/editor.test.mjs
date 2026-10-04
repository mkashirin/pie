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
    return { e, renders: () => renders };
}

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
    assert.equal(e.buffer.mode, "select");
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
    assert.equal(e.buffer.cursor, e.buffer.length);
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
    assert.equal(e.getText(), "first\nX  second");
    e.handleInput("A");
    e.handleInput("!");
    e.handleInput("\x1b");
    assert.equal(e.getText(), "first\nX  second!");
    e.buffer.moveTo(1);
    e.handleInput("A");
    e.handleInput("?");
    assert.equal(e.getText(), "first?\nX  second!");
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
