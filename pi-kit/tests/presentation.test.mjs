import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
    clipText,
    escapeMarkdownText,
    formatHintKeys,
    formatInteractionHints,
    hardWrapText,
    inlineText,
    sanitizeDisplayText,
    ThemedLines,
    ThemedMarkdown,
    ThemedText,
    truncateToWidth,
    visibleWidth,
    wrapPreservingText,
    wrapProse,
} = await jiti.import("../src/index.ts");

const multiline = { multiline: true, tabs: "space", controls: "space" };

test("display sanitization strips terminal strings and bidi without changing the input", () => {
    const input = "\x1b[31mred\x1b[0m\x1b]52;c;secret\x07\u202e\r\nnext\tcell\x00";
    assert.equal(sanitizeDisplayText(input, multiline), "red\nnext cell ");
    assert.equal(inlineText(input), "red next cell");
    assert.ok(input.includes("secret"));
    assert.equal(sanitizeDisplayText("a\x1bPbad\ntext\x1b\\b", multiline), "ab");
    assert.equal(sanitizeDisplayText("a\u009dhidden\u009cb", multiline), "ab");
    assert.equal(sanitizeDisplayText("x\x1b]unterminated\n", multiline), "x");
    for (
        const [tabs, expected] of [["preserve", "\t"], ["space", " "], ["expand", "    "], [
            "remove",
            "",
        ]]
    ) {
        assert.equal(sanitizeDisplayText("\t", { multiline: false, tabs }), expected);
    }
    assert.equal(escapeMarkdownText("**literal** [link]"), "\\*\\*literal\\*\\* \\[link\\]");
});

test("clipping matches native Pi overflow and does not transliterate content", () => {
    for (const width of [0, 1, 2, 3, 5, 10]) {
        const clipped = clipText("界hello world", width);
        assert.ok(visibleWidth(clipped) <= width);
        assert.equal(clipped, truncateToWidth("界hello world", width));
    }
    assert.equal(clipText("界", 2), "界");
    assert.equal(plain(clipText("long", 1)), ".");
    assert.equal(clipText("text", NaN), "");
});

test("wrapping policies retain separate whitespace and oversized-grapheme contracts", () => {
    assert.deepEqual(hardWrapText("ab cd\n\tX", 3), ["ab ", "cd", "   ", " X"]);
    assert.deepEqual(hardWrapText("界", 1), ["?"]);
    assert.deepEqual(wrapProse("ordinary words", 9), ["ordinary", "words"]);
    const original = "one  two\tthree\n界";
    for (const width of [1, 2, 3, 8, 20]) {
        for (const wrap of [hardWrapText, wrapProse, wrapPreservingText]) {
            assert.ok(wrap(original, width).every((row) => visibleWidth(row) <= width));
            assert.deepEqual(wrap(original, 0), []);
        }
    }
    assert.equal(wrapPreservingText("a  b", 20).join(""), "a  b");
    const link = "\x1b]8;;https://example.com\x1b\\";
    const rows = wrapPreservingText(`\x1b[31m${link}abcdef\x1b]8;;\x1b\\`, 3);
    assert.deepEqual(rows.map(plain), ["abc", "def"]);
    assert.ok(rows.every((row) => row.includes(link) && row.includes("\x1b]8;;\x1b\\")));
    assert.ok(rows.every((row) => !row.includes("\x1b[0m")));
});

test("unframed components evaluate callbacks per render and own only requested padding", async () => {
    let label = "first";
    const component = new ThemedText(() => label, { outputPad: 1 });
    assert.deepEqual(component.render(12), [" first "]);
    label = "second";
    component.invalidate();
    assert.deepEqual(component.render(12), [" second "]);
    assert.deepEqual(new ThemedLines(() => ["a", "b"]).render(5), ["a", "b"]);
    for (const width of [0, 1, 2, 3, 4, 12]) {
        assert.ok(component.render(width).every((row) => visibleWidth(row) <= width));
    }
    const { initTheme, getMarkdownTheme } = await jiti.import("@earendil-works/pi-coding-agent");
    initTheme("dark");
    let themes = 0;
    const markdown = new ThemedMarkdown(() => "**hello**\u202e", () => {
        themes++;
        return getMarkdownTheme();
    });
    markdown.render(10);
    markdown.invalidate();
    assert.ok(markdown.render(1).every((row) => visibleWidth(row) <= 1));
    assert.equal(themes, 2);
    assert.equal(formatHintKeys(["ctrl+a", "ctrl+a", "enter"]), "ctrl+a/enter");
});

test("hints retain native arrows and separators without rewriting labels or remapped keys", () => {
    const bindings = {
        getKeys: (action) =>
            ({
                "tui.select.up": ["up", "ctrl+k"],
                "tui.select.down": ["down", "ctrl+j"],
                "tui.select.confirm": ["enter"],
            })[action] ?? [],
    };
    assert.equal(
        formatInteractionHints(bindings, [
            { bindings: ["tui.select.up", "tui.select.down"], label: "navigate" },
            { bindings: ["tui.select.confirm"], label: "select" },
        ]),
        "↑/ctrl+k/↓/ctrl+j navigate · enter select",
    );
    assert.equal(formatHintKeys(["up", "down", "ctrl+left", "right"]), "↑/↓/ctrl+←/→");
    assert.equal(
        formatInteractionHints(bindings, [{ keys: ["enter"], label: "keep ^ v < > literal" }]),
        "enter keep ^ v < > literal",
    );
});
