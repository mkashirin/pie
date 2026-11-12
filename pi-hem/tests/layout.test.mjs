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

test("invalid and fractional layout widths retain every editing offset and raw grapheme", () => {
    const b = new HelixBuffer();
    b.setText("a👩‍💻é\t界\n\x1b[31m");
    b.moveTo(1);
    const before = JSON.stringify([b.text, b.selections, b.revision]);
    const indices = b.cells.flatMap((cell, index) => cell === "\n" ? [] : [index]);
    for (const width of [NaN, Infinity, -Infinity, -3, 0, 0.9, 1, 1.9, 2.9, 8.9]) {
        const columns = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
        const rows = layout(b, width);
        assert.deepEqual(rows, layout(b, columns));
        assert.deepEqual(rows.flatMap((row) => row.cells.map((cell) => cell.index)), indices);
        assert.ok(rows.every((row) => row.cells.reduce((n, cell) => n + cell.width, 0) <= columns));
        assert.equal(rows.filter((row) => row.cursor).length, 1);
        assert.equal(JSON.stringify([b.text, b.selections, b.revision]), before);
    }
});
