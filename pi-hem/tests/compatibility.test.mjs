import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    bindings,
    implementedActions,
    resolveBinding,
    runtimeContextPrefixes,
} from "../src/compatibility.ts";
import { HelixBuffer } from "../src/model.ts";
import { CommandController } from "../src/commands.ts";

test("Helix overlays and normalized binding fingerprints", () => {
    for (
        const [keys, action] of [
            [["d"], "vim::HelixDelete"],
            [["alt+c"], "vim::HelixSubstituteNoYank"],
            [["I"], "vim::InsertFirstNonWhitespace"],
            [["g", "e"], "vim::EndOfDocument"],
        ]
    ) {
        assert.equal(resolveBinding("normal", keys).binding?.action, action);
    }
    assert.equal(resolveBinding("normal", ["g"]).prefix, true);
    assert.equal(resolveBinding("insert", ["d"]).binding, undefined);
});
test("classification and identity invariants", () => {
    const fingerprints = new Set();
    for (const binding of bindings) {
        assert.ok(binding.keys.length);
        assert.ok(["implemented", "excluded", "pi", "pending"].includes(binding.classification));
        if (binding.classification === "excluded") assert.ok(binding.reason);
        for (const mode of binding.modes) {
            const fingerprint = JSON.stringify([mode, binding.context, binding.keys]);
            assert.ok(!fingerprints.has(fingerprint), fingerprint);
            fingerprints.add(fingerprint);
        }
    }
    assert.equal(resolveBinding("normal", ["="]).binding.classification, "excluded");
    assert.equal(resolveBinding("normal", ["space", "f"]).binding.classification, "excluded");
});
test("partial runtime coverage and pinned fingerprints are explicit", () => {
    const source = JSON.parse(readFileSync(new URL("../reference/source.json", import.meta.url)));
    const coverage = JSON.parse(
        readFileSync(new URL("../reference/runtime-coverage.json", import.meta.url)),
    );
    assert.match(source.revision, /^[a-f0-9]{40}$/);
    assert.ok(source.sources.length <= 8);
    for (const file of source.sources) {
        assert.ok(file.url.includes(source.revision));
        assert.match(file.sha256, /^[a-f0-9]{64}$/);
        assert.ok(file.bytes > 0);
    }
    assert.ok(coverage.counts.NOT_YET_IMPLEMENTED >= 0);
    assert.equal(
        coverage.tested,
        bindings.filter((b) => b.classification === "implemented").reduce(
            (n, b) => n + b.modes.length,
            0,
        ),
    );
    assert.deepEqual(coverage.implementedActions, implementedActions);
    const inventory = bindings.flatMap((binding) =>
        binding.modes.map((mode) => ({
            mode,
            keys: binding.keys,
            ...(binding.context ? { context: binding.context } : {}),
            action: binding.action,
            ...(binding.args !== undefined ? { args: binding.args } : {}),
            status: binding.classification === "pending"
                ? "NOT_YET_IMPLEMENTED"
                : binding.classification,
            tested: binding.classification === "implemented",
            ...(binding.reason ? { reason: binding.reason } : {}),
        }))
    );
    assert.deepEqual(coverage.bindings, inventory);
    assert.deepEqual(coverage.counts, {
        implemented: inventory.filter((entry) =>
            entry.status === "implemented" || entry.status === "pi"
        ).length,
        NOT_YET_IMPLEMENTED: inventory.filter((entry) =>
            entry.status === "NOT_YET_IMPLEMENTED"
        ).length,
        excluded: inventory.filter((entry) => entry.status === "excluded").length,
    });
    assert.deepEqual(
        coverage.unresolvedFamilies,
        [
            ...new Set(
                inventory.filter((entry) => entry.status === "NOT_YET_IMPLEMENTED").map((entry) =>
                    entry.action
                ),
            ),
        ].sort(),
    );
    for (
        const action of [
            "buffer_search::UseSelectionForFind",
            "editor::SelectNext",
            "editor::SelectPrevious",
            "editor::SelectAllMatches",
        ]
    ) {
        for (const b of bindings.filter((b) => b.action === action)) {
            assert.notEqual(b.classification, "excluded");
        }
    }
    for (const keys of [["i"], ["a"], ["%"], ["g", "j"], ["g", "k"]]) {
        assert.equal(resolveBinding("normal", keys).binding?.args, undefined);
    }
});
test("every implemented binding invokes controller with its mode and operator fixture", () => {
    for (const binding of bindings.filter((b) => b.classification === "implemented")) {
        for (const mode of binding.modes) {
            for (const prefix of runtimeContextPrefixes(binding)) {
                const b = new HelixBuffer();
                b.setText("one (two) one.\n\n    three four\nlast");
                b.escape();
                b.moveTo(5);
                b.mode = mode;
                const callbacks = [];
                const c = new CommandController(b, {
                    requestCompletion: () => callbacks.push(["completion"]),
                    view: {
                        pageSize: 2,
                        ...Object.fromEntries(
                            [
                                "page",
                                "boundary",
                                "moveVisual",
                                "viewport",
                                "wordLabels",
                                "scroll",
                                "align",
                                "middle",
                            ].map(
                                (name) => [name, (...args) => {
                                    callbacks.push([name, ...args]);
                                    return 5;
                                }],
                            ),
                        ),
                    },
                });
                for (const key of [...prefix, ...binding.keys]) {
                    assert.equal(
                        c.handleKey(key),
                        true,
                        JSON.stringify({ mode, prefix, binding, key }),
                    );
                }
                assert.doesNotMatch(c.status, /Unsupported|unhandled/i, JSON.stringify(binding));
                c.dispose();
            }
        }
    }
});
test("representative classifications invoke the actual callback map", () => {
    for (
        const [mode, keys, expected] of [
            ["normal", ["ctrl+f"], ["page", 1, 1, false]],
            ["normal", ["g", "j"], null],
            ["select", ["g", "j"], ["moveVisual", 1, 1]],
            ["normal", ["g", "M"], ["boundary", "middle", 1]],
        ]
    ) {
        assert.equal(resolveBinding(mode, keys).binding.classification, "implemented");
        const b = new HelixBuffer();
        b.setText("abc\ndef");
        b.escape();
        b.mode = mode;
        const calls = [];
        const c = new CommandController(b, {
            view: Object.fromEntries(
                ["page", "boundary", "moveVisual"].map((
                    name,
                ) => [name, (...args) => calls.push([name, ...args])]),
            ),
        });
        for (const key of keys) c.handleKey(key);
        assert.deepEqual(calls, expected ? [expected] : []);
        c.dispose();
    }
});
test("plain indent, count aliases, occurrence args and contextual grammar are not deferred", () => {
    for (
        const keys of [[">"], ["<"], ["1"], ["9"], ["}"], ["ctrl+v"], ["g", "l"], ["g", "L"], [
            "space",
            "h",
        ]]
    ) {
        assert.equal(resolveBinding("normal", keys).binding.classification, "implemented");
    }
    const b = new HelixBuffer();
    b.setText("one one one");
    b.escape();
    b.moveTo(0);
    const c = new CommandController(b);
    c.handleKey(">");
    assert.equal(b.text, "    one one one");
    c.handleKey("<");
    assert.equal(b.text, "one one one");
    b.setSelections([{ id: "a", start: 0, end: 3, reversed: false }, {
        id: "b",
        start: 4,
        end: 7,
        reversed: false,
    }], "b");
    for (const k of ["g", ">"]) c.handleKey(k);
    assert.deepEqual(b.selections.map((s) => [s.start, s.end]), [[0, 3], [8, 11]]);
    for (const k of ["space", "h"]) c.handleKey(k);
    assert.equal(b.selections.length, 3);
    const object = bindings.find((b) =>
        b.context?.includes("vim_operator == a ||") && b.keys[0] === "w"
    );
    assert.equal(object.classification, "implemented");
    assert.deepEqual(runtimeContextPrefixes(object), [["m", "a"], ["m", "i"]]);
    for (
        const action of ["vim::AnyPair", "vim::Argument", "vim::Method", "vim::Class", "vim::Tag"]
    ) {
        for (const entry of bindings.filter((b) => b.action === action)) {
            assert.equal(
                entry.classification,
                "excluded",
            );
        }
    }
    c.dispose();
});
test("integrated aliases perform observable text or viewport actions in each declared mode", () => {
    const cases = [
        [["ctrl+m"], 16],
        [["+"], 0],
        [["tab"], 12],
        [["shift+tab"], 12],
        [["pagedown"], 16],
        [["pageup"], 0],
        [["M"], 16],
    ];
    for (const [keys, target] of cases) {
        for (const mode of ["normal", "select"]) {
            const b = new HelixBuffer();
            b.setText("abcdefg\nhijklmn\nopqrstu");
            b.escape();
            b.moveTo(8);
            b.mode = mode;
            const c = new CommandController(b, { view: { pageSize: 1, middle: () => 16 } });
            for (const key of keys) assert.equal(c.handleKey(key), true);
            assert.equal(b.visualHead(b.primary), target, JSON.stringify({ keys, mode }));
            c.dispose();
        }
    }
    for (const mode of ["normal", "select", "insert"]) {
        for (
            const [keys, expected] of [
                [["ctrl+e"], ["scroll", 1]],
                [["ctrl+y"], ["scroll", -1]],
                [["z", "t"], ["align", "top"]],
                [["z", "z"], ["align", "center"]],
                [["z", "c"], ["align", "center"]],
                [["z", "b"], ["align", "bottom"]],
            ]
        ) {
            if (mode === "insert" && keys[0] === "z") continue;
            const b = new HelixBuffer();
            b.setText("abc");
            b.escape();
            b.mode = mode;
            const calls = [];
            const c = new CommandController(b, {
                view: {
                    scroll: (n) => calls.push(["scroll", n]),
                    align: (p) => calls.push(["align", p]),
                },
            });
            for (const key of [...(mode === "insert" ? ["ctrl+x"] : []), ...keys]) c.handleKey(key);
            assert.deepEqual(calls, [expected]);
            assert.equal(b.text, "abc");
            c.dispose();
        }
    }
});

