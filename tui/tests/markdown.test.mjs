import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { Markdown, ThemedMarkdown, visibleWidth } = await jiti.import("../src/index.ts");
const { initTheme, getMarkdownTheme } = await jiti.import("@earendil-works/pi-coding-agent");
initTheme("dark");

function observeHost(t) {
    const calls = [];
    const render = Markdown.prototype.render;
    t.mock.method(Markdown.prototype, "render", function(width) {
        calls.push({ host: this, width });
        return render.call(this, width);
    });
    return calls;
}

const code = "```ts\nexport const step = (value: string): string => value.trim();\n```";

test("Markdown retains host and final-row caches across repeats, resizing and text changes", (t) => {
    const calls = observeHost(t);
    let source = code;
    let texts = 0;
    let themes = 0;
    let highlights = 0;
    const component = new ThemedMarkdown(() => {
        texts++;
        return source;
    }, () => {
        themes++;
        return {
            ...getMarkdownTheme(),
            highlightCode: (text) => {
                highlights++;
                return text.split("\n");
            },
        };
    });
    const first = component.render(80);
    assert.strictEqual(component.render(80.9), first);
    assert.equal(calls.length, 1, "same normalized width bypasses host and final wrapping");
    assert.equal(texts, 2, "text is checked even when final rows are cached");
    const narrow = component.render(30);
    assert.strictEqual(component.render(30), narrow);
    assert.ok(narrow.every((row) => visibleWidth(row) <= 30));
    component.render(80);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(({ host }) => host === calls[0].host));
    assert.equal(highlights, 1, "host highlighting survives resize");
    assert.equal(themes, 1, "freshly allocated theme objects are not polled on cache hits");

    source = "replacement **visible**\x1b]52;c;hidden\x07\u202e";
    const changed = component.render(80);
    assert.match(changed.map(plain).join("\n"), /replacement visible/u);
    assert.ok(!changed.join("").includes("hidden"));
    assert.strictEqual(calls.at(-1).host, calls[0].host, "text updates reuse the host");
    assert.strictEqual(component.render(80), changed);
    assert.equal(themes, 1);
    source = "";
    assert.deepEqual(component.render(80), []);
});

test("Markdown invalidation lazily refreshes active theme, style and highlighting", (t) => {
    const calls = observeHost(t);
    let active = "first";
    let themes = 0;
    let styles = 0;
    let highlights = 0;
    const component = new ThemedMarkdown(() => `# Heading\n\nbody\n\n${code}`, () => {
        themes++;
        const label = active;
        return {
            ...getMarkdownTheme(),
            heading: (text) => `${label}:${text}`,
            highlightCode: (text) => {
                highlights++;
                return text.split("\n");
            },
        };
    }, () => {
        styles++;
        const color = active === "first" ? "31" : "32";
        return { color: (text) => `\x1b[${color}m${text}\x1b[39m` };
    });
    const first = component.render(80);
    assert.match(first.map(plain).join("\n"), /first:Heading/u);
    assert.ok(first.join("").includes("\x1b[31m"));
    active = "second";
    assert.strictEqual(component.render(80), first);
    component.invalidate();
    component.invalidate();
    for (const width of [NaN, Infinity, -Infinity, -1, 0, 0.9]) {
        assert.deepEqual(component.render(width), []);
    }
    assert.equal(themes, 1, "invalid widths must not consume pending theme refresh");
    assert.equal(styles, 1);
    const second = component.render(80);
    assert.match(second.map(plain).join("\n"), /second:Heading/u);
    assert.ok(second.join("").includes("\x1b[32m"));
    assert.notStrictEqual(calls.at(-1).host, calls[0].host);
    assert.equal(themes, 2);
    assert.equal(styles, 2);
    assert.equal(highlights, 2);
    assert.strictEqual(component.render(80), second);
});

test("Markdown checks dynamic text on every render while preserving display and width safety", () => {
    let source = "old";
    let texts = 0;
    let themes = 0;
    const component = new ThemedMarkdown(() => {
        texts++;
        return source;
    }, () => {
        themes++;
        return getMarkdownTheme();
    });
    for (const width of [NaN, Infinity, -Infinity, -2, 0, 0.5]) {
        assert.deepEqual(component.render(width), []);
    }
    assert.equal(texts, 6);
    assert.equal(themes, 0);
    component.render(40);
    source = "界e\u0301👩‍💻\tcell\r\nnext\x1b[2J\x1b]52;c;secret\x07\x1bPprivate\x1b\\\u202e\x00";
    component.render(0);
    for (const width of [1, 2, 3.9, 8, 40, 1]) {
        const rows = component.render(width);
        assert.ok(rows.every((row) => visibleWidth(row) <= Math.floor(width)));
        assert.ok(!rows.join("").includes("secret"));
        assert.ok(!rows.join("").includes("private"));
        assert.ok(!/[\u202e\x00\t\r]/u.test(rows.join("")));
        assert.strictEqual(component.render(width), rows);
    }
    assert.match(component.render(40).map(plain).join("\n"), /next/u);
    assert.equal(themes, 1);
});
