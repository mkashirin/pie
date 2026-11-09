import assert from "node:assert/strict";
import { test } from "node:test";
import { RegisterBank } from "../src/registers.ts";
const value = (...fragments) => ({ fragments, linewise: false });
test("named append, defensive fragments, blackhole and yank history", () => {
    const bank = new RegisterBank();
    bank.write(value("a", "b"), "yank", "a");
    bank.write(value("!"), "yank", "A");
    assert.deepEqual(bank.read("a").fragments, ["a!", "b!"]);
    bank.read("a").fragments[0] = "corrupt";
    bank.write(value("discard"), "delete", "_");
    assert.deepEqual(bank.read("0").fragments, ["a!", "b!"]);
    bank.write(value("small"), "delete");
    assert.deepEqual(bank.read("-").fragments, ["small"]);
    bank.write(value("first\n"), "delete");
    bank.write(value("second\n"), "delete");
    assert.deepEqual(bank.read("1").fragments, ["second\n"]);
    assert.deepEqual(bank.read("2").fragments, ["first\n"]);
});
