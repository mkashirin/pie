import { visibleWidth } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { WebView } from "../src/presentation.ts";
import { attachPage, attachSearch, basePacket, toolResult } from "../src/results.ts";
import { PacketSchema } from "../src/schemas.ts";

const theme = { fg: (_color, text) => text };

function searchPacket() {
    const packet = basePacket("openai_search", "fixture");
    packet.request.queries = ["Unicode 界😀 query"];
    return attachSearch(packet, [{
        ok: true,
        status: "success",
        query: packet.request.queries[0],
        model: { provider: "openai", api: "openai-responses", id: "fixture" },
        freshness: "live",
        searchContextSize: "medium",
        startedAt: 1,
        finishedAt: 2,
        answerSegments: [{
            origin: { outputIndex: 0, contentIndex: 0 },
            text: "Answer 界😀\x07\u202e",
            complete: false,
            truncated: true,
            provenance: "provider",
        }],
        citations: [],
        actions: [],
        sources: [{ type: "url", url: "https://example.com/界", actionId: "call", outputIndex: 1 }],
        warnings: ["Native metadata omitted\x07"],
        truncation: { answer: true, evidence: true, answerBytes: 12, answerLines: 1 },
    }]);
}

test("expanded structured search renders per-query warnings, native flags, IDs, URLs and unknown costs", () => {
    const packet = searchPacket();
    // Exercise native flags independently of outer output flags/warnings.
    packet.warnings = [];
    assert.equal(packet.truncation.text, false);
    assert.equal(packet.truncation.structured, false);
    const output = toolResult(packet);
    assert.equal(Value.Check(PacketSchema, output.details), true);
    const view = new WebView(output.details, "", theme, true);
    const rendered = view.render(200).join("\n");
    assert.ok(rendered.includes(`[${packet.results[0].id}]`));
    assert.ok(rendered.includes(`[${packet.evidence[0].id}]`));
    assert.match(rendered, /https:\/\/example.com\/界/);
    for (
        const warning of [
            "Native metadata omitted",
            "Answer truncated",
            "Answer incomplete",
            "Evidence truncated",
            "No URL citations",
            "Usage unknown",
            "native search fees unknown",
        ]
    ) {
        assert.ok(rendered.includes(warning), warning);
    }
    assert.doesNotMatch(rendered, /[\x07\u202e]/u);
    assert.equal(output.details.results[0].answerSegments[0].text, "Answer 界😀\x07\u202e");
    for (const width of [1, 8, 20, 40]) {
        assert.ok(view.render(width).every((line) => visibleWidth(line) <= width));
    }
    const collapsed = new WebView(packet, "", theme, false).render(200).join("\n");
    assert.match(collapsed, /Warning:.*Answer truncated/);
    assert.match(collapsed, /Evidence truncated/);
});

function pagePacket(overrides = {}) {
    const packet = basePacket("web_action", "fixture");
    packet.request.action = "find";
    return attachPage(packet, {
        ok: true,
        requestedUrl: "https://example.com/",
        finalUrl: "https://example.com/",
        timestamp: new Date().toISOString(),
        title: "Page 界😀",
        totalLines: 1,
        excerpts: [{ startLine: 1, endLine: 1, text: "Page text\x07" }],
        matches: [],
        no_match: false,
        warnings: [],
        completeness: "complete",
        truncated: false,
        truncation: { wire: false, decoded: false, extracted: false, matches: false },
        ...overrides,
    });
}

test("page success counter uses page.ok; incomplete/no-match/native flags disclose in both modes", () => {
    const colors = [];
    const colored = {
        fg: (color, text) => {
            colors.push([color, text]);
            return text;
        },
    };
    const success = new WebView(pagePacket(), "", colored, false).render(100).join("\n");
    assert.match(success, /success \(1\/1\)/);
    assert.ok(colors.some(([color, text]) => color === "success" && text.includes("1/1")));
    const packet = pagePacket({
        no_match: true,
        completeness: "partial",
        truncation: { wire: false, decoded: false, extracted: true, matches: false },
    });
    packet.status = "success";
    packet.warnings = [];
    for (const expanded of [true, false]) {
        colors.length = 0;
        const rendered = new WebView(packet, "", colored, expanded).render(200).join("\n");
        assert.match(rendered, /Page evidence truncated/);
        assert.match(rendered, /Page incomplete/);
        assert.match(rendered, /absence is not conclusive/);
        assert.ok(
            !colors.some(([color, text]) => color === "success" && text.includes("web_action")),
        );
    }
    const completeNoMatch = new WebView(pagePacket({ no_match: true }), "", theme, false).render(
        200,
    ).join("\n");
    assert.match(completeNoMatch, /No literal match in extracted text/);
});

