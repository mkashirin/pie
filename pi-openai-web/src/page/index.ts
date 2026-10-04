import ipaddr from "ipaddr.js";
import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type {
    PageAdapters,
    PageAddress,
    PageErrorKind,
    PageReadBase,
    PageReadOptions,
    PageReadParams,
    PageReadResult,
} from "./types.js";
export type * from "./types.js";

export const PAGE_LIMITS = Object.freeze({
    url: 2048,
    redirects: 5,
    wireBytes: 2 * 1024 * 1024,
    decodedBytes: 4 * 1024 * 1024,
    extractedBytes: 100 * 1024,
    deadlineMs: 30_000,
    openLines: 500,
    findMatches: 50,
});

class PageFailure extends Error {
    kind: PageErrorKind;

    constructor(kind: PageErrorKind, message: string) {
        super(message);
        this.kind = kind;
    }
}

const fail = (kind: PageErrorKind, message: string): never => {
    throw new PageFailure(kind, message);
};

const nativeAdapters: PageAdapters = {
    async resolve(hostname) {
        const addresses = await lookup(hostname, { all: true, verbatim: true });
        return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
    },
    request(url, options, callback) {
        return (url.protocol === "https:" ? https : http).request(url, options, callback);
    },
};

// Conservatively exclude special-use IPv4 space, including transition/benchmark networks.
const blockedV4 = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.88.99.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
].map((cidr) => ipaddr.parseCIDR(cidr));
const blockedV6 = ["2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"]
    .map((cidr) => ipaddr.parseCIDR(cidr));

function globalAddress(address: string): boolean {
    if (!isIP(address)) return false;
    const parsed = ipaddr.process(address); // IPv4-mapped IPv6 must pass IPv4 checks.
    const blocked = parsed.kind() === "ipv4" ? blockedV4 : blockedV6;
    if (parsed.range() !== "unicast") return false;
    if (parsed.kind() === "ipv6" && !parsed.match(ipaddr.parseCIDR("2000::/3"))) return false;
    return !blocked.some(([network, prefix]) =>
        parsed.kind() === network.kind() && parsed.match(network, prefix)
    );
}

function safeUrl(input: string, base?: URL): URL {
    if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > PAGE_LIMITS.url) {
        return fail("unsafe_url", "URL is missing or exceeds 2048 bytes.");
    }
    let url: URL;
    try {
        url = base ? new URL(input, base) : new URL(input);
    } catch {
        return fail("unsafe_url", "Invalid URL.");
    }
    if (Buffer.byteLength(url.href, "utf8") > PAGE_LIMITS.url) {
        return fail("unsafe_url", "Resolved URL exceeds 2048 bytes.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return fail("unsafe_url", "Only HTTP and HTTPS are permitted.");
    }
    if (
        url.username || url.password || /^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/i.test(input)
        || /^\/\/[^/?#]*@/.test(input)
    ) {
        return fail("unsafe_url", "URLs containing credentials are not permitted.");
    }
    if (url.port) return fail("unsafe_url", "Only the scheme's standard port is permitted.");
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
    if (!hostname) return fail("unsafe_url", "URL has no hostname.");
    if (isIP(hostname)) {
        if (!globalAddress(hostname)) {
            return fail("unsafe_url", "Non-global IP addresses are not permitted.");
        }
    } else if (
        !hostname.includes(".")
        || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|home\.arpa|test|invalid|example|onion)$/
            .test(hostname)
    ) {
        return fail("unsafe_url", "Local and special-use hostnames are not permitted.");
    }
    url.hash = "";
    return url;
}

function abortFailure(signal: AbortSignal): PageFailure {
    const reason = signal.reason;
    const timeout = reason?.name === "TimeoutError" || reason?.kind === "timeout";
    return new PageFailure(
        timeout ? "timeout" : "cancelled",
        timeout ? "Page read deadline exceeded." : "Page read cancelled.",
    );
}

