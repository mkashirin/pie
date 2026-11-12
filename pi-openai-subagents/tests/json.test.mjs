import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { normalizeJson } = await createJiti(import.meta.url, { fsCache: false }).import(
    "../src/json.ts",
);
const native = (value) => JSON.parse(JSON.stringify(value));

test("ordinary values match native normalization", () => {
    const shared = { text: "unicode 😀 \ud800 \u0000 \\\"", omitted: undefined };
    const nullPrototype = Object.assign(Object.create(null), { a: 1 });
    const values = [null, true, false, "", 42, -0, NaN, Infinity, -Infinity, {
        a: undefined,
        b: [undefined, NaN, -0],
        shared,
        again: shared,
        nullPrototype,
    }, JSON.parse("{\"__proto__\":{\"polluted\":true},\"constructor\":1}")];
    for (const value of values) assert.deepStrictEqual(normalizeJson(value), native(value));
    const result = normalizeJson(values.at(-1));
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.hasOwn(result, "__proto__"), true);
});

test("raw JSON values preserve native semantics, including nested evidence details", {
    skip: typeof JSON.rawJSON !== "function",
}, () => {
    for (const text of ["123", "\"raw string\"", "true", "null", "-0", "9007199254740993"]) {
        const raw = JSON.rawJSON(text);
        for (const value of [raw, { details: { count: raw } }, [raw]]) {
            assert.deepStrictEqual(normalizeJson(value), native(value));
        }
    }
});

test("results are detached, including repeated references", () => {
    const shared = { nested: [1, { a: 2 }] };
    const input = { a: shared, b: shared };
    const result = normalizeJson(input);
    assert.notEqual(result, input);
    assert.notEqual(result.a, result.b);
    result.a.nested[1].a = 3;
    assert.equal(shared.nested[1].a, 2);
    assert.equal(result.b.nested[1].a, 2);
});

test("exotic cases match native, without duplicate getter/toJSON calls", () => {
    const factories = [
        () => new Date("2026-01-01"),
        () => new Number(3),
        () => new Map([[1, 2]]),
        () => [1, , 3],
        () => ({ a: Symbol(), b() {}, c: [Symbol(), () => {}] }),
        () => new Proxy({ a: 1 }, {}),
        () =>
            Object.assign(
                Object.create({
                    toJSON() {
                        return "inherited";
                    },
                }),
                { a: 1 },
            ),
        () => {
            let calls = 0;
            return {
                get value() {
                    return ++calls;
                },
            };
        },
        () => {
            let calls = 0;
            return {
                a: 1,
                child: {
                    toJSON(key) {
                        return [key, ++calls];
                    },
                },
            };
        },
    ];
    for (const factory of factories) {
        assert.deepStrictEqual(normalizeJson(factory()), native(factory()));
    }
});

test("native serialization errors are preserved", () => {
    const cycle = {};
    cycle.self = cycle;
    for (const value of [undefined, Symbol(), () => {}, 1n, { bigint: 1n }, cycle]) {
        assert.throws(() => normalizeJson(value), {
            name: (() => {
                try {
                    native(value);
                } catch (error) {
                    return error.name;
                }
            })(),
        });
    }
    const error = new Error("getter failed");
    assert.throws(() =>
        normalizeJson({
            get bad() {
                throw error;
            },
        }), (caught) => caught === error);
});

test("large JSON-safe strings never use stringify or parse", () => {
    const input = { results: [{ text: "😀\n\"\\".repeat(1_000_000), absent: undefined }] };
    const stringify = JSON.stringify;
    const parse = JSON.parse;
    try {
        JSON.stringify = () => {
            throw new Error("unexpected stringify");
        };
        JSON.parse = () => {
            throw new Error("unexpected parse");
        };
        const output = normalizeJson(input);
        assert.equal(output.results[0].text, input.results[0].text);
        assert.notEqual(output.results[0], input.results[0]);
        assert.equal(Object.hasOwn(output.results[0], "absent"), false);
    } finally {
        JSON.stringify = stringify;
        JSON.parse = parse;
    }
});
