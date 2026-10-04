import { type Static, Type } from "typebox";

const strict = { additionalProperties: false };

const string = () => Type.String();

const strings = () => Type.Array(string());

const boundedInt = (minimum: number, maximum: number, value: number) =>
    Type.Optional(Type.Integer({ minimum, maximum, default: value }));

export const SearchParams = Type.Object({
    queries: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
        minItems: 1,
        maxItems: 5,
    }),
    freshness: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("cached")])),
    search_context_size: Type.Optional(
        Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    ),
}, strict);
export const PageParams = Type.Union([
    Type.Object({
        action: Type.Literal("open"),
        url: Type.String({ minLength: 1, maxLength: 2048 }),
        start_line: boundedInt(1, Number.MAX_SAFE_INTEGER, 1),
        max_lines: boundedInt(1, 500, 200),
    }, strict),
    Type.Object({
        action: Type.Literal("find"),
        url: Type.String({ minLength: 1, maxLength: 2048 }),
        pattern: Type.String({ minLength: 1, maxLength: 4096 }),
        case_sensitive: Type.Optional(Type.Boolean({ default: false })),
        max_matches: boundedInt(1, 50, 20),
    }, strict),
]);
export type SearchArguments = Static<typeof SearchParams>;
export type PageArguments = Static<typeof PageParams>;
export const ErrorSchema = Type.Object({
    kind: Type.Enum(
        [
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
        ] as const,
    ),
    message: string(),
}, strict);
export const UsageSchema = Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    cacheWrite1h: Type.Optional(Type.Number()),
    reasoning: Type.Optional(Type.Number()),
    totalTokens: Type.Number(),
    cost: Type.Object({
        input: Type.Number(),
        output: Type.Number(),
        cacheRead: Type.Number(),
        cacheWrite: Type.Number(),
        total: Type.Number(),
    }, strict),
}, strict);
const origin = Type.Object({
    itemId: Type.Optional(string()),
    outputIndex: Type.Integer(),
    contentIndex: Type.Integer(),
}, strict);
const identity = Type.Object({ provider: string(), id: string(), api: string() }, strict);
const query = Type.Object({
    id: string(),
    query: string(),
    model: identity,
    freshness: Type.Union([Type.Literal("live"), Type.Literal("cached")]),
    searchContextSize: Type.Enum(["low", "medium", "high"] as const),
    responseId: Type.Optional(string()),
    startedAt: Type.Number(),
    finishedAt: Type.Number(),
    ok: Type.Boolean(),
    status: Type.Union([Type.Literal("success"), Type.Literal("failure")]),
    answerSegments: Type.Array(
        Type.Object({
            origin,
            text: string(),
            complete: Type.Boolean(),
            truncated: Type.Boolean(),
            provenance: Type.Union([Type.Literal("provider"), Type.Literal("normalized")]),
        }, strict),
    ),
    citations: Type.Array(
        Type.Object({
            type: Type.Literal("url_citation"),
            url: string(),
            title: Type.Optional(string()),
            origin,
            startIndex: Type.Number(),
            endIndex: Type.Number(),
        }, strict),
    ),
    actions: Type.Array(Type.Object({
        id: string(),
        outputIndex: Type.Integer(),
        status: string(),
        type: Type.Optional(Type.Enum(["search", "open_page", "find_in_page"] as const)),
        queries: Type.Optional(strings()),
        url: Type.Optional(string()),
        pattern: Type.Optional(string()),
    }, strict)),
    sources: Type.Array(
        Type.Object({
            type: Type.Literal("url"),
            url: string(),
            actionId: string(),
            outputIndex: Type.Integer(),
        }, strict),
    ),
    warnings: strings(),
    truncation: Type.Object({
        answer: Type.Boolean(),
        evidence: Type.Boolean(),
        answerBytes: Type.Number(),
        answerLines: Type.Number(),
    }, strict),
    error: Type.Optional(ErrorSchema),
    usage: Type.Optional(UsageSchema),
}, strict);
const page = Type.Object({
    ok: Type.Boolean(),
    requestedUrl: string(),
    finalUrl: Type.Union([string(), Type.Null()]),
    timestamp: string(),
    title: Type.Union([string(), Type.Null()]),
    totalLines: Type.Integer(),
    excerpts: Type.Array(
        Type.Object({ startLine: Type.Integer(), endLine: Type.Integer(), text: string() }, strict),
    ),
    matches: Type.Array(
        Type.Object({ line: Type.Integer(), column: Type.Integer(), text: string() }, strict),
    ),
    no_match: Type.Boolean(),
    warnings: strings(),
    completeness: Type.Enum(["complete", "partial", "none"] as const),
    truncated: Type.Boolean(),
    truncation: Type.Object({
        wire: Type.Boolean(),
        decoded: Type.Boolean(),
        extracted: Type.Boolean(),
        matches: Type.Boolean(),
    }, strict),
    error: Type.Optional(ErrorSchema),
}, strict);
export const PacketSchema = Type.Object({
    version: Type.Literal(1),
    tool: Type.Union([Type.Literal("openai_search"), Type.Literal("web_action")]),
    status: Type.Enum(["running", "success", "partial", "failure"] as const),
    request: Type.Object({
        id: string(),
        startedAt: Type.Number(),
        finishedAt: Type.Optional(Type.Number()),
        model: Type.Optional(identity),
        freshness: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("cached")])),
        searchContextSize: Type.Optional(Type.Enum(["low", "medium", "high"] as const)),
        queries: Type.Optional(strings()),
        action: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("find")])),
        url: Type.Optional(string()),
    }, strict),
    results: Type.Array(query),
    page: Type.Optional(page),
    evidence: Type.Array(
        Type.Object({
            id: string(),
            queryId: string(),
            kind: Type.Union([Type.Literal("citation"), Type.Literal("source")]),
            url: string(),
            title: Type.Optional(string()),
        }, strict),
    ),
    usage: Type.Optional(UsageSchema),
    nativeSearchFees: Type.Union([Type.Literal("unknown"), Type.Literal("not_applicable")]),
    warnings: strings(),
    truncation: Type.Object({
        text: Type.Boolean(),
        structured: Type.Boolean(),
        omissions: strings(),
    }, strict),
    error: Type.Optional(ErrorSchema),
}, strict);
export type Packet = Static<typeof PacketSchema>;

export function validateSearchArgs(value: SearchArguments): void {
    if (
        !Array.isArray(value.queries) || value.queries.length < 1 || value.queries.length > 5
        || value.queries.some((query) =>
            typeof query !== "string" || !query.trim() || Buffer.byteLength(query) > 4096
        )
    ) {
        throw new Error("queries must contain 1..5 nonempty strings, each at most 4 KiB UTF-8");
    }
}
