import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { createPacket } from "../src/results.ts";

const jiti = createJiti(import.meta.url);
const { visibleWidth } = await jiti.import("@pi-extensions/pi-kit");
const { renderResult, renderStatus, renderToolCall } = await jiti.import("../src/presentation.ts");
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

test("LSP hard wrapping preserves multiline whitespace, padding and oversized cells", () => {
    for (const outputPad of [0, 1]) {
        const view = renderStatus("ab cd\r\n\t界e\u0301\n", { outputPad }, theme);
        const width = outputPad === 1 ? 5 : 3;
        const expected = ["ab ", "cd", "   ", " 界", "e\u0301", ""];
        assert.deepEqual(view.render(width), expected.map((row) => outputPad ? ` ${row} ` : row));
        assert.deepEqual(view.render(width + 0.9), view.render(width));
        for (const invalid of [NaN, Infinity, -1, 0, 0.5]) {
            assert.deepEqual(view.render(invalid), []);
        }
    }
    assert.deepEqual(renderStatus("界😀", { outputPad: 0 }, theme).render(1), ["?", "?"]);
});

test("LSP sanitizes terminal strings before row styling and re-evaluates the active theme", () => {
    let prefix = "first";
    const styled = { fg: (role, text) => `${prefix}:${role}:${text}` };
    const view = renderStatus("Warning: a\x1b]52;c;hidden\ntext\x07b", { outputPad: 0 }, styled);
    assert.deepEqual(view.render(80), ["first:warning:Warning: ab"]);
    prefix = "next";
    view.invalidate();
    assert.deepEqual(view.render(80), ["next:warning:Warning: ab"]);
    for (const text of ["a\x1bPsecret\x1b\\b", "a\u009dsecret\u009cb"]) {
        assert.deepEqual(renderStatus(text, { outputPad: 0 }, theme).render(80), ["ab"]);
    }
    assert.deepEqual(renderStatus("a\x1b]unterminated", { outputPad: 0 }, theme).render(80), ["a"]);
});

test("truncation and artifacts remain visible without changing diagnostic packets", () => {
    const packet = createPacket("lsp_diagnostics", "artifact");
    packet.status = "partial";
    packet.truncation.text = true;
    packet.artifacts = [{ kind: "report", path: "/tmp/report.txt", bytes: 100 }];
    const before = structuredClone(packet);
    for (const expanded of [false, true]) {
        const text = renderResult({ details: packet }, { expanded }, theme).render(200).join("\n");
        assert.match(text, /Output truncated; see artifacts/);
        assert.match(text, /Artifact: \/tmp\/report.txt/);
        assert.deepEqual(packet, before);
    }
    packet.artifacts = [];
    assert.match(
        renderResult({ details: packet }, {}, theme).render(200).join("\n"),
        /Output truncated; no artifact available/,
    );
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
