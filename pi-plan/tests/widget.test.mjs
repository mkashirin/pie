import { test } from "node:test";
import assert from "node:assert/strict";
import { jiti, visibleWidth } from "./helpers.mjs";

const { renderPlanModeWidget, sanitizePlanModeWidgetLine } = await jiti.import("../index.ts");
const theme = { fg: (_color, text) => text };

test("Plan Mode notice keeps its separator and wraps at words without truncating", () => {
    const rows = renderPlanModeWidget(["hello world from Plan Mode"], theme, 15);
    assert.deepEqual(rows, ["───────────────", "hello world", "from Plan Mode"]);
    assert.ok(rows.every((row) => visibleWidth(row) <= 15));
});

test("long tokens fall back to grapheme wrapping and all rows fit", () => {
    const rows = renderPlanModeWidget(["word 👩‍💻👩‍💻👩‍💻 test"], theme, 9);
    assert.ok(rows.every((row) => visibleWidth(row) <= 9));
    assert.equal(
        rows.slice(1).map((row) => row.trim()).join("").replaceAll(" ", ""),
        "word👩‍💻👩‍💻👩‍💻test",
    );
});

test("terminal controls are sanitized; narrow terminals do not overflow", () => {
    assert.equal(sanitizePlanModeWidgetLine("\x1b[31mhi\x1b[0m\u202ee"), "hie");
    for (const width of [0, 1, 2, 3, 4, 5, 8]) {
        const rows = renderPlanModeWidget(["hello world"], theme, width);
        assert.ok(rows.every((row) => visibleWidth(row) <= width), JSON.stringify(rows));
        assert.equal(rows[0], "─".repeat(width));
    }
    const narrowRows = renderPlanModeWidget(["界"], theme, 1);
    assert.equal(narrowRows.at(-1), "?");
    assert.ok(narrowRows.every((row) => visibleWidth(row) <= 1));
    for (const width of [NaN, Infinity, -1]) {
        assert.deepEqual(renderPlanModeWidget(["content"], theme, width), ["", ""]);
    }
    assert.equal(sanitizePlanModeWidgetLine("a\x1b]52;c;hidden\x07b\r\nc"), "ab c");
});
