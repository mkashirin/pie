import assert from "node:assert/strict";
import { test } from "node:test";
import { findRegex, initializeRegex } from "../src/regex.ts";
import { createClipboard, runClipboard } from "../src/clipboard.ts";

test("Rust regex uses Unicode byte-to-UTF16 ranges and inline flags", async () => {
    await initializeRegex();
    assert.deepEqual(findRegex("😀é A\na", "(?im)^a"), [{ start: 6, end: 7 }]);
    assert.deepEqual(findRegex("😀éβ", "\\p{L}+"), [{ start: 2, end: 4 }]);
    assert.deepEqual(findRegex("A a", "(?i)a"), [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
});

test("empty matches terminate on scalar boundaries, invalid patterns throw", () => {
    assert.deepEqual(findRegex("😀é", ""), [{ start: 0, end: 0 }, { start: 2, end: 2 }, {
        start: 3,
        end: 3,
    }]);
    assert.deepEqual(findRegex("", ""), [{ start: 0, end: 0 }]);
    assert.throws(() => findRegex("text", "["));
    assert.throws(() => findRegex("text", "(?=t)"));
    assert.deepEqual(findRegex("ok", "ok"), [{ start: 0, end: 2 }]);
});

function fake(platform, env = {}) {
    const calls = [];
    return {
        calls,
        clipboard: createClipboard({
            platform,
            env,
            runner: async (...args) => {
                calls.push(args);
                return "hello\r\nworld\n";
            },
        }),
    };
}

test("mac clipboard preserves trailing newlines and normalizes CRLF", async () => {
    const { calls, clipboard } = fake("darwin");
    assert.equal(await clipboard.read(), "hello\nworld\n");
    await clipboard.write("quote '$()\r\n");
    assert.deepEqual(calls, [["pbpaste", [], undefined], ["pbcopy", [], "quote '$()\n"]]);
    await assert.rejects(clipboard.read("primary"), /Primary/);
});

test("Linux Wayland and X11 support primary selections", async () => {
    const wayland = fake("linux", { WAYLAND_DISPLAY: "wayland-0" });
    await wayland.clipboard.read("primary");
    await wayland.clipboard.write("x", "primary");
    assert.deepEqual(wayland.calls, [["wl-paste", ["--no-newline", "--primary"], undefined], [
        "wl-copy",
        ["--primary"],
        "x",
    ]]);
    const x11 = fake("linux", { DISPLAY: ":0" });
    await x11.clipboard.read();
    await x11.clipboard.write("x", "primary");
    assert.deepEqual(x11.calls, [["xclip", ["-selection", "clipboard", "-out"], undefined], [
        "xclip",
        ["-selection", "primary", "-in"],
        "x",
    ]]);
    await assert.rejects(fake("linux").clipboard.read(), /display/);
});

test("Windows sends arbitrary text through stdin, not PowerShell source", async () => {
    const { clipboard, calls } = fake("win32");
    const text = "'; $(evil) 😀\n";
    await clipboard.write(text);
    await clipboard.read();
    assert.equal(calls[0][0], "powershell.exe");
    assert.equal(calls[0][2], text);
    assert.ok(!calls[0][1].join(" ").includes(text));
    assert.match(calls[0][1].at(-1), /ReadToEnd/);
    assert.match(calls[1][1].at(-1), /Get-Clipboard -Raw/);
    await assert.rejects(clipboard.write("x", "primary"), /Primary/);
});

test("clipboard errors propagate and subprocess failures and timeout reject", async () => {
    const clipboard = createClipboard({
        platform: "darwin",
        runner: async () => {
            throw new Error("unavailable");
        },
    });
    await assert.rejects(clipboard.read(), /unavailable/);
    await assert.rejects(clipboard.write("x"), /unavailable/);
    await assert.rejects(runClipboard(process.execPath, ["-e", "process.exit(7)"]), /failed/);
    await assert.rejects(runClipboard("pi-hem-nonexistent-command", []), /ENOENT/);
    await assert.rejects(
        runClipboard(process.execPath, ["-e", "setInterval(() => {}, 1000)"]),
        /timed out/,
    );
});
