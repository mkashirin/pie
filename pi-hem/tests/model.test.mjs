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
    assert.equal(m.mode, "normal"); // x selects lines without entering extend mode.
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
            assert.equal(m.cursor, mode === "select" ? Math.max(0, m.length - 1) : m.length);
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

test("canonical UTF16 selections, atomic edits, tabs and redo", () => {
    const m = new HelixBuffer();
    m.setText("👩‍💻\ta b", false);
    assert.equal(m.graphemeToUtf16(1), 5);
    assert.equal(m.utf16ToGrapheme(5), 1);
    m.setSelections([{ id: "a", start: 6, end: 7, reversed: false }, {
        id: "b",
        start: 8,
        end: 9,
        reversed: true,
    }], "b");
    assert.equal(m.primary.id, "b");
    const revision = m.revision;
    m.deleteSelection(true);
    m.insert("X");
    m.insert("Y");
    assert.equal(m.text, "👩‍💻\tXY XY");
    assert.ok(m.revision > revision);
    m.undo();
    assert.equal(m.text, "👩‍💻\ta b");
    m.redo();
    assert.equal(m.text, "👩‍💻\tXY XY");
});

test("overlapping deletes coalesce and conflicts reject atomically", () => {
    const m = new HelixBuffer();
    m.setText("abcdef", false);
    assert.throws(() =>
        m.replaceRanges([{ start: 0, end: 3, text: "x" }, { start: 2, end: 4, text: "y" }])
    );
    assert.equal(m.text, "abcdef");
    m.replaceRanges([{ start: 0, end: 3, text: "" }, { start: 2, end: 4, text: "" }]);
    assert.equal(m.text, "ef");
    m.undo();
    assert.equal(m.text, "abcdef");
});

test("private fragments zip and repeat the last fragment", () => {
    const m = new HelixBuffer();
    m.setText("a b c", false);
    const s = (id, start, end = start) => ({ id, start, end, reversed: false });
    m.setSelections([s("a", 0, 1), s("b", 2, 3)]);
    m.yank();
    m.setSelections([s("a", 0), s("b", 2), s("c", 4)]);
    m.paste();
    assert.equal(m.text, "aa bb cb");
});

test("scalar regex ranges retain combining marks and safe visual heads", () => {
    const m = new HelixBuffer();
    m.setText("é😀", false);
    m.setSelections([{ id: "accent", start: 1, end: 2, reversed: false }]);
    assert.deepEqual(m.effectiveRange(), [1, 2]);
    assert.equal(m.cursor, 0);
    m.replaceSelection("");
    assert.equal(m.text, "e😀");
    m.undo();
    assert.equal(m.text, "é😀");
});

test("history is bounded, redo diverges, and reset invalidates empty reads", () => {
    const m = new HelixBuffer();
    m.register = "saved";
    const revision = m.revision;
    m.reset();
    assert.ok(m.revision > revision);
    assert.deepEqual(m.getRegisterFragments(), ["saved"]);
    for (let i = 0; i < 205; i++) {
        m.insert("x");
        m.escape();
        m.enterInsert(true);
    }
    let count = 0;
    while (m.undo()) count++;
    assert.equal(count, 200);
    count = 0;
    while (m.redo()) count++;
    assert.equal(count, 200);
    m.undo();
    m.insert("y");
    assert.equal(m.redo(), false);
});

test("duplicate cursor insertions coalesce and reversed insert bounds are directional", () => {
    const m = new HelixBuffer();
    m.setText("abcd", false);
    m.setSelections(["a", "b"].map((id) => ({ id, start: 1, end: 3, reversed: true })));
    m.enterInsert();
    m.insert("X");
    assert.equal(m.text, "aXbcd");
    m.undo();
    m.setSelections([{ id: "a", start: 1, end: 3, reversed: true }]);
    m.enterInsert(true);
    m.insert("Y");
    assert.equal(m.text, "abcYd");
});

test("linewise paste at EOF, CRLF and independent tab display goals", () => {
    const m = new HelixBuffer();
    m.setText("one\r\ntwo", false);
    assert.equal(m.text, "one\ntwo");
    m.setSelections([{ id: "a", start: 4, end: 7, reversed: true }]);
    m.yank();
    m.paste();
    assert.equal(m.text, "one\ntwo\ntwo");
    m.setText("\tx\nabcdef\n\tx", false);
    m.setSelections([{ id: "a", start: 1, end: 1, reversed: false }, {
        id: "b",
        start: 0,
        end: 0,
        reversed: false,
    }]);
    m.moveVertical(1);
    assert.deepEqual(m.selections.map((s) => s.start), [7, 3]);
    m.moveVertical(1);
    assert.deepEqual(m.selections.map((s) => s.start), [11, 10]);
});

