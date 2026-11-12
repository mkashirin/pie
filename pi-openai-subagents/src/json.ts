import { types } from "node:util";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const fallback = Symbol("native JSON normalization required");
const isRawJSON = (JSON as typeof JSON & { isRawJSON?: (value: unknown) => boolean }).isRawJSON;

/** Detached JSON normalization without encoding/copying ordinary string payloads.
 * Exotic values are left entirely to JSON.stringify (including its errors).
 * Descriptors avoid invoking getters before falling back to the native operation.
 */
export function normalizeJson(value: unknown): JsonValue {
    const ancestors = new Set<object>();
    const copy = (input: unknown, depth: number): unknown => {
        if (input === null || typeof input === "string" || typeof input === "boolean") return input;
        if (typeof input === "number") {
            return Number.isFinite(input)
                ? (input === 0 ? 0 : input)
                : null;
        }
        if (input === undefined) return undefined;
        if (
            typeof input !== "object" || depth > 100 || types.isProxy(input)
            || isRawJSON?.(input)
        ) throw fallback;
        const array = Array.isArray(input);
        const prototype = Object.getPrototypeOf(input);
        if (
            prototype !== (array ? Array.prototype : Object.prototype)
            && !(prototype === null && !array)
        ) {
            throw fallback;
        }
        if ("toJSON" in input || ancestors.has(input)) throw fallback;
        ancestors.add(input);
        let output: unknown;
        if (array) {
            const result: unknown[] = [];
            const length = (input as unknown[]).length;
            for (let i = 0; i < length; i++) {
                const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
                // Holes may resolve through the prototype; use native semantics.
                if (!descriptor || !("value" in descriptor)) throw fallback;
                result.push(copy(descriptor.value, depth + 1) ?? null);
            }
            output = result;
        } else {
            const result: Record<string, unknown> = {};
            for (const key of Object.keys(input)) {
                const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
                if (!("value" in descriptor)) throw fallback;
                const child = copy(descriptor.value, depth + 1);
                if (child !== undefined) {
                    // Assignment would invoke the legacy __proto__ setter.
                    Object.defineProperty(result, key, {
                        value: child,
                        enumerable: true,
                        configurable: true,
                        writable: true,
                    });
                }
            }
            output = result;
        }
        ancestors.delete(input);
        return output;
    };
    try {
        // Native parsing rejects an undefined top-level serialization.
        if (value !== undefined) return copy(value, 0) as JsonValue;
    } catch (error) {
        if (error !== fallback) throw error;
    }
    return JSON.parse(JSON.stringify(value));
}
