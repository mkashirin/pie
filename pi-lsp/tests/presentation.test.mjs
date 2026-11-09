import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderResult, renderStatus, renderToolCall } from "../src/presentation.ts";
import { createPacket } from "../src/results.ts";
const theme = { fg: (_color, text) => text };
test("diagnostic severity colors are independent of successful packet status", () => {
    const packet = createPacket("lsp_diagnostics", "severity");
    packet.status = "success";
    packet.routes = [{
        path: "file.ts",
        diagnostics: [1, 2, 3, 4].map((severity) => ({
            severity,
            message: `message${severity}`,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        })),
    }];
    const calls = [];
    renderResult({ details: packet }, {}, {
        fg: (color, text) => {
            calls.push([color, text]);
            return text;
        },
    }).render(120);
    assert.ok(calls.some(([color, text]) => color === "error" && text.includes("message1")));
    assert.ok(calls.some(([color, text]) => color === "warning" && text.includes("message2")));
    assert.ok(calls.some(([color, text]) => color === "muted" && text.includes("message3")));
});
test("root errors and file coverage warnings are visible and sanitized", () => {
    const packet = createPacket("lsp_diagnostics", "errors");
    packet.error = { kind: "configuration", message: "missing\x1b[31m server" };
    packet.routes = [{ files: [{ path: "file.ts", complete: false, warnings: ["quiet server"] }] }];
    const text = renderResult({ details: packet }, { outputPad: 0 }, theme).render(120).join("\n");
    assert.match(text, /configuration: missing server/);
    assert.match(text, /file.ts: incomplete/);
    assert.match(text, /file.ts: Warning: quiet server/);
    assert.ok(!text.includes("\x1b"));
});

test("collapsed twenty diagnostics keeps eight plus totals and write outcome", () => {
    const packet = createPacket("lsp_fix", "collapsed");
    packet.status = "success";
    packet.summary = { diagnostics: 20, errors: 20 };
    packet.fix = { changed: true, written: true };
    packet.warnings = ["coverage warning"];
    packet.routes = [{
        path: "a.ts",
        diagnostics: Array.from(
            { length: 20 },
            (_, i) => ({ severity: 1, message: `diagnostic-${i}` }),
        ),
    }];
    const collapsed = renderResult({ details: packet }, {}, theme).render(200).join("\n");
    const expanded = renderResult({ details: packet }, { expanded: true }, theme).render(200).join(
        "\n",
    );
    assert.notEqual(collapsed, expanded);
    assert.equal((collapsed.match(/: error:/g) ?? []).length, 8);
    assert.equal((expanded.match(/: error:/g) ?? []).length, 20);
    assert.match(collapsed, /diagnostics: 20/);
    assert.match(collapsed, /written=true/);
    assert.match(collapsed, /coverage warning/);
    assert.match(collapsed, /Expand/);
});

test("collapsed diagnostic records flatten multiline messages and bound giant messages", () => {
    const packet = createPacket("lsp_diagnostics", "multiline");
    packet.routes = [{
        diagnostics: Array.from({ length: 20 }, (_, i) => ({
            severity: 1,
            message: `header-${i}\ncontinuation-${i}-end`,
        })),
    }];
    const text = renderResult({ details: packet }, {}, theme).render(300).join("\n");
    assert.equal((text.match(/: error:/g) ?? []).length, 8);
    assert.match(text, /header-0 continuation-0-end/);
    for (let i = 8; i < 20; i++) assert.ok(!text.includes(`continuation-${i}-end`));
    packet.routes[0].diagnostics = [{ severity: 1, message: "x".repeat(60000) }];
    packet.warnings = ["CRITICAL_COVERAGE_WARNING"];
    const rows = renderResult({ details: packet }, {}, theme).render(120);
    assert.ok(rows.length < 15);
    assert.match(rows.join("\n"), /CRITICAL_COVERAGE_WARNING/);
    assert.match(rows.join("\n"), /Expand/);
    const expanded = renderResult({ details: packet }, { expanded: true }, theme).render(120);
    assert.ok(expanded.length > rows.length);
});

test("safe width bounded views including narrow unicode and output padding", () => {
    const packet = createPacket("lsp_fix", "x");
    packet.status = "partial";
    packet.warnings = ["\x1b[31munsafe\x1b[0m\u202e界界"];
    for (
        const view of [
            renderToolCall("lsp_fix", { path: "界界" }, theme),
            renderResult({ details: packet }, { expanded: true, outputPad: 1 }, theme),
            renderStatus("hello\x07\u202e界", {}, theme),
        ]
    ) {
        for (const width of [1, 2, 3, 10, 80]) {
            for (const row of view.render(width)) {
                assert.ok(visibleWidth(row) <= width);
                assert.ok(!/[\x1b\x07\u202e]/u.test(row));
            }
        }
        assert.deepEqual(view.render(0), []);
    }
    assert.match(
        renderResult({ content: [{ type: "text", text: "fallback" }] }, {}, theme).render(80).join(
            "",
        ),
        /fallback/,
    );
});