function checkAbort(signal: AbortSignal): void {
    if (signal.aborted) throw abortFailure(signal);
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    checkAbort(signal);
    return await new Promise<T>((resolve, reject) => {
        const abort = () => reject(abortFailure(signal));

        signal.addEventListener("abort", abort, { once: true });
        operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

async function pin(url: URL, adapters: PageAdapters, signal: AbortSignal): Promise<PageAddress> {
    checkAbort(signal);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const literalFamily = isIP(hostname);
    const addresses = literalFamily
        ? [{ address: hostname, family: literalFamily as 4 | 6 }]
        : await abortable(adapters.resolve(hostname, signal), signal);
    checkAbort(signal);
    if (!addresses.length) return fail("transport", "DNS returned no addresses.");
    if (
        addresses.some(({ address, family }) => !globalAddress(address) || isIP(address) !== family)
    ) {
        return fail(
            "unsafe_url",
            "DNS returned a non-global or invalid address; the entire answer was rejected.",
        );
    }
    return addresses[0]!;
}

async function requestPage(
    url: URL,
    address: PageAddress,
    adapters: PageAdapters,
    signal: AbortSignal,
): Promise<http.IncomingMessage> {
    checkAbort(signal);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    // Never re-resolve, retry another address, use a shared agent, or inherit headers.
    const pinnedLookup = ((
        requested: string,
        options: { all?: boolean } | number,
        callback: (...args: unknown[]) => void,
    ) => {
        if (requested.replace(/^\[|\]$/g, "").toLowerCase() !== hostname.toLowerCase()) {
            callback(new Error("Unexpected hostname in pinned lookup."));
        } else if (typeof options === "object" && options.all) {
            callback(null, [{ address: address.address, family: address.family }]);
        } else {
            callback(null, address.address, address.family);
        }
    }) as NonNullable<http.RequestOptions["lookup"]>;
    return await new Promise((resolve, reject) => {
        let req: http.ClientRequest | undefined;
        let response: http.IncomingMessage | undefined;

        const detach = () => signal.removeEventListener("abort", abort);

        const abort = () => {
            const error = abortFailure(signal);
            response?.destroy(error);
            req?.destroy(error);
            reject(error);
            detach();
        };

        signal.addEventListener("abort", abort, { once: true });
        try {
            req = adapters.request(url, {
                method: "GET",
                agent: false,
                lookup: pinnedLookup,
                signal,
                // TLS keeps the original hostname for certificate verification and SNI.
                ...(url.protocol === "https:"
                    ? {
                        servername: isIP(hostname) ? undefined : hostname,
                        rejectUnauthorized: true,
                    }
                    : {}),
                headers: {
                    Accept: "text/html, application/xhtml+xml, text/plain",
                    "Accept-Encoding": "gzip, deflate, br",
                    "User-Agent": "pi-openai-web-page-reader/1.0",
                },
            }, (incoming) => {
                response = incoming;
                incoming.once("close", detach);
                if (signal.aborted) {
                    abort();
                    return;
                }
                resolve(incoming);
            });
            req.once("error", (error) => {
                detach();
                reject(error);
            });
            req.end();
            if (signal.aborted) abort();
        } catch (error) {
            detach();
            reject(error);
        }
    });
}

function header(response: http.IncomingMessage, name: string): string {
    const value = response.headers[name];
    return Array.isArray(value) ? value.join(", ") : value ?? "";
}

function contentInfo(response: http.IncomingMessage): { mime: string; charset: string } {
    const value = header(response, "content-type");
    const mime = value.split(";", 1)[0]!.trim().toLowerCase();
    if (!["text/html", "application/xhtml+xml", "text/plain"].includes(mime)) {
        return fail(
            "unsupported_content",
            "Only declared HTML, XHTML, and plain text are supported.",
        );
    }
    const charset = /;\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(value);
    return { mime, charset: charset ? (charset[1] ?? charset[2] ?? charset[3] ?? "") : "utf-8" };
}

async function bodyBytes(
    response: http.IncomingMessage,
    signal: AbortSignal,
    state: PageReadBase,
): Promise<Buffer> {
    const encoding = header(response, "content-encoding").trim().toLowerCase();
    if (!["", "identity", "gzip", "deflate", "br"].includes(encoding)) {
        return fail("unsupported_content", "Unsupported or stacked Content-Encoding.");
    }
    const declaredSize = Number(header(response, "content-length"));
    if (declaredSize > PAGE_LIMITS.wireBytes) {
        state.truncation.wire = state.truncated = true;
        return fail("incomplete", "Declared response size exceeds the 2 MiB wire limit.");
    }
    let wire = 0;
    let decoded = 0;
    const chunks: Buffer[] = [];
    const cap = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            wire += chunk.length;
            if (wire > PAGE_LIMITS.wireBytes) {
                state.truncation.wire = state.truncated = true;
                callback(new PageFailure("incomplete", "Response exceeds the 2 MiB wire limit."));
            } else callback(null, chunk);
        },
    });
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            decoded += chunk.length;
            if (decoded > PAGE_LIMITS.decodedBytes) {
                state.truncation.decoded = state.truncated = true;
                callback(
                    new PageFailure("incomplete", "Response exceeds the 4 MiB decoded limit."),
                );
            } else {
                chunks.push(Buffer.from(chunk));
                callback();
            }
        },
    });
    const decompressor = encoding === "gzip"
        ? createGunzip()
        : encoding === "deflate"
        ? createInflate()
        : encoding === "br"
        ? createBrotliDecompress()
        : null;
    if (decompressor) await pipeline(response, cap, decompressor, sink, { signal });
    else await pipeline(response, cap, sink, { signal });
    checkAbort(signal);
    if (!response.complete) return fail("incomplete", "HTTP response ended before completion.");
    return Buffer.concat(chunks, decoded);
}

