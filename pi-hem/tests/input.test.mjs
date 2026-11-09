import test from "node:test";
import assert from "node:assert/strict";
import { decodeInput, InputDecoder } from "../src/input.ts";

test("legacy and Kitty canonical equivalence", () => {
    for (
        const [legacy, kitty, expected] of [
            ["I", "\x1b[105;2u", "I"],
            ["\x01", "\x1b[97;5u", "ctrl+a"],
            ["\n", "\x1b[106;5u", "ctrl+j"],
            ["\x1bc", "\x1b[99;3u", "alt+c"],
            ["\x1b[27;2;13~", "\x1b[13;2u", "shift+enter"],
            ["\x1b[A", "\x1b[57352u", "up"],
        ]
    ) {
        assert.deepEqual(decodeInput(legacy), [expected]);
        assert.deepEqual(decodeInput(kitty), [expected]);
        for (const sequence of [legacy, kitty]) {
            for (let boundary = 0; boundary <= sequence.length; boundary++) {
                const decoder = new InputDecoder();
                assert.deepEqual([
                    ...decoder.feed(sequence.slice(0, boundary)),
                    ...decoder.feed(sequence.slice(boundary)),
                ], [{ type: "key", key: expected }]);
            }
        }
    }
});
test("fragmented paste preserves controls and Unicode literally", () => {
    const decoder = new InputDecoder();
    assert.deepEqual(decoder.feed("\x1b[20"), []);
    assert.deepEqual(decoder.feed("0~a\x01😀\x1b[20"), []);
    assert.deepEqual(decoder.feed("1~x"), [{ type: "paste", text: "a\x01😀" }, {
        type: "key",
        key: "x",
    }]);
});
test("paste is literal at every boundary, including lone ESC and terminator", () => {
    const text = "\r\n\x1b[A😀";
    const sequence = `\x1b[200~${text}\x1b[201~`;
    for (let boundary = 0; boundary <= sequence.length; boundary++) {
        const decoder = new InputDecoder();
        assert.deepEqual([
            ...decoder.feed(sequence.slice(0, boundary)),
            ...decoder.feed(sequence.slice(boundary)),
            ...decoder.flushEscape(),
        ], [{ type: "paste", text }]);
    }
    const decoder = new InputDecoder();
    assert.deepEqual(Array.from(sequence).flatMap((char) => decoder.feed(char)), [
        { type: "paste", text },
    ]);
});
test("Escape flush is explicit, idempotent, and leaves partial sequences alone", () => {
    const decoder = new InputDecoder();
    assert.deepEqual(decoder.feed("\x1b"), []);
    assert.deepEqual(decoder.flushEscape(), [{ type: "key", key: "escape" }]);
    assert.deepEqual(decoder.flushEscape(), []);
    assert.deepEqual(decodeInput("\x1b"), ["escape"]);
    assert.deepEqual(decoder.feed("\x1b[20"), []);
    assert.deepEqual(decoder.flushEscape(), []);
    assert.deepEqual(decoder.feed("0~\r\x1b[201~"), [{ type: "paste", text: "\r" }]);
});
test("unsupported private CSI is consumed and incomplete garbage is bounded", () => {
    for (const sequence of ["\x1b[?2004h", "\x1b[>1u", "\x1b[1 q"]) {
        for (let boundary = 0; boundary <= sequence.length; boundary++) {
            const decoder = new InputDecoder();
            assert.deepEqual(decoder.feed(sequence.slice(0, boundary)), []);
            assert.deepEqual(
                decoder.feed(sequence.slice(boundary) + "hello"),
                Array.from("hello", (key) => ({ type: "key", key })),
            );
        }
    }
    const decoder = new InputDecoder();
    assert.deepEqual(decoder.feed("\x1b["), []);
    for (let i = 0; i < 1000; i++) {
        assert.deepEqual(decoder.feed("1234567890"), []);
        assert.ok(decoder.pending.length <= 256);
    }
    assert.deepEqual(decoder.feed("uhello"), Array.from("hello", (key) => ({ type: "key", key })));
});
test("Kitty releases are ignored at every boundary", () => {
    const sequence = "\x1b[97;1:3u";
    for (let boundary = 0; boundary <= sequence.length; boundary++) {
        const decoder = new InputDecoder();
        assert.deepEqual(decoder.feed(sequence.slice(0, boundary)), []);
        assert.deepEqual(decoder.feed(sequence.slice(boundary)), []);
        assert.deepEqual(decoder.feed("x"), [{ type: "key", key: "x" }]);
    }
});
test("split UTF-16 and Kitty sequence, releases ignored", () => {
    const decoder = new InputDecoder();
    assert.deepEqual(decoder.feed("\ud83d"), []);
    assert.deepEqual(decoder.feed("\ude00\x1b[97;"), [{ type: "key", key: "😀" }]);
    assert.deepEqual(decoder.feed("5u\x1b[97;1:3u"), [{ type: "key", key: "ctrl+a" }]);
});
