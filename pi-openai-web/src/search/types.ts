import type {
    Api,
    AssistantMessage,
    AssistantMessageEvent,
    Context,
    Model,
    SimpleStreamOptions,
    Usage,
} from "@earendil-works/pi-ai";

export type SearchFreshness = "live" | "cached";
export type SearchContextSize = "low" | "medium" | "high";
export type SearchFailureKind =
    | "auth"
    | "capability"
    | "rate_limit"
    | "timeout"
    | "cancelled"
    | "transport"
    | "http"
    | "unsafe_url"
    | "unsupported_content"
    | "incomplete";

/** A structural subset of ctx.modelRegistry: authentication remains Pi-owned. */
export interface SearchRegistry {
    streamSimple(
        model: Model<Api>,
        context: Context,
        options?: SimpleStreamOptions,
    ): AsyncIterable<AssistantMessageEvent> & { result(): Promise<AssistantMessage> };
}

export interface SearchModelIdentity {
    provider: string;
    id: string;
    api: string;
}

/** Native output coordinates, never offsets into concatenated or truncated text. */
export interface SearchOrigin {
    itemId?: string;
    outputIndex: number;
    contentIndex: number;
}

export interface SearchAnswerSegment {
    origin: SearchOrigin;
    text: string;
    complete: boolean;
    truncated: boolean;
    /** Native evidence, or fallback text from Pi's normalized stream. */
    provenance: "provider" | "normalized";
}

export interface SearchCitation {
    type: "url_citation";
    url: string;
    title?: string;
    origin: SearchOrigin;
    /** Unmodified provider offsets; their units are provider-defined character positions. */
    startIndex: number;
    endIndex: number;
}

export interface SearchAction {
    id: string;
    outputIndex: number;
    status: string;
    type?: "search" | "open_page" | "find_in_page";
    queries?: string[];
    url?: string;
    pattern?: string;
}

export interface SearchSource {
    type: "url";
    url: string;
    actionId: string;
    outputIndex: number;
}

export interface SearchTruncation {
    answer: boolean;
    evidence: boolean;
    /** UTF-8 bytes and lines of retained answer text, not original response size. */
    answerBytes: number;
    answerLines: number;
}

export interface SearchProgress {
    query: string;
    model: SearchModelIdentity;
    responseId?: string;
    timestamp: number;
    /** Bounded text from the normalized stream; thinking is never exposed. */
    answerText: string;
    usage?: Usage;
}

interface SearchQueryEvidence {
    query: string;
    model: SearchModelIdentity;
    freshness: SearchFreshness;
    searchContextSize: SearchContextSize;
    responseId?: string;
    startedAt: number;
    finishedAt: number;
    answerSegments: SearchAnswerSegment[];
    citations: SearchCitation[];
    actions: SearchAction[];
    sources: SearchSource[];
    warnings: string[];
    truncation: SearchTruncation;
    /** Pi token/cost usage only. Native web-search fees are unknown, not zero. */
    usage?: Usage;
}

export type SearchQueryResult =
    & SearchQueryEvidence
    & (
        | { ok: true; status: "success"; error?: never }
        | { ok: false; status: "failure"; error: { kind: SearchFailureKind; message: string } }
    );

export interface SearchQueryOptions {
    registry: SearchRegistry;
    model: Model<Api>;
    query: string;
    freshness: SearchFreshness;
    searchContextSize: SearchContextSize;
    signal?: AbortSignal;
    onProgress?: (progress: SearchProgress) => void | Promise<void>;
}
