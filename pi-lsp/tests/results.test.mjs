import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Value } from "typebox/value";
import {
    createPacket,
    DiagnosticParams,
    finalizeResult,
    FixParams,
    PacketSchema,
    STRUCTURED_BYTES,
    TEXT_BYTES,
} from "../src/results.ts";

test("typed errors retain required fields after hundreds of preceding metadata keys", async () => {
    const error = Object.fromEntries(
        Array.from({ length: 301 }, (_, i) => [`metadata${i}`, "x".repeat(1000)]),
    );
    error.kind = "RequiredError";
    error.message = "required message";
    const packet = createPacket("lsp_diagnostics", "ordered-errors");
    packet.error = error;
    packet.routes = [{ error, files: [{ path: "a.ts", error }] }];
    assert.ok(Value.Check(PacketSchema, packet));
    const result = await finalizeResult(packet);
    try {
        assert.ok(Value.Check(PacketSchema, result.details));
        assert.deepEqual(result.details.error, { kind: error.kind, message: error.message });
        assert.deepEqual(result.details.routes[0].error, result.details.error);
        // File coverage is deliberately omitted during structured compaction; the
        // lossless report must still retain its schema-valid typed file error.
        const full = JSON.parse(await readFile(result.details.artifacts[0].path, "utf8"));
        assert.ok(Value.Check(PacketSchema, full));
        assert.equal(full.routes[0].files[0].error.message, error.message);
    } finally {
        for (const artifact of result.details.artifacts ?? []) {
            await rm(dirname(artifact.path), { recursive: true, force: true });
        }
    }
});

test("schemas and result contract", async () => {
    assert.ok(Value.Check(DiagnosticParams, { paths: ["src"], server: ["ts"] }));
    assert.ok(!Value.Check(DiagnosticParams, { limit: 0 }));
    assert.ok(!Value.Check(DiagnosticParams, { limit: 1001 }));
    assert.ok(!Value.Check(DiagnosticParams, { paths: ["  "] }));
    assert.ok(!Value.Check(FixParams, { path: "file.ts", server: ["ts"] }));
    assert.ok(!Value.Check(FixParams, { path: "file.ts", kind: "  " }));
    assert.ok(!Value.Check(FixParams, { write: true }));
    for (const status of ["running", "success", "partial", "failure", "cancelled"]) {
        const packet = createPacket("lsp_diagnostics", "test");
        packet.status = status;
        const result = await finalizeResult(packet);
        assert.ok(Value.Check(PacketSchema, result.details));
        assert.equal(result.details, result.structuredContent);
        assert.equal(result.isError, ["partial", "failure", "cancelled"].includes(status));
    }
});
test("huge metadata preserves committed success and actionable artifact path", async () => {
    const packet = createPacket("lsp_fix", "id".repeat(200000));
    packet.status = "success";
    packet.summary = { changed: 1, written: 1 };
    packet.fix = {
        changed: true,
        written: true,
        actions: Array.from(
            { length: 1000 },
            () => ({ title: "huge".repeat(1000), changed: true, written: true }),
        ),
    };
    packet.warnings = ["warning\n".repeat(20000)];
    packet.routes = [{ complete: false, error: { kind: "server", message: "m".repeat(300000) } }];
    const result = await finalizeResult(packet);
    const artifact = result.details.artifacts[0];
    try {
        assert.equal(result.details.status, "success");
        assert.equal(result.isError, false);
        assert.equal(result.details.fix.changed, true);
        assert.equal(result.details.fix.written, true);
        assert.equal(result.details.routes[0].complete, false);
        assert.deepEqual(result.details.summary, packet.summary);
        assert.ok(Buffer.byteLength(JSON.stringify(result.details)) <= STRUCTURED_BYTES);
        assert.ok(Buffer.byteLength(result.content[0].text) <= TEXT_BYTES);
        assert.ok(result.content[0].text.split("\n").length <= 2000);
        assert.ok(result.content[0].text.includes(artifact.path));
        assert.deepEqual(JSON.parse(await readFile(artifact.path, "utf8")), packet);
    } finally {
        await rm(dirname(artifact.path), { recursive: true });
    }
});

test("human diagnostics use one-based locations; exact ranges remain structured", async () => {
    const packet = createPacket("lsp_diagnostics", "locations");
    packet.routes = [{
        path: "src/a.ts",
        diagnostics: [{
            severity: 1,
            message: "Use a number",
            range: { start: { line: 2, character: 3 }, end: { line: 2, character: 9 } },
        }],
    }];
    const result = await finalizeResult(packet);
    assert.match(result.content[0].text, /src\/a.ts:3:4: error: Use a number/);
    assert.deepEqual(result.details.routes, packet.routes);
});

test("preview text and root errors are visible", async () => {
    const packet = createPacket("lsp_fix", "preview");
    packet.error = { kind: "configuration", message: "missing command" };
    packet.fix = { changed: true, written: false, preview: "-before\n+after" };
    packet.routes = [{ files: [{ path: "a.ts", warnings: ["coverage uncertain"] }] }];
    const result = await finalizeResult(packet);
    assert.ok(Value.Check(PacketSchema, result.details));
    assert.match(result.content[0].text, /Preview:\n-before\n\+after/);
    assert.match(result.content[0].text, /configuration: missing command/);
    assert.match(result.content[0].text, /a.ts: Warning: coverage uncertain/);
});

