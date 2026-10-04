/** Local structural adapter for pi-openai-web's public Packet contract, version 1.
 * Mirrors every nested field and rejects additional properties. No sibling runtime import.
 * Contract parity is checked against the actual producer/schema in offline tests.
 */
type Guard = (value: unknown) => boolean;

const string: Guard = (v) => typeof v === "string";

const number: Guard = (v) => typeof v === "number" && Number.isFinite(v);

const integer: Guard = (v) => number(v) && Number.isInteger(v);

const boolean: Guard = (v) => typeof v === "boolean";

const oneOf = (...values: unknown[]): Guard => (v) => values.includes(v);

const array = (guard: Guard): Guard => (v) => Array.isArray(v) && Array.from(v).every(guard);

const object =
    (required: Record<string, Guard>, optional: Record<string, Guard> = {}): Guard => (v) => {
        if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
        const record = v as Record<string, unknown>;
        return Object.keys(required).every((key) =>
            Object.hasOwn(record, key) && required[key](record[key])
        )
            && Object.keys(record).every((key) =>
                Object.hasOwn(required, key)
                || (Object.hasOwn(optional, key) && optional[key](record[key]))
            );
    };

const strings = array(string);
const freshness = oneOf("live", "cached");
const context = oneOf("low", "medium", "high");
const identity = object({ provider: string, id: string, api: string });
const origin = object({ outputIndex: integer, contentIndex: integer }, { itemId: string });
const error = object({
    kind: oneOf(
        "auth",
        "capability",
        "rate_limit",
        "timeout",
        "cancelled",
        "transport",
        "http",
        "unsafe_url",
        "unsupported_content",
        "incomplete",
    ),
    message: string,
});
const usage = object({
    input: number,
    output: number,
    cacheRead: number,
    cacheWrite: number,
    totalTokens: number,
    cost: object({
        input: number,
        output: number,
        cacheRead: number,
        cacheWrite: number,
        total: number,
    }),
}, { cacheWrite1h: number, reasoning: number });
const query = object({
    id: string,
    query: string,
    model: identity,
    freshness,
    searchContextSize: context,
    startedAt: number,
    finishedAt: number,
    ok: boolean,
    status: oneOf("success", "failure"),
    answerSegments: array(object({
        origin,
        text: string,
        complete: boolean,
        truncated: boolean,
        provenance: oneOf("provider", "normalized"),
    })),
    citations: array(object({
        type: oneOf("url_citation"),
        url: string,
        origin,
        startIndex: number,
        endIndex: number,
    }, { title: string })),
    actions: array(object({ id: string, outputIndex: integer, status: string }, {
        type: oneOf("search", "open_page", "find_in_page"),
        queries: strings,
        url: string,
        pattern: string,
    })),
    sources: array(
        object({ type: oneOf("url"), url: string, actionId: string, outputIndex: integer }),
    ),
    warnings: strings,
    truncation: object({
        answer: boolean,
        evidence: boolean,
        answerBytes: number,
        answerLines: number,
    }),
}, { responseId: string, error, usage });
const page = object({
    ok: boolean,
    requestedUrl: string,
    finalUrl: (v) => v === null || string(v),
    timestamp: string,
    title: (v) => v === null || string(v),
    totalLines: integer,
    excerpts: array(object({ startLine: integer, endLine: integer, text: string })),
    matches: array(object({ line: integer, column: integer, text: string })),
    no_match: boolean,
    warnings: strings,
    completeness: oneOf("complete", "partial", "none"),
    truncated: boolean,
    truncation: object({ wire: boolean, decoded: boolean, extracted: boolean, matches: boolean }),
}, { error });
const packet = object({
    version: oneOf(1),
    tool: oneOf("openai_search", "web_action"),
    status: oneOf("running", "success", "partial", "failure"),
    request: object({ id: string, startedAt: number }, {
        finishedAt: number,
        model: identity,
        freshness,
        searchContextSize: context,
        queries: strings,
        action: oneOf("open", "find"),
        url: string,
    }),
    results: array(query),
    evidence: array(
        object({ id: string, queryId: string, kind: oneOf("citation", "source"), url: string }, {
            title: string,
        }),
    ),
    nativeSearchFees: oneOf("unknown", "not_applicable"),
    warnings: strings,
    truncation: object({ text: boolean, structured: boolean, omissions: strings }),
}, { page, usage, error });
interface SearchPacket {
    tool: "openai_search";
    status: string;
    request: { finishedAt?: number };
    nativeSearchFees: string;
    error?: { kind: string; message: string };
    results: {
        ok: boolean;
        status: string;
        error?: { kind: string; message: string };
        actions: { type?: string; status: string }[];
        answerSegments: { complete: boolean; text: string }[];
    }[];
}

export function isSearchPacket(value: unknown): value is SearchPacket {
    return packet(value) && (value as SearchPacket).tool === "openai_search";
}