test("new search and mode aliases have semantic effects", () => {
    for (const mode of ["normal", "select"]) {
        for (
            const [keys, start, target] of [
                [["#"], 8, 4],
                [["g", "*"], 0, 4],
                [["g", "#"], 8, 4],
                [["/", "o", "n", "e", "enter", "g", "N"], 0, 0],
            ]
        ) {
            const b = new HelixBuffer();
            b.setText("one one one");
            b.escape();
            b.setSelections([{ id: "p", start, end: start + 3, reversed: false }]);
            b.mode = mode;
            const c = new CommandController(b, {
                matcher: (text, pattern) =>
                    [...text.matchAll(new RegExp(pattern, "g"))]
                        .map((match) => ({
                            start: match.index,
                            end: match.index + match[0].length,
                        })),
            });
            for (const k of keys) c.handleKey(k);
            assert.equal(b.primary.start, target, JSON.stringify({ mode, keys }));
            c.dispose();
        }
        for (const key of ["insert", "ctrl+["]) {
            const b = new HelixBuffer();
            b.setText("abc");
            b.escape();
            b.mode = mode;
            const c = new CommandController(b);
            c.handleKey(key);
            assert.equal(b.mode, key === "insert" ? "insert" : "normal");
            c.dispose();
        }
        const b = new HelixBuffer();
        b.setText("abc\ndef");
        b.escape();
        b.moveTo(4);
        b.mode = mode;
        const c = new CommandController(b);
        c.handleKey("alt+C");
        assert.equal(b.selections.length, 2);
        assert.equal(b.selections[1].start, 0);
        c.handleKey("V");
        assert.equal(b.mode, mode === "select" ? "normal" : "select");
        c.dispose();
    }
});