interface ProcessedPage {
    title: string | null;
    challenge: boolean;
    warnings: string[];
    totalLines: number;
    excerpts: PageReadBase["excerpts"];
    matches: PageReadBase["matches"];
    no_match: boolean;
    truncation: { extracted: boolean; matches: boolean };
}

/** CPU work is isolated even when the parser cannot yield; abort waits for worker exit. */
async function processPage(
    bytes: Buffer,
    info: { mime: string; charset: string },
    params: PageReadParams,
    start: number,
    limit: number,
    signal: AbortSignal,
): Promise<ProcessedPage> {
    checkAbort(signal);
    const worker = new Worker(new URL("./processing-worker.mjs", import.meta.url), {
        workerData: {
            bytes,
            ...info,
            params,
            start,
            limit,
            extractedBytes: PAGE_LIMITS.extractedBytes,
        },
        execArgv: [],
        resourceLimits: {
            maxOldGenerationSizeMb: 128,
            maxYoungGenerationSizeMb: 16,
            stackSizeMb: 4,
        },
    });
    return await new Promise<ProcessedPage>((resolve, reject) => {
        let settled = false;

        const finish = (error?: unknown, result?: ProcessedPage) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", abort);
            void worker.terminate().then(() => {
                if (signal.aborted) reject(abortFailure(signal));
                else if (error) reject(error);
                else resolve(result!);
            }, reject);
        };

        const abort = () => finish(abortFailure(signal));

        signal.addEventListener("abort", abort, { once: true });
        worker.once("message", (result: ProcessedPage) => finish(undefined, result));
        worker.once("error", (error) => finish(error));
        worker.once("exit", () => {
            if (!settled) finish(new Error("Page processing worker exited without a result."));
        });
        if (signal.aborted) abort();
    });
}

function positive(value: number | undefined, fallback: number, name: string): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1) {
        return fail("capability", `${name} must be a positive safe integer.`);
    }
    return value;
}

