import assert from "node:assert/strict";
import { test } from "node:test";
import { HelixBuffer } from "../src/model.ts";

test("normal mode, motions, select, delete and atomic undo", () => {
    const m = new HelixBuffer();
    assert.equal(m.mode, "insert");
    m.insert("one two");
    m.escape();
    m.moveTo(0);
    m.moveWord("next");
    assert.equal(m.cursor, 4);
    m.toggleSelect();
    m.moveHorizontal(1);
    assert.equal(m.cells.slice(...m.selection).join(""), "tw");
    m.deleteSelection();
    assert.equal(m.text, "one o");
    m.undo();
    assert.equal(m.text, "one two");
});

test("change, yank, paste, newlines and grapheme clusters", () => {
    const m = new HelixBuffer();
    m.setText("a👩‍💻b\ncafé");
    assert.equal(m.length, 8);
    m.moveTo(1);
    m.yank();
    assert.equal(m.register, "👩‍💻");
    m.paste();
    assert.equal(m.text, "a👩‍💻👩‍💻b\ncafé");
    m.undo();
    assert.equal(m.text, "a👩‍💻b\ncafé");
    m.moveTo(1);
    m.deleteSelection(true);
    assert.equal(m.mode, "insert");
    m.insert("X");
    m.escape();
    assert.equal(m.text, "aXb\ncafé");
    m.undo();
    assert.equal(m.text, "a👩‍💻b\ncafé");
});

test("selection extends across repeated spaces with word-end motions", () => {
    const m = new HelixBuffer();
    m.setText("one   two  three");
    m.moveTo(0);
    m.toggleSelect();
    m.moveWord("end");
    assert.equal(m.cells.slice(...m.selection).join(""), "one");
    m.moveWord("end");
    assert.equal(m.cells.slice(...m.selection).join(""), "one   two");
    m.moveWord("end");
    assert.equal(m.cells.slice(...m.selection).join(""), "one   two  three");
    assert.equal(m.mode, "select");
});

test("typing a combining mark preserves grapheme motions", () => {
    const m = new HelixBuffer();
    m.enterInsert();
    m.insert("e");
    m.insert("\u0301");
    m.insert("x");
    m.escape();
    assert.equal(m.length, 2);
    m.moveHorizontal(-1);
    assert.equal(m.cells[m.cursor], "e\u0301");
});

test("x expands to whole lines including newlines and repeats through EOF", () => {
    const m = new HelixBuffer();
    m.setText("a👩‍💻é\n\nlast");
    m.escape();
    m.moveTo(1);
    m.register = "unchanged";
    m.selectLine();
    assert.equal(m.mode, "select");
    assert.deepEqual(m.selection, [0, 4]);
    assert.equal(m.cells.slice(...m.selection).join(""), "a👩‍💻é\n");
    m.selectLine();
    assert.equal(m.cells.slice(...m.selection).join(""), "a👩‍💻é\n\n");
    m.selectLine();
    assert.deepEqual(m.selection, [0, m.length]);
    m.selectLine();
    assert.deepEqual(m.selection, [0, m.length]);
    assert.equal(m.register, "unchanged");
    m.deleteSelection();
    assert.equal(m.text, "");
    m.undo();
    assert.equal(m.text, "a👩‍💻é\n\nlast");
});

test("x expands forward and backward partial selections to line bounds", () => {
    for (const [anchor, cursor] of [[1, 5], [5, 1]]) {
        const m = new HelixBuffer();
        m.setText("one\ntwo\nthree");
        m.escape();
        m.moveTo(anchor);
        m.toggleSelect();
        m.moveTo(cursor);
        m.selectLine();
        assert.deepEqual(m.selection, [0, 8]);
        assert.equal(m.cells.slice(...m.selection).join(""), "one\ntwo\n");
        m.selectLine();
        assert.deepEqual(m.selection, [0, m.length]);
    }
});

test("x handles empty buffers, newline cursors, final lines and trailing empty lines", () => {
    const m = new HelixBuffer();
    m.escape();
    m.selectLine();
    assert.deepEqual(m.selection, [0, 0]);
    assert.equal(m.mode, "normal");
    for (
        const [text, cursor, expected] of [
            ["one\ntwo", 3, "one\n"],
            ["one\ntwo", 5, "two"],
            ["one\n", 1, "one\n"],
            ["👩‍💻", 0, "👩‍💻"],
            ["one\n", 4, ""],
        ]
    ) {
        m.setText(text);
        m.escape();
        m.moveTo(cursor);
        m.selectLine();
        assert.equal(m.cells.slice(...m.selection).join(""), expected);
        assert.ok(m.selection[1] <= m.length);
    }
});

test("x is selection-only and does not add an undo step", () => {
    const m = new HelixBuffer();
    m.insert("one\ntwo");
    m.escape();
    m.moveTo(1);
    m.selectLine();
    m.selectLine();
    m.undo();
    assert.equal(m.text, "");
});

test("horizontal motions reach EOF in every mode and stay bounded", () => {
    for (const text of ["", "a", "a👩‍💻é", "ab\ncd", "ab\n"]) {
        for (const mode of ["insert", "normal", "select"]) {
            const m = new HelixBuffer();
            m.setText(text);
            if (mode !== "insert") m.escape();
            m.moveTo(0);
            if (mode === "select") m.toggleSelect();
            for (let i = 0; i < m.length + 2; i++) m.moveHorizontal(1);
            assert.equal(m.cursor, m.length);
            assert.equal(m.mode, mode);
            assert.equal(m.anchor, mode === "select" ? 0 : m.length);
            assert.deepEqual(m.selection, mode === "select" ? [0, m.length] : [m.length, m.length]);
            assert.equal(m.text, text);
            for (let i = 0; i < m.length + 2; i++) m.moveHorizontal(-1);
            assert.equal(m.cursor, 0);
        }
    }
});

test("deleting at EOF is a no-op and changing there appends", () => {
    const m = new HelixBuffer();
    m.insert("abc");
    m.escape();
    m.moveHorizontal(1);
    m.register = "keep";
    assert.equal(m.deleteSelection(), false);
    assert.equal(m.cursor, 3);
    assert.equal(m.register, "keep");
    assert.equal(m.deleteSelection(true), false);
    assert.equal(m.mode, "insert");
    m.insert("!");
    assert.equal(m.text, "abc!");
    m.undo();
    assert.equal(m.text, "abc");
    m.undo();
    assert.equal(m.text, ""); // The no-op delete did not create an undo step.
});

test("line navigation and reset", () => {
    const m = new HelixBuffer();
    m.setText("ab\nc");
    m.moveTo(1);
    m.moveVertical(1);
    assert.deepEqual(m.position, { line: 1, col: 1 });
    m.reset();
    assert.equal(m.text, "");
    assert.equal(m.mode, "insert");
});