test("huge summaries and file coverage remain bounded with explicit omissions", async () => {
    const packet = createPacket("lsp_fix", "summary");
    packet.status = "success";
    packet.summary = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [
        `${i}${"界".repeat(1000)}`,
        i,
    ]));
    packet.fix = { changed: true, written: true };
    packet.routes = Array.from({ length: 100 }, () => ({
        complete: false,
        files: Array.from({ length: 100 }, () => ({ complete: false, error: "bad" })),
    }));
    const result = await finalizeResult(packet);
    const artifact = result.details.artifacts[0];
    try {
        assert.ok(Buffer.byteLength(JSON.stringify(result.details)) <= STRUCTURED_BYTES);
        assert.equal(result.details.fix.written, true);
        assert.equal(result.details.status, "success");
        assert.match(
            result.details.truncation.omissions.join(" "),
            /coverage.*summary entries=1000/,
        );
        assert.ok(Value.Check(PacketSchema, result.details));
        assert.deepEqual(JSON.parse(await readFile(artifact.path, "utf8")), packet);
    } finally {
        await rm(dirname(artifact.path), { recursive: true });
    }
});

test("reviewer boundary: 262044 bytes before artifact metadata", async () => {
    const packet = createPacket("lsp_diagnostics", "boundary");
    packet.warnings = [""];
    packet.warnings[0] = "x".repeat(262044 - Buffer.byteLength(JSON.stringify(packet)));
    assert.equal(Buffer.byteLength(JSON.stringify(packet)), 262044);
    const result = await finalizeResult(packet);
    try {
        assert.ok(Buffer.byteLength(JSON.stringify(result.details)) <= STRUCTURED_BYTES);
        assert.equal(result.details.truncation.structured, true);
        assert.match(result.details.warnings.join(" "), /Coverage/);
        assert.ok(result.content[0].text.includes(result.details.artifacts[0].path));
    } finally {
        await rm(dirname(result.details.artifacts[0].path), { recursive: true });
    }
});

test("unknown 300k root field rejected by schema and bounded by finalizer", async () => {
    const packet = {
        ...createPacket("lsp_fix", "extra"),
        extra: "x".repeat(300000),
        fix: { changed: true, written: true },
    };
    assert.equal(Value.Check(PacketSchema, packet), false);
    const result = await finalizeResult(packet);
    try {
        assert.ok(Value.Check(PacketSchema, result.details));
        assert.ok(Buffer.byteLength(JSON.stringify(result.details)) <= STRUCTURED_BYTES);
        assert.equal(result.details.fix.written, true);
        assert.equal(result.details.truncation.structured, true);
        assert.equal("extra" in result.details, false);
    } finally {
        await rm(dirname(result.details.artifacts[0].path), { recursive: true });
    }
});

test("invalid TMPDIR never rejects already committed outcome", () => {
    const child = spawnSync(process.execPath, [
        "--input-type=module",
        "-e",
        `
        import { createPacket, finalizeResult } from './src/results.ts';
        const p = createPacket('lsp_fix', 'committed');
        p.status = 'success'; p.fix = { changed: true, written: true, preview: 'x'.repeat(60000) };
        const r = await finalizeResult(p); console.log(JSON.stringify(r));
    `,
    ], {
        cwd: new URL("..", import.meta.url),
        env: {
            ...process.env,
            TMPDIR: "/nonexistent/pi-lsp-reviewer-missing",
            TMP: "/nonexistent/pi-lsp-reviewer-missing",
            TEMP: "/nonexistent/pi-lsp-reviewer-missing",
        },
        encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    const r = JSON.parse(child.stdout);
    assert.equal(r.details.status, "success");
    assert.deepEqual([r.details.fix.changed, r.details.fix.written], [true, true]);
    assert.equal(r.details.artifactError.kind, "ArtifactError");
    assert.equal(r.details.artifacts, undefined);
    assert.match(r.content[0].text, /no artifact available/);
    assert.ok(Value.Check(PacketSchema, r.details));
});

test("deep metadata cannot erase write outcome or overflow bounded output", async () => {
    const packet = createPacket("lsp_fix", "deep");
    packet.status = "success";
    let metadata = {};
    for (let i = 0; i < 20000; i++) metadata = { next: metadata };
    packet.fix = { metadata, changed: true, written: true };
    const result = await finalizeResult(packet);
    assert.ok(Buffer.byteLength(JSON.stringify(result.details)) <= STRUCTURED_BYTES);
    assert.ok(Value.Check(PacketSchema, result.details));
    assert.equal(result.details.fix.written, true);
    assert.equal(result.details.fix.changed, true);
    assert.equal(result.details.status, "success");
    assert.equal(result.details.truncation.structured, true);
    assert.equal(result.details.artifactError.kind, "ArtifactError");
});

test("bounded views and private lossless artifact", async () => {
    const packet = createPacket("lsp_fix", "large");
    packet.status = "partial";
    packet.summary = { errors: 3, written: 1 };
    packet.routes = [{
        complete: false,
        errors: ["failure"],
        diagnostics: [{ message: "界\n".repeat(100000) }],
    }];
    packet.fix = { written: true, preview: "x".repeat(300000) };
    const result = await finalizeResult(packet);
    const artifact = result.details.artifacts[0];
    try {
        assert.ok(Buffer.byteLength(result.content[0].text) <= TEXT_BYTES);
        assert.ok(result.content[0].text.split("\n").length <= 2000);
        assert.ok(Buffer.byteLength(JSON.stringify(result.details)) <= STRUCTURED_BYTES);
        assert.deepEqual(result.details.summary, packet.summary);
        assert.equal(result.details.fix.written, true);
        assert.equal(result.details.routes[0].complete, false);
        assert.deepEqual(JSON.parse(await readFile(artifact.path, "utf8")), packet);
        assert.equal((await stat(artifact.path)).mode & 0o777, 0o600);
        assert.ok(Value.Check(PacketSchema, result.details));
    } finally {
        await rm(dirname(artifact.path), { recursive: true });
    }
});
