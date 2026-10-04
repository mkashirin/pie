import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";

export type PageErrorKind =
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

export type PageReadParams =
    | { action: "open"; url: string; start_line?: number; max_lines?: number }
    | {
        action: "find";
        url: string;
        pattern: string;
        case_sensitive?: boolean;
        max_matches?: number;
    };

export interface PageExcerpt {
    /** One-based, inclusive line numbers in the extracted text. */
    startLine: number;
    endLine: number;
    text: string;
}
export interface PageMatch {
    /** One-based starting line in normalized extracted text. */
    line: number;
    /** One-based UTF-16 starting column in the extracted line. */
    column: number;
    /** Literal matched text, including newlines for a spanning match. */
    text: string;
}
export interface PageReadBase {
    requestedUrl: string;
    finalUrl: string | null;
    timestamp: string;
    title: string | null;
    /** Count of retained extracted lines, not lines in the source HTML. */
    totalLines: number;
    excerpts: PageExcerpt[];
    matches: PageMatch[];
    /** False when the page was incomplete and absence cannot be established. */
    no_match: boolean;
    warnings: string[];
    completeness: "complete" | "partial" | "none";
    truncated: boolean;
    truncation: { wire: boolean; decoded: boolean; extracted: boolean; matches: boolean };
}
export type PageReadResult =
    & PageReadBase
    & (
        | { ok: true; error?: never }
        | { ok: false; error: { kind: PageErrorKind; message: string } }
    );

export interface PageAddress {
    address: string;
    family: 4 | 6;
}
/** Trusted, low-level test seams. URL/address validation and pinning remain in readPage. */
export interface PageAdapters {
    resolve(hostname: string, signal: AbortSignal): Promise<readonly PageAddress[]>;
    request(
        url: URL,
        options: RequestOptions,
        onResponse: (response: IncomingMessage) => void,
    ): ClientRequest;
}
export interface PageReadOptions {
    signal?: AbortSignal;
    adapters?: Partial<PageAdapters>;
}
