import assert from "node:assert/strict";
import { test } from "node:test";
import { HelixBuffer } from "../src/model.ts";
import { CommandController } from "../src/commands.ts";
function setup(text, options) {
    const b = new HelixBuffer();
    b.setText(text);
    b.escape();
    b.moveTo(0);
    return [b, new CommandController(b, options)];
}
test("decoded space stays literal in search and selection prompts", () => {
    const matcher = (text, pattern) =>
        [...text.matchAll(new RegExp(pattern, "g"))]
            .map((m) => ({ start: m.index, end: m.index + m[0].length }));
    for (const prompt of ["/", "?", "s"]) {
        const [b, c] = setup("one two onetwo", { matcher });
        if (prompt === "s") c.handleKey("%");
        c.handleKey(prompt);
        for (const key of ["o", "n", "e", "space", "t", "w", "o"]) c.handleKey(key);
        assert.equal(c.search.pattern, "one two");
        c.handleKey("enter");
        assert.equal(b.text.slice(b.primary.start, b.primary.end), "one two");
    }
});
test("decoded space is a replacement and find target, not a register name", () => {
    const [b, c] = setup("a b c");
    c.handleKey("r");
    c.handleKey("space");
    assert.equal(b.text, "  b c");
    for (const [command, head] of [["f", 1], ["t", 0]]) {
        b.moveTo(0);
        c.handleKey(command);
        c.handleKey("space");
        assert.equal(b.visualHead(), head);
    }
    for (const prefix of ["\"", "@"]) {
        c.handleKey(prefix);
        assert.equal(c.handleKey("space"), false);
    }
    c.handleKey("i");
    c.handleKey("ctrl+r");
    assert.equal(c.handleKey("space"), false);
    c.handleKey("ctrl+k");
    c.handleKey("space");
    assert.equal(c.pending, "digraph: ");
    c.handleKey("space");
    assert.match(c.status, /Unknown digraph:   /);
});
test("middle-word completion replays replacement with a midword cursor", () => {
    const [b, c] = setup("fox fox");
    c.handleKey("i");
    b.moveTo(1);
    b.replaceRanges([{ start: 1, end: 3, text: "oo" }]);
    c.recordCompletion(0, 2, "oo", 1);
    c.handleKey("escape");
    b.moveTo(5);
    c.handleKey(".");
    assert.equal(b.text, "foo foo");
});
test("completion replay validates all cursor ranges before editing", () => {
    const [b, c] = setup("fox");
    c.recordCompletion(-1, 2, "oo", 1);
    b.moveTo(0);
    c.handleKey(".");
    assert.equal(b.text, "fox");
    assert.match(c.status, /invalid/);
});
test("completion replay edits multiple divergent tokens atomically and preserves cursor delta", () => {
    const [b, c] = setup("fox fax");
    b.setSelections([
        { id: "a", start: 1, end: 1, reversed: false },
        { id: "b", start: 5, end: 5, reversed: false },
    ], "a");
    c.recordCompletion(0, 2, "oo", 1);
    c.handleKey(".");
    assert.equal(b.text, "foo foo");
    assert.deepEqual(b.selections.map((s) => s.start), [2, 6]);
});
test("resolved clipboard placement replays captured value without another read", async () => {
    let reads = 0;
    const [b, c] = setup("ab", {
        clipboard: {
            read: async () => {
                reads++;
                return "PRIVATE";
            },
            write: async () => {
                throw new Error("unexpected write");
            },
        },
    });
    c.handleKey("Q");
    await c.clipboard("paste", "clipboard", "P");
    c.handleKey("Q");
    assert.equal(b.text, "PRIVATEab");
    b.moveTo(0);
    c.handleKey("q");
    assert.equal(b.text, "PRIVATEPRIVATEab");
    c.handleKey(".");
    assert.equal(reads, 1);
    assert.equal(c.hasPending, false);
});
test("literal external insertion repeats without interpreting escape or newline", () => {
    let effects = 0;
    const [b, c] = setup("", { view: { page: () => effects++ } });
    const text = "\u001b\nctrl+f";
    c.handleKey("Q");
    assert.match(c.status, /recording/);
    c.handleKey("i");
    b.insert(text);
    c.recordInsertion(text);
    c.handleKey("escape");
    c.handleKey("Q");
    b.moveTo(b.length);
    c.handleKey(".");
    assert.equal(b.text, text + text);
    assert.equal(effects, 0);
    b.moveTo(b.length);
    c.handleKey("q");
    assert.equal(b.text, text.repeat(3));
});
test("cancel and dispose close no-yank change transactions", () => {
    for (const finish of ["cancelPending", "dispose"]) {
        const [b, c] = setup("abc");
        for (const key of ["alt+c", "Z"]) c.handleKey(key);
        c[finish]();
        b.undo();
        assert.equal(b.text, "abc");
    }
});
test("location and pending literal/register resolve as text", () => {
    const [b, c] = setup("abc");
    c.handleKey("ctrl+g");
    assert.match(c.status, /line 1, column 1/);
    for (const key of ["y", "i", "ctrl+r"]) c.handleKey(key);
    assert.equal(c.hasPending, true);
    c.handleKey("\"");
    c.handleKey("ctrl+v");
    assert.equal(c.hasPending, true);
    c.handleKey("enter");
    assert.equal(b.text, "a\nabc");
});
test("integrated insert controls, temporary prefix and replace restoration", () => {
    const [b, c] = setup("abc def");
    for (const key of ["i", "insert", "Z", "backspace"]) c.handleKey(key);
    assert.equal(b.text, "abc def");
    c.handleKey("ctrl+o");
    c.handleKey("g");
    assert.equal(b.mode, "normal");
    c.handleKey("l");
    assert.equal(b.mode, "insert");
});
test("blackhole change plus typing is one undo and display endpoints delegate", () => {
    const calls = [];
    const [b, c] = setup("abc", { view: { boundary: (...args) => calls.push(args) } });
    for (const key of ["g", "$", "\"", "_", "c", "Z", "escape", "u"]) c.handleKey(key);
    assert.equal(b.text, "abc");
    assert.deepEqual(calls, [["end", 1]]);
});
test("line actions, previous WORD end, blank lines and one-based columns", () => {
    const [b, c] = setup("abc def\n\nlast");
    c.handleKey("3");
    c.handleKey("|");
    assert.equal(b.visualHead(), 2);
    c.handleKey("D");
    assert.equal(b.text, "ab\n\nlast");
    c.handleKey("]");
    c.handleKey("space");
    assert.equal(b.visualHead(), 3);
    c.handleKey("g");
    c.handleKey("E");
    assert.equal(b.visualHead(), 1);
});
test("resolved occurrence replacement preserves older cursor; inherited previous adds", () => {
    const [b, c] = setup("one one one");
    b.setSelections([{ id: "older", start: 0, end: 3 }, { id: "new", start: 4, end: 7 }], "new");
    c.handleKey("g");
    c.handleKey(">");
    assert.deepEqual(b.selections.map((s) => [s.start, s.end]), [[0, 3], [8, 11]]);
    c.handleKey("g");
    c.handleKey("L");
    assert.deepEqual(b.selections.map((s) => [s.start, s.end]), [[0, 3], [8, 11], [4, 7]]);
});
test("pending ownership, line targets and repeat find have independent expectations", () => {
    const [b, c] = setup("a😀\na😀\na😀");
    c.handleKey("2");
    assert.equal(c.hasPending, true);
    c.handleKey("f");
    c.handleKey("😀");
    assert.equal(b.visualHead(), 5);
    c.handleKey("alt+.");
    assert.equal(b.visualHead(), 5);
    c.handleKey("escape");
    c.handleKey("2");
    c.handleKey("g");
    c.handleKey("g");
    assert.equal(b.visualHead(), 4);
    c.handleKey("g");
    c.handleKey("e");
    assert.equal(b.visualHead(), 8);
    c.handleKey("space");
    c.handleKey("a");
    assert.equal(c.hasPending, false);
});
test("visual callbacks respect normal versus select and g aliases", () => {
    const calls = [];
    const [b, c] = setup("abcdef\nxyz", { view: { moveVisual: (d, n) => calls.push([d, n]) } });
    c.handleKey("j");
    assert.deepEqual(calls, [[1, 1]]);
    c.handleKey("v");
    c.handleKey("j");
    assert.equal(calls.length, 1);
    c.handleKey("g");
    c.handleKey("up");
    assert.deepEqual(calls.at(-1), [-1, 1]);
    b.mode = "normal";
    c.handleKey("g");
    c.handleKey("down");
    assert.equal(calls.length, 2);
});
test("disposed clipboard reads and cuts cannot mutate and primary changes invalidate", async () => {
    for (const action of ["paste", "cut"]) {
        let resolve;
        const promise = new Promise((r) => {
            resolve = r;
        });
        const [b, c] = setup("abc", { clipboard: { read: () => promise, write: () => promise } });
        const pending = c.clipboard(action);
        const revision = b.revision;
        c.dispose();
        resolve("unsafe");
        assert.equal(await pending, false);
        assert.equal(b.text, "abc");
        assert.equal(b.revision, revision);
        assert.equal(c.handleKey("d"), false);
    }
    let resolve;
    const [b, c] = setup("abc", {
        clipboard: {
            read: () =>
                new Promise((r) => {
                    resolve = r;
                }),
            write: async () => {},
        },
    });
    b.setSelections([{ id: "a", start: 0, end: 0 }, { id: "b", start: 2, end: 2 }], "a");
    const pending = c.clipboard("paste");
    b.setSelections(b.selections, "b");
    resolve("unsafe");
    assert.equal(await pending, false);
    assert.equal(b.text, "abc");
});
test("named fragment paste zips and repeats last; primary clipboard is explicit", async () => {
    const calls = [];
    const [b, c] = setup("ab cd", {
        clipboard: {
            read: async (kind) => {
                calls.push(kind);
                return "!";
            },
            write: async (text, kind) => {
                calls.push([text, kind]);
            },
        },
    });
    b.setSelections([{ id: "a", start: 0, end: 1 }, { id: "b", start: 3, end: 4 }]);
    keys(c, "\"", "a", "y");
    b.setSelections([{ id: "a", start: 1, end: 1 }, { id: "b", start: 4, end: 4 }, {
        id: "c",
        start: 5,
        end: 5,
    }]);
    keys(c, "\"", "a", "P");
    assert.equal(b.text, "aab ccdc");
    keys(c, "\"", "*", "y");
    await Promise.resolve();
    assert.equal(calls[0][1], "primary");
    keys(c, "\"", "*", "p");
    await Promise.resolve();
    assert.equal(calls[1], "primary");
});
test("linewise counted paste at EOF and blackhole preserve private yank", () => {
    const [b, c] = setup("one\ntwo");
    keys(c, "x", "\"", "a", "y");
    b.moveTo(b.length);
    keys(c, "\"", "a", "2", "p");
    assert.equal(b.text, "one\ntwo\none\none");
    b.moveTo(0);
    keys(c, "\"", "_", "d");
    b.moveTo(0);
    keys(c, "\"", "a", "P");
    assert.ok(b.text.startsWith("one\n"));
});
test("invalid regex confirmation retains both search and selection prompts", () => {
    for (const command of ["/", "s"]) {
        const [b, c] = setup("abc", {
            matcher: () => {
                throw new Error("invalid");
            },
        });
        keys(c, command, "[", "enter");
        assert.equal(c.search.pattern, "[");
        assert.equal(b.text, "abc");
        keys(c, "escape");
        assert.equal(c.search, null);
    }
});
function keys(c, ...keys) {
    for (const key of keys) assert.equal(c.handleKey(key), true, key);
}
test("counts, normal/select motions and change insert undo", () => {
    const [b, c] = setup("one two three");
    keys(c, "2", "w");
    assert.equal(b.visualHead(), 8);
    keys(c, "c", "X", "escape");
    assert.equal(b.text, "one Xhree");
    keys(c, "u");
    assert.equal(b.text, "one two three");
    assert.equal(c.handleKey("ctrl+enter"), false);
});
test("no-yank delete preserves register, case, numeric and indent", () => {
    const [b, c] = setup("12 abc");
    b.register = "saved";
    keys(c, "ctrl+a");
    assert.equal(b.text, "13 abc");
    b.moveTo(0);
    keys(c, "alt+d");
    assert.equal(b.register, "saved");
    keys(c, ">");
    assert.ok(b.text.startsWith("    "));
    keys(c, "<");
    assert.ok(!b.text.startsWith(" "));
});
test("prefix cancellation, character find, objects, surrounds and match", () => {
    const [b, c] = setup("(one two)");
    keys(c, "m", "i", "(");
    assert.equal(b.text.slice(b.primary.start, b.primary.end), "one two");
    keys(c, "m", "s", "[");
    assert.equal(b.text, "([one two])");
    b.moveTo(0);
    keys(c, "m", "m");
    assert.equal(b.visualHead(), 10);
    keys(c, "f");
    assert.equal(c.pending, "f");
    assert.equal(c.cancelPending(), true);
    assert.equal(c.cancelPending(), false);
});
test("dot repeats insertion and named macros replay", () => {
    const [b, c] = setup("abc");
    keys(c, "i", "X", "escape");
    b.moveTo(2);
    keys(c, ".");
    assert.equal(b.text, "XaXbc");
    keys(c, "\"", "a", "Q", "l", "Q");
    b.moveTo(0);
    keys(c, "q");
    assert.equal(b.visualHead(), 1);
    b.moveTo(0);
    keys(c, "@", "a");
    assert.equal(b.visualHead(), 1);
});
test("search preview restores on cancel, commits and selects regex matches", () => {
    const matcher = (text, pattern) =>
        [...text.matchAll(new RegExp(pattern, "g"))].map((m) => ({
            start: m.index,
            end: m.index + m[0].length,
        }));
    const [b, c] = setup("one two one", { matcher });
    keys(c, "/", "o", "n", "e");
    assert.equal(b.primary.start, 8);
    keys(c, "escape");
    assert.equal(b.primary.start, 0);
    keys(c, "/", "o", "n", "e", "enter");
    assert.equal(c.search, null);
    keys(c, "%");
    assert.equal(c.selectRegex("one"), true);
    assert.equal(b.selections.length, 2);
});
test("surround removal/replacement, directional words and occurrence selection", () => {
    const [b, c] = setup("(one) two one");
    keys(c, "m", "r", "(", "[");
    assert.equal(b.text, "[one] two one");
    b.moveTo(1);
    keys(c, "m", "d", "[");
    assert.equal(b.text, "one two one");
    b.moveTo(0);
    keys(c, "]", "w");
    assert.equal(b.text.slice(b.primary.start, b.primary.end), "two");
    b.setSelections([{ id: "word", start: 0, end: 3, reversed: false }]);
    keys(c, "space", "h");
    assert.equal(b.selections.length, 2);
});
test("selection, indentation, rectangles and paging callbacks", () => {
    const calls = [];
    const [b, c] = setup("abc\ndef\nghi", {
        view: {
            page(...args) {
                calls.push(args);
            },
        },
    });
    keys(c, "space", "h");
    assert.equal(b.visualHead(), 0);
    keys(c, "ctrl+v", "l", "j");
    assert.equal(b.selections.length, 2);
    keys(c, "ctrl+q");
    keys(c, "2", "ctrl+d");
    assert.deepEqual(calls, [[1, 2, true]]);
    const [ib, ic] = setup("root\n  child\n  sibling\nend");
    ib.moveTo(8);
    keys(ic, "m", "i", "i");
    assert.equal(ib.text.slice(ib.primary.start, ib.primary.end), "  child\n  sibling");
});
test("clipboard failures and stale read cannot destructively edit", async () => {
    let resolve;
    const [b, c] = setup("abc", {
        clipboard: {
            read: () => new Promise((r) => resolve = r),
            write: async () => {
                throw Error("denied");
            },
        },
    });
    assert.equal(await c.clipboard("cut"), false);
    assert.equal(b.text, "abc");
    const pending = c.clipboard("paste");
    b.moveHorizontal(1);
    resolve("X");
    assert.equal(await pending, false);
    assert.equal(b.text, "abc");
});
test("corrected motions, count rejection, cursor duplication and join", () => {
    const [b, c] = setup("  abc\ndef\nghi");
    keys(c, "G");
    assert.equal(b.cursor, 0);
    keys(c, "2", "G");
    assert.equal(b.cursor, 6);
    b.moveTo(0);
    keys(c, "I", "space", "escape");
    assert.equal(b.text, "   abc\ndef\nghi");
    b.moveTo(0);
    const text = b.text;
    keys(c, "C");
    assert.equal(b.text, text);
    assert.equal(b.selections.length, 2);
    keys(c, ",", "J");
    assert.equal(b.text, "   abc def\nghi");
    const before = b.text;
    keys(c, "9", "9", "9", "9", "9", "d");
    assert.equal(b.text, before);
    assert.match(c.status, /rejected/i);
});
test("undo is not captured as dot repeat and invalid regex stays active", () => {
    const matcher = (text, pattern) =>
        [...text.matchAll(new RegExp(pattern, "g"))].map((m) => ({
            start: m.index,
            end: m.index + m[0].length,
        }));
    const [b, c] = setup("abc", { matcher });
    keys(c, "d", "u", ".");
    assert.equal(b.text, "bc");
    keys(c, "/", "[", "enter");
    assert.notEqual(c.search, null);
    keys(c, "escape");
    keys(c, "i", "ctrl+v", "ctrl+a", "escape");
    assert.ok(b.text.includes("\u0001"));
});
test("visual versus logical callback and replay host-effects guard", () => {
    let calls = 0;
    const [b, c] = setup("abc\ndef", {
        view: {
            moveVisual() {
                calls++;
            },
        },
    });
    keys(c, "j");
    assert.equal(calls, 1);
    keys(c, "g", "j");
    assert.equal(calls, 1);
    assert.equal(b.position.line, 1);
    keys(c, "Q", "j", "Q");
    assert.equal(calls, 2);
    keys(c, "q");
    assert.equal(calls, 2);
});
test("replace, literal, digraph and multiselection transforms", () => {
    const [b, c] = setup("abc");
    b.mode = "replace";
    keys(c, "X", "escape");
    assert.equal(b.text, "Xbc");
    keys(c, "i", "ctrl+k", "a", "e", "ctrl+v", "tab", "escape");
    assert.ok(b.text.includes("æ\t"));
    b.setSelections([{ id: "a", start: 0, end: 1, reversed: false }, {
        id: "b",
        start: b.text.length - 1,
        end: b.text.length,
        reversed: false,
    }]);
    keys(c, "alt+`");
    assert.ok(b.text.endsWith("C"));
});
