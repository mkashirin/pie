import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const {
    default: extension,
    CommandController,
    graphemes,
    HelixBuffer,
    HelixEditor,
    InputDecoder,
    RegisterBank,
} = await createJiti(import.meta.url).import("../index.ts");

test("root public API preserves Pi entry and exposes usable editing primitives", () => {
    assert.equal(typeof extension, "function");
    assert.equal(typeof HelixEditor, "function");
    assert.deepEqual(graphemes("a👩‍💻"), ["a", "👩‍💻"]);
    const buffer = new HelixBuffer();
    buffer.setText("abc");
    buffer.escape();
    buffer.moveTo(0);
    const controller = new CommandController(buffer);
    assert.equal(controller.handleKey("l"), true);
    assert.equal(buffer.primary.start, 1);
    const decoder = new InputDecoder();
    assert.deepEqual(decoder.feed("a"), [{ type: "key", key: "a" }]);
    const registers = new RegisterBank();
    const value = { text: "hello", linewise: false, fragments: ["hello"] };
    registers.write(value, "yank");
    assert.deepEqual(registers.read(), value);
});
