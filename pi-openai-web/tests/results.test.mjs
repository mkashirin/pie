import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { createJiti } from "jiti";
import {
    aggregateUsage,
    basePacket,
    capText,
    failPacket,
    STRUCTURED_BYTES,
    TEXT_BYTES,
    toolResult,
} from "../src/results.ts";
import { PacketSchema, PageParams, SearchParams } from "../src/schemas.ts";

const { renderPacket } = await createJiti(import.meta.url).import("../src/presentation.ts");

test("TypeBox real output schema and discriminator validation", () => {
    const result = toolResult(
        failPacket(basePacket("openai_search", "fixture"), "capability", "disabled"),
    );
    assert.equal(Value.Check(PacketSchema, result.structuredContent), true);
    assert.equal(Value.Check(SearchParams, { queries: [] }), false);
    assert.equal(Value.Check(PageParams, { action: "find", url: "https://example.com" }), false);
    for (const action of ["open", "find"]) {
        assert.equal(
            Value.Check(PageParams, {
                action,
                url: "x".repeat(2049),
                ...(action === "find" ? { pattern: "x" } : {}),
            }),
            false,
        );
    }
    const page = failPacket(basePacket("web_action", "page"), "capability", "disabled");
    assert.equal(Value.Check(PacketSchema, page), true);
    assert.equal(Value.Check(PacketSchema, { ...page, tool: "openai_web" }), false); // No alias.
    assert.equal(result.details, result.structuredContent);
    assert.equal(result.isError, true);
});
test("structured hard cap includes protected identities, URL records, JSON controls and markers", () => {
    const huge = "\u0000".repeat(300000);
    for (const kind of ["identity", "metadata", "records", "query", "markers", "page"]) {
        const packet = failPacket(
            basePacket("web_action", kind === "identity" ? huge : "fixture"),
            "transport",
            "fixture",
        );
        if (kind === "metadata") {
            packet.request.url = huge;
            packet.warnings = [huge];
        }
        if (kind === "records") {
            packet.evidence = [{ id: huge, queryId: huge, kind: "source", url: huge }];
        }
        if (kind === "query") {
            packet.results = [{
                id: huge,
                query: "fixture",
                model: { provider: "openai", api: "openai-responses", id: huge },
                responseId: huge,
                freshness: "live",
                searchContextSize: "medium",
                startedAt: 1,
                finishedAt: 2,
                ok: true,
                status: "success",
                answerSegments: [],
                citations: [],
                actions: [],
                sources: [],
                warnings: [],
                truncation: { answer: false, evidence: false, answerBytes: 0, answerLines: 0 },
            }];
        }
        if (kind === "page") {
            packet.page = {
                ok: false,
                requestedUrl: huge,
                finalUrl: huge,
                timestamp: new Date().toISOString(),
                title: null,
                totalLines: 0,
                excerpts: [],
                matches: [],
                no_match: false,
                warnings: [],
                completeness: "none",
                truncated: false,
                truncation: { wire: false, decoded: false, extracted: false, matches: false },
            };
        }
        if (kind === "markers") {
            packet.truncation.omissions = Array.from({ length: 1000 }, () => huge.slice(0, 1000));
        }
        const output = toolResult(packet);
        assert.equal(Value.Check(PacketSchema, output.details), true, kind);
        assert.equal(output.details, output.structuredContent);
        assert.ok(Buffer.byteLength(JSON.stringify(output.details)) <= STRUCTURED_BYTES, kind);
        assert.ok(Buffer.byteLength(output.content[0].text) <= TEXT_BYTES, kind);
        assert.equal(output.details.truncation.structured, true, kind);
        assert.ok(output.details.truncation.omissions.length > 0, kind);
        if (kind === "records") {
            assert.match(output.details.truncation.omissions.join(" "), /1 identity\/URL records/);
        }
    }
    const packet = basePacket("web_action", "fixture");
    packet.status = "success";
    packet.evidence = [{
        id: "valid",
        queryId: "query",
        kind: "source",
        url: "https://example.com/",
    }];
    packet.page = {
        ok: true,
        requestedUrl: "https://example.com/",
        finalUrl: "https://example.com/",
        timestamp: new Date().toISOString(),
        title: null,
        totalLines: 1,
        excerpts: [{ startLine: 1, endLine: 1, text: "a".repeat(300000) }],
        matches: [],
        no_match: false,
        warnings: [],
        completeness: "complete",
        truncated: false,
        truncation: { wire: false, decoded: false, extracted: false, matches: false },
    };
    const output = toolResult(packet);
    assert.deepEqual(output.details.evidence, packet.evidence);
    assert.equal(output.details.page.finalUrl, packet.page.finalUrl);
    assert.equal(output.details.page.truncation.extracted, true);
    assert.match(output.details.truncation.omissions.join(" "), /excerpts/);
    assert.equal(Value.Check(PacketSchema, output.details), true);
    assert.ok(Buffer.byteLength(JSON.stringify(output.details)) <= STRUCTURED_BYTES);
    const boundary = failPacket(basePacket("web_action", "boundary"), "transport", "fixture");
    boundary.warnings = [""];
    boundary.warnings[0] = "x".repeat(
        STRUCTURED_BYTES - 10 - Buffer.byteLength(JSON.stringify(boundary)),
    );
    assert.ok(Buffer.byteLength(JSON.stringify(boundary)) <= STRUCTURED_BYTES);
    const capped = toolResult(boundary);
    assert.equal(capped.details.truncation.text, true);
    assert.equal(capped.details.truncation.structured, true);
    assert.equal(Value.Check(PacketSchema, capped.details), true);
    assert.ok(Buffer.byteLength(JSON.stringify(capped.details)) <= STRUCTURED_BYTES);
    assert.match(capped.details.truncation.omissions.join(" "), /model-facing text/);
});

test("hard text cap, reported usage only, noninteractive sanitized renderer", () => {
    const text = capText("😀".repeat(50000));
    assert.ok(Buffer.byteLength(text.text) <= TEXT_BYTES);
    assert.match(text.text, /omitted/);
    const usage = {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        totalTokens: 10,
        cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
    };
    assert.equal(aggregateUsage([{ usage }, {}, { usage }]).totalTokens, 20);
    const packet = failPacket(basePacket("web_action", "fixture"), "transport", "bad\x1b[31m\x07");
    const result = toolResult(packet);
    assert.ok(Buffer.byteLength(JSON.stringify(result.structuredContent)) <= STRUCTURED_BYTES);
    const view = renderPacket(packet, "", { fg: (_color, text) => text }, true);
    assert.ok(view.render(30).every((line) => !/[\x1b\x07]/u.test(line)));
    assert.deepEqual(view.render(0), []);
});