/** Direct, credential-free HTTP reader. Never invokes a model, browser, proxy, or crawler. */
export async function readPage(
    params: PageReadParams,
    options: PageReadOptions = {},
): Promise<PageReadResult> {
    const state: PageReadBase = {
        requestedUrl: typeof params?.url === "string" ? params.url : "",
        finalUrl: null,
        timestamp: new Date().toISOString(),
        title: null,
        totalLines: 0,
        excerpts: [],
        matches: [],
        no_match: false,
        warnings: [],
        completeness: "none",
        truncated: false,
        truncation: { wire: false, decoded: false, extracted: false, matches: false },
    };
    // The caller owns its configured deadline; only standalone calls need a fallback.
    const signal = options.signal ?? AbortSignal.timeout(PAGE_LIMITS.deadlineMs);
    const adapters = { ...nativeAdapters, ...options.adapters };
    let response: http.IncomingMessage | undefined;
    try {
        checkAbort(signal);
        if (!params || (params.action !== "open" && params.action !== "find")) {
            return fail("capability", "Expected action open or find.");
        }
        const start = params.action === "open" ? positive(params.start_line, 1, "start_line") : 1;
        const requestedLimit = params.action === "open"
            ? positive(params.max_lines, 200, "max_lines")
            : positive(params.max_matches, 20, "max_matches");
        const maximum = params.action === "open" ? PAGE_LIMITS.openLines : PAGE_LIMITS.findMatches;
        if (requestedLimit > maximum) {
            return fail(
                "capability",
                `${
                    params.action === "open"
                        ? "max_lines"
                        : "max_matches"
                } must not exceed ${maximum}.`,
            );
        }
        const limit = requestedLimit;
        if (
            params.action === "find"
            && (typeof params.pattern !== "string" || !params.pattern.length
                || (params.case_sensitive !== undefined
                    && typeof params.case_sensitive !== "boolean"))
        ) {
            return fail(
                "capability",
                "find requires a nonempty literal pattern and an optional boolean case_sensitive.",
            );
        }
        let url = safeUrl(params.url);
        for (let redirects = 0;; redirects++) {
            state.finalUrl = url.href;
            const address = await pin(url, adapters, signal);
            response = await requestPage(url, address, adapters, signal);
            const status = response.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
                const location = header(response, "location");
                response.destroy();
                response = undefined;
                if (redirects >= PAGE_LIMITS.redirects) {
                    return fail("http", "Redirect limit (5) exceeded.");
                }
                if (!location) return fail("http", "Redirect has no Location header.");
                const next = safeUrl(location, url);
                if (url.protocol === "https:" && next.protocol === "http:") {
                    return fail("unsafe_url", "HTTPS-to-HTTP redirects are not permitted.");
                }
                url = next;
                continue;
            }
            if (status === 401 || status === 407) {
                return fail(
                    "auth",
                    `HTTP ${status}: authentication is required; no credentials are supplied.`,
                );
            }
            if (status === 429) return fail("rate_limit", "HTTP 429: server rate limit.");
            if ((status < 200 || status >= 300) && status !== 403 && status !== 503) {
                return fail("http", `HTTP ${status}: page was not retrieved.`);
            }
            if (status === 206 || header(response, "content-range")) {
                return fail("incomplete", "Server returned a partial response.");
            }
            let info: { mime: string; charset: string };
            try {
                info = contentInfo(response);
            } catch (error) {
                if (status === 403) {
                    return fail("auth", "HTTP 403: access denied; no credentials are supplied.");
                }
                if (status === 503) return fail("http", "HTTP 503: server unavailable.");
                throw error;
            }
            const bytes = await bodyBytes(response, signal, state);
            const content = await processPage(bytes, info, params, start, limit, signal);
            state.title = content.title;
            state.warnings.push(...content.warnings);
            if (content.challenge) {
                return fail(
                    "capability",
                    "Page is a bot/JavaScript/CAPTCHA challenge; this reader cannot bypass it.",
                );
            }
            if (status === 403) {
                return fail("auth", "HTTP 403: access denied; no credentials are supplied.");
            }
            if (status === 503) return fail("http", "HTTP 503: server unavailable.");
            state.totalLines = content.totalLines;
            state.excerpts = content.excerpts;
            state.matches = content.matches;
            state.no_match = content.no_match;
            Object.assign(state.truncation, content.truncation);
            state.truncated = content.truncation.extracted || content.truncation.matches;
            state.completeness = state.truncation.extracted ? "partial" : "complete";
            checkAbort(signal);
            return { ...state, ok: true };
        }
    } catch (error) {
        const failure = signal.aborted ? abortFailure(signal) : error instanceof PageFailure
            ? error
            : new PageFailure(
                "transport",
                "HTTP, DNS, stream, or decompression failure; page was not retrieved.",
            );
        state.completeness = "none";
        return { ...state, ok: false, error: { kind: failure.kind, message: failure.message } };
    } finally {
        response?.destroy();
    }
}
