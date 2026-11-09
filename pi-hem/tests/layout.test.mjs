import { createJiti } from "jiti";
import assert from "node:assert/strict";
import { test } from "node:test";
const jiti = createJiti(import.meta.url);
const { HelixBuffer } = await jiti.import("../src/model.ts");
const { layout } = await jiti.import("../src/layout.ts");
test("layout expands tabs without changing text and neutralizes pasted controls", () => {
    const b = new HelixBuffer();
    b.setText("a\tb\x1b[31m");
    const rows = layout(b, 20);
    assert.equal(rows[0].cells[1].text, "   ");
    assert.ok(!rows.flatMap((r) => r.cells).some((c) => c.text.includes("\x1b")));
    assert.equal(b.text, "a\tb\x1b[31m");
});
test("layout fits columns one through three", () => {
    const b = new HelixBuffer();
    b.setText("ab 界\tcd");
    for (const width of [1, 2, 3]) {
        assert.ok(layout(b, width).every((r) => r.cells.reduce((n, c) => n + c.width, 0) <= width));
    }
});
