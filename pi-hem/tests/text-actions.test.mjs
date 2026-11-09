import assert from "node:assert/strict";
import { test } from "node:test";
import { bindings } from "../src/compatibility.ts";
import { HelixBuffer } from "../src/model.ts";
import { extraTextAction as action } from "../src/text-actions.ts";
const setup = (text, offsets = [0]) => {
    const b = new HelixBuffer();
    b.setText(text, false);
    b.mode = "normal";
    b.setSelections(offsets.map((p, i) => ({ id: String(i), start: p, end: p, reversed: false })));
    return b;
};
test("manifest pending exact keys remain controller-owned", () => {
    const pending = bindings.filter((b) => b.classification === "pending");
    assert.deepEqual(pending.map((b) => `${b.modes.join("/")}|${b.keys.join(" ")}`).sort(), []);
});
test("duplicate above aliases are Unicode-safe, preserve primary, deduplicate", () => {
    for (const key of ["alt+C", "ctrl+C", "ctrl+shift+c", "alt+shift+c"]) {
        const b = setup("🙂x\n🙂y\n🙂z", [10]);
        action(b, [key], { count: 2 });
        assert.deepEqual(b.selections.map((s) => s.start), [10, 6, 2]);
        assert.equal(b.primaryId, "0");
        action(b, [key]);
        assert.equal(b.selections.length, 3);
    }
});
test("closest quote and explicit bars, inner/around, escaped and multicursor", () => {
    const b = setup("\"🙂\" xx |é|", [1, 10]);
    action(b, ["m", "i", "q"]);
    assert.deepEqual(b.selections.map((s) => b.text.slice(s.start, s.end)), ["🙂", "🙂"]);
    action(b, ["m", "a", "|"]);
    assert.deepEqual(b.selections.map((s) => b.text.slice(s.start, s.end)), ["|é|", "|é|"]);
    const escaped = setup("\"a\\\"b\"");
    action(escaped, ["m", "i", "q"]);
    assert.equal(escaped.text.slice(escaped.primary.start, escaped.primary.end), "a\\\"b");
    assert.equal(action(b, ["q"]).handled, false);
});
test("line starts follow manifest + previous, ctrl+m next; select extends", () => {
    const b = setup("  🙂\n x\n  z", [7, 11]);
    action(b, ["+"]);
    assert.deepEqual(b.selections.map((s) => s.start), [2, 6]);
    action(b, ["ctrl+m"]);
    assert.deepEqual(b.selections.map((s) => s.start), [6, 10]);
    b.mode = "select";
    action(b, ["-"]);
    assert.ok(b.selections.every((s) => s.reversed));
});
test("V line selection toggles without growing an already selected line", () => {
    const b = setup("🙂x\ny", [2]);
    action(b, ["V"]);
    assert.equal(b.mode, "select");
    assert.deepEqual([b.primary.start, b.primary.end], [0, 4]);
    action(b, ["V"]);
    assert.equal(b.mode, "normal");
    assert.equal(b.primary.start, b.primary.end);
});
test("tab aliases move to four-column stops with graphemes and literal tabs", () => {
    for (const key of ["tab", "shift+tab"]) {
        const b = setup("🙂abcde\n\txyz", [0, 8]);
        action(b, [key]);
        assert.deepEqual(b.selections.map((s) => s.start), [5, 9]);
    }
});
test("viewport callbacks and page aliases are explicit, never silent no-ops", () => {
    const b = setup("a\nb\nc\nd");
    const calls = [];
    const view = {
        scroll: (n) => calls.push(n),
        align: (p) => calls.push(p),
        middle: () => 4,
        pageSize: 2,
    };
    for (const key of ["ctrl+e", "ctrl+y"]) action(b, [key], { count: 3, view });
    for (const key of ["t", "z", "b"]) action(b, ["z", key], { view });
    assert.deepEqual(calls, [3, -3, "top", "center", "bottom"]);
    action(b, ["M"], { view });
    assert.equal(b.cursor, 4);
    action(b, ["pageup"], { view });
    assert.equal(b.cursor, 0);
    action(b, ["pagedown"], { view });
    assert.equal(b.cursor, 4);
    action(b, ["ctrl+b"], { view });
    action(b, ["ctrl+f"], { view });
    assert.equal(b.cursor, 4);
    for (const keys of [["ctrl+e"], ["M"], ["z", "t"], ["pageup"], ["z", "h"], ["z", "L"]]) {
        const result = action(b, keys);
        assert.equal(result.handled, false);
        assert.ok(result.unsupported);
    }
});
test("search intent, syntax sections, unknown keys and insert mode don't mutate", () => {
    const b = setup("🙂");
    assert.deepEqual(action(b, ["g", "N"]), { handled: true, intent: "select-previous-match" });
    for (const keys of [["]", "z"], ["[", "Z"], ["g", "."], ["q"]]) {
        assert.equal(action(b, keys).handled, false);
    }
    b.mode = "insert";
    assert.equal(action(b, ["V"]).handled, false);
    assert.equal(b.text, "🙂");
});
