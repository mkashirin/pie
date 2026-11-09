import assert from "node:assert/strict";
import { test } from "node:test";
import { HelixBuffer } from "../src/model.ts";
import { handleInsertCommand as key, insertText } from "../src/insert.ts";
function setup(text, offsets) {
    const b = new HelixBuffer();
    b.setText(text, false);
    b.setSelections(offsets.map((p, i) => ({ id: String(i), start: p, end: p, reversed: false })));
    return b;
}
for (
    const [command, text, offsets, expected] of [
        ["delete-line-end", "é🙂\nabc", [1, 5], "é\na"],
        ["ctrl+w", "é🙂\n  foo", [6, 9], "é"],
        ["ctrl+u", "é🙂\nabc", [3, 7], "\n"],
        ["ctrl+t", "é\n🙂", [0, 2], "    é\n    🙂"],
        ["ctrl+d", "\té\n    🙂", [1, 7], "é\n🙂"],
        ["ctrl+y", "é🙂\nx\ny", [5, 7], "é🙂\nx🙂\ny"],
        ["ctrl+e", "x\ny\né🙂", [1, 3], "x\ny🙂\né🙂"],
    ]
) {
    test(`${command} Unicode multi-cursor edit is atomic`, () => {
        const b = setup(text, offsets);
        key(b, command);
        assert.equal(b.text, expected);
        assert.equal(b.undo(), true);
        assert.equal(b.text, text);
        assert.deepEqual(b.selections.map((s) => s.start), offsets);
    });
}
test("copy column inside tab and missing source are safe", () => {
    const b = setup("\t🙂\na\n", [5, 7]);
    key(b, "ctrl+y");
    assert.equal(b.text, "\t🙂\na\t\na");
});
test("replace restoration is grapheme-aware, atomic, and redoable", () => {
    const b = setup("é🙂\né🙂", [0, 4]);
    b.mode = "replace";
    insertText(b, "👩‍💻");
    assert.equal(b.text, "👩‍💻🙂\n👩‍💻🙂");
    key(b, "backspace");
    assert.equal(b.text, "é🙂\né🙂");
    assert.deepEqual(b.selections.map((s) => s.start), [0, 4]);
    b.undo();
    assert.equal(b.text, "👩‍💻🙂\n👩‍💻🙂");
    b.redo();
    assert.equal(b.text, "é🙂\né🙂");
});
test("replace history invalidates on external edits and navigation", () => {
    const b = setup("é🙂", [0]);
    b.mode = "replace";
    insertText(b, "X");
    key(b, "left");
    key(b, "backspace");
    assert.equal(b.text, "X🙂");
    insertText(b, "Y");
    b.insert("Z");
    key(b, "backspace");
    assert.equal(b.text, "YZ");
});
test("intents have no host effects; toggles and exits preserve Unicode", () => {
    const b = setup("🙂é", [0, 2]);
    for (
        const [k, pending] of [["ctrl+r", "register"], ["ctrl+v", "literal"], ["ctrl+k", "digraph"]]
    ) {
        assert.deepEqual(key(b, k), { handled: true, pending });
    }
    assert.deepEqual(key(b, "ctrl+x ctrl+o"), { handled: true, showCompletions: true });
    key(b, "insert");
    assert.equal(b.mode, "replace");
    key(b, "insert");
    assert.equal(b.mode, "insert");
    assert.deepEqual(key(b, "ctrl+o"), { handled: true, temporaryNormal: true });
    assert.equal(b.mode, "normal");
    assert.deepEqual(key(b, "ctrl+w"), { handled: false });
    for (const exit of ["escape", "ctrl+c", "ctrl+["]) {
        b.mode = "insert";
        key(b, exit);
        assert.equal(b.mode, "normal");
    }
    assert.equal(b.text, "🙂é");
});
