import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { inlineText, sanitizeDisplayText, sanitizeTerminalText } = await jiti.import(
    "../src/index.ts",
);
const multiline = { multiline: true, tabs: "preserve", controls: "remove" };

test("ESC and C1 strings consume multiline payloads through every supported terminator", () => {
    const pairs = [
        ["\x1b]", true],
        ["\u009d", true],
        ["\x1bP", false],
        ["\u0090", false],
        ["\x1bX", false],
        ["\u0098", false],
        ["\x1b^", false],
        ["\u009e", false],
        ["\x1b_", false],
        ["\u009f", false],
    ];
    for (const [start, osc] of pairs) {
        for (const end of ["\x1b\\", "\u009c", ...(osc ? ["\x07"] : [])]) {
            const raw = `before${start}private\n\r\u2028\t\x1b[31msecret${end}after`;
            const saved = raw;
            assert.equal(sanitizeDisplayText(raw, multiline), "beforeafter", JSON.stringify(raw));
            assert.equal(inlineText(raw), "beforeafter");
            assert.equal(raw, saved, "sanitization operates on a display copy");
        }
        for (const suffix of ["", "\n", "\nprivate", "\nprivate\x1b", "\nprivate\x1b["]) {
            assert.equal(sanitizeDisplayText(`before${start}${suffix}`, multiline), "before");
        }
        if (!osc) {
            assert.equal(sanitizeTerminalText(`a${start}private\x07still private\x1b\\b`), "ab");
        }
    }
});

test("pending ESC/CSI forms never expose protocol bytes or consume subsequent plain text", () => {
    for (const pending of ["\x1b", "\x1b(", "\x1b #", "\x1b[", "\x1b[31;", "\u009b12; "]) {
        assert.equal(sanitizeTerminalText(`kept${pending}`), "kept", JSON.stringify(pending));
    }
    for (
        const sequence of [
            "\x1b(B",
            "\x1b#8",
            "\x1b[31m",
            "\u009b1;2H",
            "\x1b[31\nm",
            "\x1b\x1b[0m",
        ]
    ) {
        assert.equal(sanitizeTerminalText(`a${sequence}b`), "ab", JSON.stringify(sequence));
    }
    assert.equal(sanitizeTerminalText("a\x1b\nb"), "a\nb");
    assert.equal(sanitizeTerminalText("a\x1b(\nb"), "a\nb");
    assert.equal(sanitizeTerminalText("a\x1b[12;界b"), "a界b");
    assert.equal(
        sanitizeTerminalText("👩‍💻 e\u0301 界\r\nnext\u0085line\u2028last\u2029end"),
        "👩‍💻 e\u0301 界\nnext\nline\nlast\nend",
    );
});