test("packet output flags disclose without query warnings; unsafe URLs render inertly", () => {
    const packet = pagePacket();
    packet.truncation.text = true;
    packet.truncation.structured = true;
    packet.truncation.omissions = ["fixture omission"];
    packet.page.finalUrl = "https://example.com/\x1b]8;;evil\x07";
    const expanded = new WebView(packet, "", theme, true).render(200).join("\n");
    assert.match(expanded, /Output truncated/);
    assert.match(expanded, /omitted: fixture omission/);
    assert.doesNotMatch(expanded, /[\x1b\x07]/u);
    const collapsed = new WebView(packet, "", theme, false).render(200).join("\n");
    assert.match(collapsed, /Warning:.*Partial\/truncated output/);
    assert.match(collapsed, /Evidence omitted/);
});

test("collapsed warnings render separately, consolidate fee variants and preserve sentence punctuation", () => {
    const packet = searchPacket();
    const fee =
        "Native web-search tool fees are unknown; reported usage covers Pi token costs only.";
    const inspection = "Citations and consulted sources do not prove full-page inspection.";
    const retrieval =
        "Native retrieval completed in response.output_item.done; terminal output did not repeat the action.";
    packet.warnings = [
        "Native web-search fees are unknown and are not included in Pi token/cost totals.",
        inspection,
    ];
    packet.results[0].warnings = [inspection, fee, retrieval];
    const before = structuredClone(packet);
    const rendered = new WebView(packet, "", theme, false).render(240);
    const warnings = rendered.filter((line) => line.startsWith("Warning: "));
    assert.deepEqual(warnings.slice(0, 3), [
        `Warning: ${fee}`,
        `Warning: ${inspection}`,
        `Warning: ${retrieval}`,
    ]);
    assert.equal(warnings.filter((line) => line.includes("fees are unknown")).length, 1);
    assert.equal(warnings.filter((line) => line.includes(inspection)).length, 1);
    assert.doesNotMatch(rendered.join("\n"), /\.;/u);
    assert.ok(warnings.includes("Warning: Answer truncated"));
    assert.deepEqual(packet, before);
    const view = new WebView(packet, "", theme, false);
    for (const width of [1, 8, 40]) {
        assert.ok(view.render(width).every((line) => visibleWidth(line) <= width));
    }
});

test("expanded evidence and collapsed warnings use word boundaries and do not mutate packets", () => {
    const text = "alpha beta gamma delta";
    const page = pagePacket({
        title: text,
        excerpts: [{ startLine: 1, endLine: 1, text }],
        matches: [{ line: 1, column: 1, text }],
    });
    const search = searchPacket();
    search.results[0].query = text;
    search.results[0].answerSegments[0].text = text;
    search.results[0].warnings = [text];
    for (const packet of [page, search]) {
        packet.warnings = [text];
        const before = structuredClone(packet);
        const expanded = new WebView(packet, "", theme, true).render(12);
        assert.ok(expanded.includes("alpha beta "));
        assert.ok(expanded.includes("gamma delta"));
        const collapsed = new WebView(packet, "", theme, false).render(12);
        assert.ok(collapsed.includes("Warning: "));
        assert.ok(collapsed.includes("alpha beta "));
        assert.ok([...expanded, ...collapsed].every((line) => visibleWidth(line) <= 12));
        assert.deepEqual(packet, before);
    }
});

test("fallback controls and Unicode width are sanitized without requiring UI", () => {
    const view = new WebView(undefined, "界😀\x1b[31m\x07\u2066\nnext\tline", theme, false);
    for (const width of [1, 2, 8]) {
        assert.ok(view.render(width).every((line) => visibleWidth(line) <= width));
        // TUI truncation adds trusted ANSI resets; provider escape sequences stay stripped.
        assert.doesNotMatch(
            view.render(width).join("\n").replace(/\x1b\[0m/gu, ""),
            /[\x1b\x07\u2066]/u,
        );
    }
    assert.deepEqual(view.render(0), []);
});