test("plain backward occurrence skips substrings while g # permits them", () => {
    for (const [keys, target] of [[["#"], 0], [["g", "#"], 6]]) {
        const b = new HelixBuffer();
        b.setText("one stone one");
        b.escape();
        b.setSelections([{ id: "p", start: 10, end: 13, reversed: false }]);
        const c = new CommandController(b, {
            matcher: (text, pattern) =>
                [...text.matchAll(new RegExp(pattern, "g"))].map((m) => ({
                    start: m.index,
                    end: m.index + m[0].length,
                })),
        });
        for (const key of keys) c.handleKey(key);
        assert.equal(b.primary.start, target);
        c.dispose();
    }
});

test("completion prefix requests the host callback exactly once", () => {
    const b = new HelixBuffer();
    let calls = 0;
    const c = new CommandController(b, { requestCompletion: () => calls++ });
    assert.equal(c.handleKey("ctrl+x"), true);
    assert.equal(calls, 0);
    assert.equal(c.handleKey("ctrl+o"), true);
    assert.equal(calls, 1);
    assert.equal(b.text, "");
    c.dispose();
});

test("search repeats preserve selections and cancel restores the original preview", () => {
    const b = new HelixBuffer();
    b.setText("one one one one");
    b.escape();
    const original = [{ id: "a", start: 0, end: 3, reversed: false }, {
        id: "b",
        start: 8,
        end: 11,
        reversed: false,
    }];
    b.setSelections(original, "b");
    const c = new CommandController(b, {
        matcher: (text, pattern) =>
            [...text.matchAll(new RegExp(pattern, "g"))].map((m) => ({
                start: m.index,
                end: m.index + m[0].length,
            })),
    });
    for (const key of ["/", "o", "n", "e", "escape"]) c.handleKey(key);
    assert.deepEqual(b.selections, original);
    for (const key of ["/", "o", "n", "e", "enter", "n"]) c.handleKey(key);
    assert.deepEqual(b.selections.map((s) => s.start), [8, 0]);
    assert.equal(b.primaryId, "b");
    c.handleKey("N");
    assert.deepEqual(b.selections.map((s) => s.start), [4, 12]);
    c.dispose();
});

test("context quote objects select actual contents for every runtime prefix", () => {
    for (
        const binding of bindings.filter((b) =>
            ["vim::MiniQuotes", "vim::VerticalBars"].includes(b.action)
        )
    ) {
        for (const mode of binding.modes) {
            for (const prefix of runtimeContextPrefixes(binding)) {
                const delimiter = binding.keys[0] === "q" ? "\"" : "|";
                const b = new HelixBuffer();
                b.setText(`a ${delimiter}hello${delimiter} z`);
                b.escape();
                b.moveTo(4);
                b.mode = mode;
                const c = new CommandController(b);
                for (const key of [...prefix, ...binding.keys]) c.handleKey(key);
                assert.equal(
                    b.text.slice(b.primary.start, b.primary.end),
                    prefix[1] === "a" ? `${delimiter}hello${delimiter}` : "hello",
                );
                c.dispose();
            }
        }
    }
});

test("operator bindings require their context", () => {
    const contextual = bindings.find((b) => b.context && b.action === "vim::NextSectionStart");
    assert.ok(contextual);
    assert.equal(
        resolveBinding("normal", contextual.keys, contextual.context).binding.action,
        contextual.action,
    );
    assert.notEqual(resolveBinding("normal", contextual.keys).binding?.action, contextual.action);
});