const cursorSelection = (id, start, end = start, reversed = false) => ({
    id,
    start,
    end,
    reversed,
});

test("adjacent replace cursors remain independent on the next typed character", () => {
    const m = new HelixBuffer();
    m.setText("abc", false);
    m.setSelections([cursorSelection("first", 0), cursorSelection("second", 1)], "second");
    m.mode = "replace";
    m.insert("X");
    assert.equal(m.text, "XXc");
    assert.deepEqual(m.selections.map((s) => s.start), [1, 2]);
    m.insert("Y");
    assert.equal(m.text, "XYY");
    assert.deepEqual(m.selections.map((s) => s.start), [2, 3]);
    assert.equal(m.primaryId, "second");
    m.undo();
    assert.equal(m.text, "abc");
    assert.deepEqual(m.selections.map((s) => s.start), [0, 1]);
    m.redo();
    assert.equal(m.text, "XYY");
});

test("adjacent deletes then inserts preserve reversed order and EOF cursors", () => {
    const m = new HelixBuffer();
    m.setText("abcd", false);
    m.setSelections([
        cursorSelection("eof", 4),
        cursorSelection("right", 2, 3, true),
        cursorSelection("left", 1, 2),
    ], "right");
    m.deleteSelection(true);
    assert.equal(m.text, "ad");
    assert.deepEqual(m.selections.map((s) => s.start), [2, 1, 1]);
    m.insert("X");
    assert.equal(m.text, "aXdX");
    assert.deepEqual(m.selections.map((s) => s.start), [4, 2, 2]);
    m.insert("Y");
    assert.equal(m.text, "aXYdXY");
    assert.equal(m.primaryId, "right");
    m.undo();
    assert.equal(m.text, "abcd");
});

test("batch remapping uses original endpoints and half-open selection affinity", () => {
    const m = new HelixBuffer();
    m.setText("abcdef", false);
    m.setSelections([
        cursorSelection("reverse", 1, 2, true),
        cursorSelection("next", 2, 3),
        cursorSelection("untouched", 5),
    ], "reverse");
    m.replaceRanges([
        { start: 2, end: 3, text: "XYZ" },
        { start: 0, end: 1, text: "!" },
        { start: 1, end: 2, text: "QQ" },
    ]);
    assert.equal(m.text, "!QQXYZdef");
    assert.deepEqual(m.selections, [
        { ...cursorSelection("reverse", 3, 3, true), goalColumn: undefined },
        { ...cursorSelection("next", 6, 6), goalColumn: undefined },
        { ...cursorSelection("untouched", 8), goalColumn: undefined },
    ]);
    assert.equal(m.primaryId, "reverse");
});

test("conflicting batches are atomic and overlapping duplicates apply only once", () => {
    const m = new HelixBuffer();
    m.setText("abcdef", false);
    m.setSelections([cursorSelection("a", 0), cursorSelection("b", 4)]);
    const before = structuredClone(m.selections);
    const revision = m.revision;
    assert.throws(() =>
        m.replaceRanges([
            { start: 0, end: 3, text: "X" },
            { start: 2, end: 4, text: "Y" },
        ])
    );
    assert.equal(m.revision, revision);
    assert.deepEqual(m.selections, before);
    assert.equal(m.undo(), false);
    m.replaceRanges([
        { start: 0, end: 3, text: "X" },
        { start: 1, end: 3, text: "X" },
        { start: 4, end: 5, text: "Y" },
        { start: 4, end: 5, text: "Y" },
    ]);
    assert.equal(m.text, "XdYf");
    assert.deepEqual(m.selections.map((s) => s.start), [1, 3]);
});

test("transaction boundaries and reset keep revision monotonic", () => {
    const m = new HelixBuffer();
    m.insert("a");
    m.insert("b");
    m.escape();
    m.enterInsert(true);
    m.insert("c");
    m.undo();
    assert.equal(m.text, "ab");
    m.undo();
    assert.equal(m.text, "");
    const revision = m.revision;
    m.reset();
    assert.ok(m.revision > revision);
    assert.equal(m.redo(), false);
    m.insert("new");
    m.undo();
    assert.equal(m.text, "");
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
