import assert from "node:assert/strict";
import { KeybindingsManager, matchesKey, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";

const defaults = new KeybindingsManager(TUI_KEYBINDINGS);
const identityTheme = { fg: (_role, text) => text, bold: (text) => text };
const encodings = {
    up: "\x1b[A",
    down: "\x1b[B",
    left: "\x1b[D",
    right: "\x1b[C",
    enter: "\r",
    escape: "\x1b",
    home: "\x1b[H",
    end: "\x1b[F",
    pageUp: "\x1b[5~",
    pageDown: "\x1b[6~",
    backspace: "\x7f",
    tab: "\t",
    "ctrl+c": "\x03",
    "ctrl+a": "\x01",
    "ctrl+e": "\x05",
    "ctrl+u": "\x15",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A host factory driver, not a terminal emulator. It owns focus and disposes exactly once. */
export function createTuiHarness(options = {}) {
    const terminal = { columns: options.width ?? 80, rows: options.rows ?? 24 };
    const bindings = options.keybindings ?? defaults;
    let component;
    let settled = true;
    let renderRequests = 0;
    let opens = 0;
    let disposals = 0;
    const tui = {
        terminal,
        requestRender() {
            renderRequests++;
        },
    };
    const custom = (factory) => {
        assert.ok(settled, "a prior custom interaction must finish before the next opens");
        settled = false;
        return new Promise((resolve, reject) => {
            let earlyResult;
            let completed = false;
            const done = (result) => {
                if (completed) return;
                completed = true;
                if (!component) {
                    earlyResult = result;
                    return;
                }
                settled = true;
                component.dispose?.();
                disposals++;
                resolve(result);
            };
            const install = (value) => {
                component = value;
                opens++;
                component.focused = true;
                if (completed) {
                    settled = true;
                    component.dispose?.();
                    disposals++;
                    resolve(earlyResult);
                }
            };
            try {
                component = undefined;
                const created = factory(tui, options.theme ?? identityTheme, bindings, done);
                if (created?.then) created.then(install, reject);
                else install(created);
            } catch (error) {
                settled = true;
                reject(error);
            }
        });
    };
    const send = (data) => {
        if (!settled) component?.handleInput?.(data);
    };
    const harness = {
        custom,
        send,
        type(text) {
            for (const char of text) send(char);
        },
        press(key) {
            const literal = key.startsWith("tui.") ? bindings.getKeys(key)[0] : key;
            assert.ok(literal, `no key configured for ${key}`);
            const data = encodings[literal] ?? literal;
            // Literal shortcuts go through the same parser as the host, not action-name tokens.
            if (literal === "ctrl+c") assert.ok(matchesKey(data, "ctrl+c"));
            send(data);
        },
        render() {
            return component?.render(terminal.columns) ?? [];
        },
        resize({ width, rows } = {}) {
            if (width !== undefined) terminal.columns = width;
            if (rows !== undefined) terminal.rows = rows;
            return harness.render();
        },
        invalidate() {
            component?.invalidate();
        },
        // Retained references exercise callbacks delivered after native host disposal.
        get component() {
            return component;
        },
        setFocused(value) {
            if (component) component.focused = value;
        },
        get focused() {
            return component?.focused ?? false;
        },
        get settled() {
            return settled;
        },
        get opens() {
            return opens;
        },
        get disposals() {
            return disposals;
        },
        get renderRequests() {
            return renderRequests;
        },
        async waitForOpen() {
            for (let attempt = 0; attempt < 20; attempt++) {
                await tick();
                if (component && !settled) return;
            }
            assert.fail("custom interaction did not open");
        },
        async waitForPending() {
            for (let attempt = 0; attempt < 6; attempt++) await tick();
        },
    };
    return harness;
}

/** Assert each native dialog request in order, then return the supplied client response. */
export function createRpcHarness(script = []) {
    const remaining = [...script];
    const calls = [];
    const dialog = (kind, title, payload, dialogOptions) => {
        const expected = remaining.shift();
        const actual = { kind, title, ...payload };
        calls.push(actual);
        assert.ok(expected, `unexpected RPC dialog: ${JSON.stringify(actual)}`);
        const { response, ...request } = expected;
        assert.deepEqual(actual, request);
        assert.ok(!dialogOptions?.signal?.aborted, "dialog must not start after abort");
        return Promise.resolve(response);
    };
    return {
        calls,
        ui: {
            select: (title, options, config) => dialog("select", title, { options }, config),
            input: (title, placeholder, config) =>
                dialog(
                    "input",
                    title,
                    { ...(placeholder === undefined ? {} : { placeholder }) },
                    config,
                ),
            editor: (title, prefill) =>
                dialog("editor", title, { ...(prefill === undefined ? {} : { prefill }) }),
            confirm: (title, message, config) => dialog("confirm", title, { message }, config),
            notify() {},
        },
        assertConsumed() {
            assert.equal(remaining.length, 0, "unconsumed RPC dialogs");
        },
    };
}
