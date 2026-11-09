import { getOsc8LinkAtColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import test from "node:test";
import { WebCall, WebStatus, WebView, wrapWebText } from "../src/presentation.ts";

import { attachPage, basePacket } from "../src/results.ts";

const hostEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const { ToolExecutionComponent } = await import(
    new URL("modes/interactive/components/tool-execution.js", hostEntry)
);
const { initTheme, theme: installedTheme } = await import(
    new URL("modes/interactive/theme/theme.js", hostEntry)
);

const plain = { fg: (_color, text) => text, bold: (text) => text };
const strip = stripTerminalSequences;

test("shared wrapping prefers whole words across ANSI boundaries without losing whitespace", () => {
    const expected = ["alpha beta ", "gamma delta"];
    assert.deepEqual(wrapWebText("alpha beta gamma delta", 12), expected);
    const styled = "\x1b[31malpha be\x1b[1mta gamma\x1b[22m delta\x1b[39m";
    assert.deepEqual(wrapWebText(styled, 12).map(strip), expected);
    assert.deepEqual(wrapWebText("界😀 alpha beta", 8), ["界😀 ", "alpha ", "beta"]);
    assert.deepEqual(wrapWebText("e\u0301clair beta", 8), ["e\u0301clair ", "beta"]);
    assert.deepEqual(wrapWebText("alpha\r\nbeta\rgamma", 12), ["alpha", "beta", "gamma"]);
});

test("calls, fallback results and command/status errors share the word-wrapping policy", () => {
    const text = "alpha beta gamma delta";
    assert.deepEqual(new WebCall("alpha beta", "gamma delta", plain).render(12), [
        "alpha beta ",
        "gamma delta",
    ]);
    assert.deepEqual(new WebView(undefined, text, plain, false).render(12), [
        "",
        "alpha beta ",
        "gamma delta",
    ]);
    const status = new WebStatus(text + "\x07\u202e");
    assert.deepEqual(status.render(14), [" alpha beta  ", " gamma delta "]);
    for (const width of [1, 2, 3, 8, 14]) {
        assert.ok(status.render(width).every((line) => visibleWidth(line) <= width));
        assert.equal(
            status.render(width).map((line) => width >= 3 ? line.slice(1, -1) : line).join(""),
            text,
        );
    }
    assert.deepEqual(status.render(0), []);
    assert.deepEqual(status.render(NaN), []);
});

test("status outputPad changes wrapping width without losing evidence whitespace", () => {
    const text = "alpha beta gamma delta";
    assert.deepEqual(new WebStatus(text, 0).render(14), ["alpha beta ", "gamma delta"]);
    assert.deepEqual(new WebStatus(text, 1).render(14), [" alpha beta  ", " gamma delta "]);
    for (const outputPad of [0, 1]) {
        const status = new WebStatus("  alpha beta  界😀  ", outputPad);
        for (const width of [1, 2, 3, 8, 14, 80]) {
            status.invalidate();
            const rows = status.render(width);
            assert.ok(rows.every((line) => visibleWidth(line) <= width));
            const unpadded = rows.map((line) =>
                outputPad === 1 && width >= 3 ? line.slice(1, -1) : line
            ).join("");
            assert.equal(
                unpadded,
                width - (outputPad === 1 && width >= 3 ? 2 : 0) === 1
                    ? "  alpha beta  \\u{754c}\\u{1f600}  "
                    : "  alpha beta  界😀  ",
            );
        }
        assert.deepEqual(status.render(0), []);
        assert.deepEqual(status.render(NaN), []);
    }
});

test("wrapping preserves long answers and URLs, links and one-column Unicode escapes", () => {
    const url = "https://example.com/" + "x".repeat(180);
    const linked = `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`;
    for (const width of [1, 2, 8, 40]) {
        const lines = wrapWebText(linked, width);
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
        assert.equal(strip(lines.join("")), url);
        assert.equal(wrapWebText("answer".repeat(80), width).join(""), "answer".repeat(80));
    }
    assert.equal(wrapWebText("界😀", 1).join(""), "\\u{754c}\\u{1f600}");
    assert.deepEqual(wrapWebText("text", 0), []);
    assert.deepEqual(wrapWebText("text", NaN), []);
});

test("installed theme wrapping retains every evidence space and only explicit empty rows", () => {
    initTheme("dark", false);
    for (
        const [text, width] of [
            ["x".repeat(80) + " " + "y".repeat(81), 80],
            ["alpha beta gamma", 4],
            ["key     value", 4],
            ["   indent  trailing   ", 4],
            ["first\n\n  second  \n", 4],
        ]
    ) {
        const lines = wrapWebText(installedTheme.fg("toolOutput", text), width).map(strip);
        assert.equal(lines.join(""), text.replace(/\n/gu, ""));
        assert.equal(
            lines.filter((line) => line === "").length,
            text.split("\n").filter((line) => line === "").length,
        );
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
        assert.deepEqual(
            new WebView(undefined, text, installedTheme, true).render(width).map(strip),
            ["", ...lines],
        );
    }
    const packet = attachPage(basePacket("web_action", "fixture"), {
        ok: true,
        requestedUrl: "https://example.com/",
        finalUrl: null,
        timestamp: new Date().toISOString(),
        title: null,
        totalLines: 1,
        excerpts: [{ startLine: 1, endLine: 1, text: "key     value" }],
        matches: [],
        no_match: false,
        warnings: [],
        completeness: "complete",
        truncated: false,
        truncation: { wire: false, decoded: false, extracted: false, matches: false },
    });
    const rows = new WebView(packet, "", installedTheme, true).render(4).map(strip);
    assert.ok(rows.join("").includes("key     value"));
    assert.equal(rows.filter((row) => row === "").length, 3); // shell, page and excerpt separators
});

test("styled hyperlinks reopen on wrapped rows without resetting host backgrounds", () => {
    initTheme("dark", false);
    for (const terminator of ["\x07", "\x1b\\"]) {
        const url = "https://example.com/";
        const text = "  alpha beta  gamma  ";
        const styled = installedTheme.fg(
            "accent",
            installedTheme.bold(
                `\x1b[1;4m\x1b]8;id=fixture;${url}${terminator}${text}\x1b]8;;${terminator}\x1b[22;24m`,
            ),
        );
        const rows = wrapWebText(styled, 4);
        assert.equal(rows.map(strip).join(""), text);
        for (const row of rows) {
            assert.ok(visibleWidth(row) > 0 && visibleWidth(row) <= 4);
            assert.equal(getOsc8LinkAtColumn(row, 0), url);
            assert.match(row, /\x1b\[38;2;[0-9;]+m/u);
            assert.match(row, /\x1b\[1;4m/u);
            assert.doesNotMatch(row, /\x1b\[(?:0|49|4[0-8])m/u);
            assert.ok(row.includes(`\x1b]8;;${terminator}`));
        }
    }
});

test("call styles are evaluated on every render without backgrounds or added framing", () => {
    let color = 31;
    const theme = {
        fg: (_role, text) => `\x1b[${color}m${text}\x1b[39m`,
        bold: (text) => `\x1b[1m${text}\x1b[22m`,
    };
    const call = new WebCall("web_action open", "https://example.com/界", theme);
    const first = call.render(80).join("\n");
    assert.match(first, /\x1b\[1mweb_action open/);
    color = 32;
    call.invalidate();
    const next = call.render(80).join("\n");
    assert.match(next, /\x1b\[32m/);
    assert.doesNotMatch(next, /\x1b\[31m/);
    assert.equal(strip(first), strip(next));
    assert.equal(strip(next)[0], "w");
});

test("result rendering re-evaluates theme and preserves sanitized fallback at narrow widths", () => {
    let color = 31;
    const theme = { fg: (_role, text) => `\x1b[${color}m${text}\x1b[39m` };
    const view = new WebView(undefined, "first\x07\u202e\t界😀\nsecond", theme, true);
    const before = view.render(80).join("\n");
    color = 32;
    view.invalidate();
    const after = view.render(80).join("\n");
    assert.equal(strip(before), strip(after));
    assert.match(after, /\x1b\[32m/);
    assert.doesNotMatch(after, /\x1b\[31m|\x1b\[(?:4\d|48)[;m]|[\x07\u202e\t]/u);
    assert.deepEqual(view.render(0), []);
    for (const width of [1, 2, 8]) {
        const lines = view.render(width);
        assert.ok(lines.every((line) => visibleWidth(line) <= width));
        assert.ok(strip(lines.join("")).includes("second"));
    }
});

test("Pi 1.0.0 native tool shell supplies padding and single call/result separator", () => {
    initTheme("dark", false);
    const definition = {
        renderCall: (_args, theme) => new WebCall("web_action open", "https://example.com", theme),
        renderResult: (_result, _options, theme) =>
            new WebView(undefined, "first\nsecond", theme, true),
    };
    const shell = new ToolExecutionComponent("web_action", "fixture", {}, {}, definition, {
        requestRender() {},
    }, process.cwd());
    shell.updateResult({
        content: [{ type: "text", text: "first\nsecond" }],
        details: undefined,
        isError: false,
    }, false);
    const lines = shell.render(60).map(strip);
    const heading = lines.findIndex((line) => line.includes("web_action open"));
    const first = lines.findIndex((line) => line.includes("first"));
    assert.ok(heading > 0);
    assert.equal(first - heading, 2);
    assert.equal(lines[heading + 1].trim(), "");
    assert.ok(lines[first].startsWith(" "));
    assert.equal(
        new WebView(undefined, "long".repeat(50), plain, true).render(10).join(""),
        "long".repeat(50),
    );
});
