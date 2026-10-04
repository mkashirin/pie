import { createJiti } from "jiti";
import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { PAGE_LIMITS, readPage } from "../src/page/index.ts";

const PUBLIC = { address: "93.184.216.34", family: 4 };

const html = (body, title = "Fixture") =>
    `<html><head><title>${title}</title></head><body>${body}</body></html>`;

/** Entirely offline: only the low-level resolver/request are replaced, never validation. */
function fixture(pages, options = {}) {
    const requests = [];
    const lookups = [];
    const destroyed = [];
    let index = 0;
    return {
        requests,
        lookups,
        destroyed,
        adapters: {
            async resolve(hostname, signal) {
                lookups.push(hostname);
                return options.resolve ? await options.resolve(hostname, signal) : [PUBLIC];
            },
            request(url, requestOptions, onResponse) {
                const page = pages[index++];
                assert.ok(page, `Unexpected request: ${url.href}`);
                const record = { url: url.href, options: requestOptions, pinned: null };
                requests.push(record);
                requestOptions.lookup(
                    url.hostname.replace(/^\[|\]$/g, ""),
                    { all: true },
                    (error, addresses) => {
                        assert.ifError(error);
                        record.pinned = addresses;
                    },
                );
                const request = new EventEmitter();
                let response;
                request.end = () =>
                    queueMicrotask(() => {
                        if (page.error) {
                            request.emit("error", page.error);
                            return;
                        }
                        if (page.stallHeaders) return;
                        response = page.bodyError
                            ? Readable.from((async function*() {
                                yield Buffer.from("partial");
                                throw page.bodyError;
                            })())
                            : page.stall
                            ? new Readable({ read() {} })
                            : Readable.from(
                                page.chunks ?? [
                                    Buffer.isBuffer(page.body)
                                        ? page.body
                                        : Buffer.from(page.body ?? ""),
                                ],
                            );
                        response.statusCode = page.status ?? 200;
                        response.headers = {
                            "content-type": "text/html; charset=utf-8",
                            ...page.headers,
                        };
                        response.complete = page.complete ?? true;
                        onResponse(response);
                    });
                request.destroy = (error) => {
                    destroyed.push(url.href);
                    response?.destroy();
                    if (error) request.emit("error", error);
                    return request;
                };
                return request;
            },
        },
    };
}

async function run(params, pages, options) {
    const f = fixture(pages, options);
    const result = await readPage(params, { adapters: f.adapters });
    return { result, ...f };
}

const open = (extra = {}) => ({ action: "open", url: "https://public.site/page", ...extra });

const find = (pattern, extra = {}) => ({
    action: "find",
    url: "https://public.site/page",
    pattern,
    ...extra,
});

// No environment credentials, sockets, local servers, browser, or model are used by these tests.
test("extracts substantive main, title/entities and stable lines without executable/noncontent", async () => {
    const body = `<nav>Navigation</nav><header>Header</header><main><h1>Report &amp; context</h1>
    <p>${"Substantive content. ".repeat(8)}<strong>Important</strong></p>
    <p>Second<br>Third</p><script>secretScript()</script><style>.secret{}</style>
    <div hidden>hidden secret</div><div aria-hidden="true">aria secret</div>
    <template>template secret</template><iframe>frame secret</iframe><form>form secret</form>
    </main><aside>Aside</aside><footer>Footer</footer><p>Outside region</p>`;
    const { result } = await run(open(), [{ body: html(body, "A &amp; B") }]);
    assert.equal(result.ok, true);
    assert.equal(result.title, "A & B");
    assert.equal(result.excerpts[0].startLine, 1);
    assert.equal(result.excerpts[0].endLine, result.totalLines);
    assert.equal(result.totalLines, 4);
    assert.match(result.excerpts[0].text, /^Report & context\nSubstantive/);
    assert.match(result.excerpts[0].text, /Important\nSecond\nThird$/);
    assert.doesNotMatch(result.excerpts[0].text, /secret|Navigation|Footer|Outside/);
    assert.equal(result.completeness, "complete");
    assert.equal(result.truncated, false);
    assert.ok(result.warnings.length);
    assert.ok(!Number.isNaN(Date.parse(result.timestamp)));
});

test("falls back to body for short main; XHTML is parsed without execution", async () => {
    const a = await run(open(), [{ body: html("<main>Short</main><p>Body retained</p>") }]);
    assert.equal(a.result.excerpts[0].text, "Short\nBody retained");
    const b = await run(open(), [{
        body:
            "<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>XHTML</title></head><body><p>One &amp; two</p><script>no()</script><p>Three</p></body></html>",
        headers: { "content-type": "application/xhtml+xml" },
    }]);
    assert.equal(b.result.title, "XHTML");
    assert.equal(b.result.excerpts[0].text, "One & two\nThree");
});

test("plain text, declared charset, unsupported charset fallback", async () => {
    const a = await run(open(), [{
        body: Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]),
        headers: { "content-type": "text/plain; charset=windows-1252" },
    }]);
    assert.equal(a.result.excerpts[0].text, "café €");
    const b = await run(open(), [{
        body: "<not HTML>\r\n next\tline\n\nlast",
        headers: { "content-type": "text/plain; charset=made-up-charset" },
    }]);
    assert.equal(b.result.excerpts[0].text, "<not HTML>\nnext line\nlast");
    assert.match(b.result.warnings.join(" "), /Unsupported charset.*UTF-8/);
    const c = await run(open(), [{
        body: Buffer.from("hello λ", "utf16le"),
        headers: { "content-type": "text/plain; charset=\"utf-16le\"" },
    }]);
    assert.equal(c.result.excerpts[0].text, "hello λ");
});

test("declared legacy charset aliases preserve Windows-1252 punctuation in HTML and text", async () => {
    const punctuation = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x80 + i));
    // Undefined Windows-1252 slots remain controls and are intentionally cleaned.
    const expected = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
    for (const charset of ["windows-1252", "ISO-8859-1", "latin1", "US-ASCII", " Cp1252 "]) {
        for (const mime of ["text/plain", "text/html"]) {
            const body = mime === "text/html"
                ? Buffer.concat([Buffer.from("<p>"), punctuation, Buffer.from("</p>")])
                : punctuation;
            const { result } = await run(open(), [{
                body,
                headers: { "content-type": `${mime}; charset="${charset}"` },
            }]);
            assert.equal(result.ok, true);
            assert.equal(result.excerpts[0].text, expected, `${mime}; ${charset}`);
            assert.doesNotMatch(result.warnings.join(" "), /Unsupported charset/);
        }
    }
});

test("open defaults, bounded line windows and beyond-end empty", async () => {
    const body = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join("\n");
    const page = { body, headers: { "content-type": "text/plain" } };
    const a = await run(open(), [page]);
    assert.equal(a.result.totalLines, 600);
    assert.equal(a.result.excerpts[0].endLine, 200);
    const b = await run(open({ start_line: 595, max_lines: 20 }), [page]);
    assert.deepEqual(b.result.excerpts[0], {
        startLine: 595,
        endLine: 600,
        text: body.split("\n").slice(594).join("\n"),
    });
    const c = await run(open({ start_line: 601 }), [page]);
    assert.deepEqual(c.result.excerpts, []);
    assert.equal(c.result.totalLines, 600);
    const d = await run(open({ max_lines: 500 }), [page]);
    assert.equal(d.result.excerpts[0].endLine, 500);
    const invalid = await run(open({ max_lines: 501 }), []);
    assert.equal(invalid.result.error.kind, "capability");
    assert.equal(invalid.requests.length, 0);
});

test("find is literal, case insensitive by default, bounded and merges two-line contexts", async () => {
    const body =
        "zero\none\nA.b hit\nthree\na.B again\nfive\nsix\nseven\neight\nnine\nA.b last\neleven\ntwelve\nthirteen";
    const page = { body, headers: { "content-type": "text/plain" } };
    const a = await run(find("a.b"), [page]);
    assert.equal(a.result.ok, true);
    assert.deepEqual(a.result.matches.map((m) => m.line), [3, 5, 11]);
    assert.deepEqual(a.result.excerpts.map((e) => [e.startLine, e.endLine]), [[1, 7], [9, 13]]);
    const b = await run(find("a.B", { case_sensitive: true }), [page]);
    assert.deepEqual(b.result.matches, [{ line: 5, column: 1, text: "a.B" }]);
    const c = await run(find("[regex]?"), [page]);
    assert.equal(c.result.ok, true);
    assert.equal(c.result.no_match, true);
    assert.deepEqual(c.result.excerpts, []);
    const many = { body: "word ".repeat(70), headers: { "content-type": "text/plain" } };
    const d = await run(find("word"), [many]);
    assert.equal(d.result.matches.length, 20);
    assert.equal(d.result.truncation.matches, true);
    const e = await run(find("word", { max_matches: 50 }), [many]);
    assert.equal(e.result.matches.length, 50);
    const invalid = await run(find("word", { max_matches: 51 }), []);
    assert.equal(invalid.result.error.kind, "capability");
    assert.equal(invalid.requests.length, 0);
});

test("find metacharacters stay literal and matches have one-based columns", async () => {
    const { result } = await run(find("[x]+.*?\\$"), [{
        body: "prefix [x]+.*?\\$ suffix",
        headers: { "content-type": "text/plain" },
    }]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].column, 8);
});

test("redirects revalidate/re-resolve and pin sockets while preserving TLS hostname", async () => {
    let dns = 0;
    const { result, requests, lookups } = await run(open(), [
        { status: 302, headers: { location: "/next", "set-cookie": "secret=server" } },
        { status: 307, headers: { location: "https://other.site/final" } },
        { body: html("<p>Final content</p>") },
    ], {
        resolve: async () => [{ address: dns++ === 0 ? "93.184.216.34" : "1.1.1.1", family: 4 }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.requestedUrl, "https://public.site/page");
    assert.equal(result.finalUrl, "https://other.site/final");
    assert.deepEqual(lookups, ["public.site", "public.site", "other.site"]);
    assert.deepEqual(requests.map((r) => r.pinned[0].address), [
        "93.184.216.34",
        "1.1.1.1",
        "1.1.1.1",
    ]);
    for (const r of requests) {
        assert.equal(r.options.agent, false);
        assert.equal(r.options.method, "GET");
        assert.equal(r.options.rejectUnauthorized, true);
        assert.equal(r.options.servername, new URL(r.url).hostname);
        assert.deepEqual(Object.keys(r.options.headers).sort(), [
            "Accept",
            "Accept-Encoding",
            "User-Agent",
        ]);
        assert.equal(r.options.headers.Authorization, undefined);
        assert.equal(r.options.headers.Cookie, undefined);
    }
    const single = requests[0];
    single.options.lookup("public.site", { all: false }, (error, address, family) => {
        assert.ifError(error);
        assert.equal(address, PUBLIC.address);
        assert.equal(family, 4);
    });
    single.options.lookup("unexpected.site", {}, (error) => assert.ok(error));
    assert.equal(lookups.length, 3, "custom lookup never re-resolves DNS");
});

test("redirect limit and downgrade/private/credential targets fail before a further request", async () => {
    for (
        const [location, kind] of [
            ["http://public.site/down", "unsafe_url"],
            ["https://127.0.0.1/admin", "unsafe_url"],
            ["https://user:password@public.site", "unsafe_url"],
            ["file:///etc/passwd", "unsafe_url"],
            ["https://private.site", "unsafe_url"],
        ]
    ) {
        const { result, requests } = await run(open(), [{ status: 302, headers: { location } }], {
            resolve: async (host) =>
                host === "private.site" ? [{ address: "10.1.2.3", family: 4 }] : [PUBLIC],
        });
        assert.equal(result.error.kind, kind, location);
        assert.equal(requests.length, 1);
    }
    const loop = await run(
        open(),
        Array.from({ length: 6 }, () => ({ status: 302, headers: { location: "/loop" } })),
    );
    assert.equal(loop.result.error.kind, "http");
    assert.equal(loop.requests.length, 6);
    const missing = await run(open(), [{ status: 302 }]);
    assert.equal(missing.result.error.kind, "http");
});

test("rejects unsafe URLs and non-global literal IPv4/IPv6 without DNS or HTTP", async () => {
    const unsafe = [
        "file:///etc/passwd",
        "ftp://public.site",
        "http://localhost",
        "http://localhost.",
        "http://a.localhost",
        "http://router",
        "http://a.local",
        "http://a.internal",
        "http://home.arpa",
        "http://public.site:8080",
        "https://public.site:80",
        "http://u:p@public.site",
        "http://@public.site",
        "http://127.0.0.1",
        "http://2130706433",
        "http://0177.0.0.1",
        "http://0x7f000001",
        "http://10.0.0.1",
        "http://172.31.0.1",
        "http://192.168.1.1",
        "http://169.254.169.254",
        "http://100.64.0.1",
        "http://0.0.0.0",
        "http://224.0.0.1",
        "http://240.1.2.3",
        "http://192.0.2.1",
        "http://198.18.0.1",
        "http://203.0.113.1",
        "http://[::1]",
        "http://[::]",
        "http://[fc00::1]",
        "http://[fe80::1]",
        "http://[ff02::1]",
        "http://[::ffff:127.0.0.1]",
        "http://[::ffff:10.0.0.1]",
        "http://[2001:db8::1]",
        "http://[2002:7f00:1::]",
        "http://[64:ff9b::7f00:1]",
        "http://[3fff::1]",
        `https://public.site/${"x".repeat(2048)}`,
    ];
    for (const url of unsafe) {
        const { result, requests, lookups } = await run(open({ url }), []);
        assert.equal(result.ok, false, url);
        assert.equal(result.error.kind, "unsafe_url", url);
        assert.equal(requests.length, 0, url);
        assert.equal(lookups.length, 0, url);
    }
});

test("rejects entire DNS answer on any unsafe address, IPv6 mapping or invalid family", async () => {
    for (
        const bad of [
            { address: "127.0.0.1", family: 4 },
            { address: "192.168.0.1", family: 4 },
            { address: "::1", family: 6 },
            { address: "::ffff:192.168.0.1", family: 6 },
            { address: "2001:db8::1", family: 6 },
            { address: PUBLIC.address, family: 6 },
            { address: "not-an-ip", family: 4 },
        ]
    ) {
        const { result, requests } = await run(open(), [], { resolve: async () => [PUBLIC, bad] });
        assert.equal(result.error.kind, "unsafe_url", bad.address);
        assert.equal(requests.length, 0);
    }
    const empty = await run(open(), [], { resolve: async () => [] });
    assert.equal(empty.result.error.kind, "transport");
});

test("public IPv6 and mapped-public literals pin without DNS", async () => {
    for (const url of ["https://[2606:4700:4700::1111]/", "http://[::ffff:93.184.216.34]/"]) {
        const { result, requests, lookups } = await run(open({ url }), [{
            body: "hello",
            headers: { "content-type": "text/plain" },
        }]);
        assert.equal(result.ok, true, url);
        assert.equal(lookups.length, 0);
        assert.equal(requests[0].pinned[0].family, 6);
    }
});

test("DNS rebinding on a same-host redirect is rejected; pinned lookup cannot rebind", async () => {
    let lookups = 0;
    const { result, requests } = await run(open(), [{
        status: 302,
        headers: { location: "/again" },
    }], {
        resolve: async () => ++lookups === 1 ? [PUBLIC] : [{ address: "127.0.0.1", family: 4 }],
    });
    assert.equal(result.error.kind, "unsafe_url");
    assert.equal(requests.length, 1);
    assert.equal(lookups, 2);
});

test("gzip/deflate/brotli streaming decompression and both byte caps", async () => {
    const raw = Buffer.from(html("<p>compressed café</p>"));
    for (
        const [encoding, compress] of [["gzip", gzipSync], ["deflate", deflateSync], [
            "br",
            brotliCompressSync,
        ]]
    ) {
        const encoded = compress(raw);
        const { result } = await run(open(), [{
            chunks: [encoded.subarray(0, 5), encoded.subarray(5)],
            headers: { "content-encoding": encoding },
        }]);
        assert.equal(result.ok, true, encoding);
        assert.equal(result.excerpts[0].text, "compressed café");
    }
    const wire = await run(open(), [{
        chunks: [Buffer.alloc(PAGE_LIMITS.wireBytes), Buffer.from("x")],
        headers: { "content-type": "text/plain" },
    }]);
    assert.equal(wire.result.error.kind, "incomplete");
    assert.equal(wire.result.truncation.wire, true);
    const announced = await run(open(), [{
        headers: { "content-length": String(PAGE_LIMITS.wireBytes + 1) },
    }]);
    assert.equal(announced.result.error.kind, "incomplete");
    const bomb = await run(open(), [{
        body: gzipSync(Buffer.alloc(PAGE_LIMITS.decodedBytes + 1, 97)),
        headers: { "content-encoding": "gzip" },
    }]);
    assert.equal(bomb.result.error.kind, "incomplete");
    assert.equal(bomb.result.truncation.decoded, true);
    const corrupt = await run(open(), [{
        body: Buffer.from("invalid gzip"),
        headers: { "content-encoding": "gzip" },
    }]);
    assert.equal(corrupt.result.error.kind, "transport");
});

test("100 KiB extraction cap is UTF-8 safe and no_match never overclaims", async () => {
    const body = "λ".repeat(PAGE_LIMITS.extractedBytes) + "\nneedle";
    const page = { body, headers: { "content-type": "text/plain" } };
    const a = await run(open(), [page]);
    assert.equal(a.result.ok, true);
    assert.equal(a.result.completeness, "partial");
    assert.equal(a.result.truncation.extracted, true);
    assert.ok(Buffer.byteLength(a.result.excerpts[0].text) <= PAGE_LIMITS.extractedBytes);
    assert.doesNotMatch(a.result.excerpts[0].text, /�/);
    const b = await run(find("needle"), [page]);
    assert.equal(b.result.ok, true);
    assert.equal(b.result.no_match, false);
    assert.equal(b.result.matches.length, 0);
    assert.match(b.result.warnings.join(" "), /absence cannot be established/);
});

test("unsupported content/encoding, auth, HTTP, rate-limit and challenge outcomes are honest", async () => {
    for (
        const [page, kind] of [
            [{ headers: { "content-type": "application/pdf" } }, "unsupported_content"],
            [{ headers: { "content-type": "application/json" } }, "unsupported_content"],
            [{ headers: { "content-type": "" } }, "unsupported_content"],
            [{ headers: { "content-encoding": "gzip, br" } }, "unsupported_content"],
            [{ status: 401 }, "auth"],
            [{ status: 407 }, "auth"],
            [{ status: 403 }, "auth"],
            [{ status: 429 }, "rate_limit"],
            [{ status: 404 }, "http"],
            [{ status: 503 }, "http"],
            [{ status: 206, body: "partial" }, "incomplete"],
            [{ complete: false, body: "interrupted" }, "incomplete"],
            [{ body: html("<p>Verify you are human</p>", "Just a moment...") }, "capability"],
            [{
                status: 503,
                body: html("<script src=\"/cdn-cgi/challenge-platform/foo\"></script>"),
            }, "capability"],
            [{ status: 403, body: html("<p>Checking your browser</p>") }, "capability"],
            [{ error: new Error("socket error with sensitive details") }, "transport"],
            [{ bodyError: new Error("body error with sensitive details") }, "transport"],
        ]
    ) {
        const { result } = await run(open(), [page]);
        assert.equal(result.ok, false);
        assert.equal(result.error.kind, kind, JSON.stringify(page));
        assert.equal(result.completeness, "none");
        assert.deepEqual(result.excerpts, []);
        assert.doesNotMatch(result.error.message, /sensitive details/);
    }
});

test("signal/deadline covers DNS, reads and redirect chain without subsequent requests", async () => {
    const already = new AbortController();
    already.abort();
    const a = fixture([]);
    assert.equal(
        (await readPage(open(), { signal: already.signal, adapters: a.adapters })).error.kind,
        "cancelled",
    );
    assert.equal(a.lookups.length, 0);
    const dnsAbort = new AbortController();
    const b = fixture([], {
        resolve: async () => {
            dnsAbort.abort();
            return new Promise(() => {});
        },
    });
    const dnsResult = await readPage(open(), { signal: dnsAbort.signal, adapters: b.adapters });
    assert.equal(dnsResult.error.kind, "cancelled");
    assert.equal(b.requests.length, 0);
    const stalled = fixture([{ stall: true }]);
    const controller = new AbortController();
    const pending = readPage(open(), { signal: controller.signal, adapters: stalled.adapters });
    setImmediate(() => controller.abort());
    assert.equal((await pending).error.kind, "cancelled");
    assert.ok(stalled.destroyed.length);
    const deadline = fixture([{ stall: true }]);
    const timeout = new AbortController();
    const waiting = readPage(open(), { signal: timeout.signal, adapters: deadline.adapters });
    setImmediate(() => timeout.abort(new DOMException("deadline", "TimeoutError")));
    assert.equal((await waiting).error.kind, "timeout");
    let count = 0;
    const redirectSignal = new AbortController();
    const redirect = fixture([{ status: 302, headers: { location: "/second" } }], {
        resolve: async () => {
            if (++count === 2) redirectSignal.abort();
            return [PUBLIC];
        },
    });
    const redirected = await readPage(open(), {
        signal: redirectSignal.signal,
        adapters: redirect.adapters,
    });
    assert.equal(redirected.error.kind, "cancelled");
    assert.equal(redirect.requests.length, 1);
});

test("caller deadline is preserved; only calls without a signal get the 30-second fallback", async (t) => {
    const timeouts = [];
    t.mock.method(AbortSignal, "timeout", (milliseconds) => {
        timeouts.push(milliseconds);
        return new AbortController().signal;
    });
    const caller = new AbortController();
    const configured = fixture([{
        body: "caller deadline",
        headers: { "content-type": "text/plain" },
    }]);
    const result = await readPage(open(), { signal: caller.signal, adapters: configured.adapters });
    assert.equal(result.ok, true);
    assert.equal(configured.requests[0].options.signal, caller.signal);
    assert.deepEqual(
        timeouts,
        [],
        "caller-owned deadlines must not acquire a shorter internal timer",
    );
    const standalone = fixture([{ body: "fallback", headers: { "content-type": "text/plain" } }]);
    assert.equal((await readPage(open(), { adapters: standalone.adapters })).ok, true);
    assert.deepEqual(timeouts, [30_000]);
});

test("explicit standard ports normalize and credential-free public DNS IPv6 pins", async () => {
    for (const url of ["http://public.site:80/page", "https://public.site:443/page"]) {
        const { result, requests } = await run(open({ url }), [{
            body: html("<p>standard port</p>"),
        }], {
            resolve: async () => [{ address: "2606:4700:4700::1111", family: 6 }, PUBLIC],
        });
        assert.equal(result.ok, true, url);
        assert.equal(new URL(result.finalUrl).port, "");
        assert.equal(requests[0].pinned[0].family, 6);
    }
});

test("abort covers pending response headers and decompression streams", async () => {
    for (
        const page of [{ stallHeaders: true }, {
            stall: true,
            headers: { "content-encoding": "gzip" },
        }]
    ) {
        const f = fixture([page]);
        const controller = new AbortController();
        const pending = readPage(open(), { signal: controller.signal, adapters: f.adapters });
        setImmediate(() => controller.abort());
        const result = await pending;
        assert.equal(result.error.kind, "cancelled");
        assert.equal(result.completeness, "none");
        assert.ok(f.destroyed.length);
    }
    const dns = await run(open(), [], {
        resolve: async () => {
            throw new Error("sensitive DNS details");
        },
    });
    assert.equal(dns.result.error.kind, "transport");
    assert.doesNotMatch(dns.result.error.message, /sensitive/);
});

test("find exact limit is complete, defaults to 20, and literal matching handles Unicode", async () => {
    const page = {
        body: "word ".repeat(20) + "\nÉlan λ",
        headers: { "content-type": "text/plain" },
    };
    const exact = await run(find("word"), [page]);
    assert.equal(exact.result.matches.length, 20);
    assert.equal(exact.result.truncation.matches, false);
    const unicode = await run(find("élan"), [page]);
    assert.deepEqual(unicode.result.matches, [{ line: 2, column: 1, text: "Élan" }]);
});

test("normal CAPTCHA articles, widgets and technical explanations are not challenges", async () => {
    for (
        const page of [
            {
                body: html(
                    `<article><h1>CAPTCHA integration guide</h1><p>${
                        "Meaningful implementation guidance. ".repeat(12)
                    }</p><p>Use g-recaptcha or h-captcha in your application.</p></article><form><div class="g-recaptcha"></div></form>`,
                ),
            },
            {
                body: html(
                    "<form><p>Contact us</p><div class='g-recaptcha'></div></form><p>Ordinary public contact information.</p>",
                ),
            },
            {
                body:
                    "This technical explanation covers g-recaptcha integration, hcaptcha and challenge-platform implementations.",
                headers: { "content-type": "text/plain" },
            },
            {
                body: html(
                    "<article><h1>Understanding checking your browser messages</h1><p>Verify you are human is a common CAPTCHA instruction, not an instruction from this article.</p></article>",
                ),
            },
        ]
    ) {
        const { result } = await run(open(), [page]);
        assert.equal(result.ok, true);
        assert.equal(result.completeness, "complete");
        assert.ok(result.excerpts.length);
    }
});

test("999-byte CAPTCHA UX documentation with an instructional heading supports open and find", async () => {
    const paragraphs = [
        "This heading is an integration example, not an access restriction. This documentation explains CAPTCHA UX for public applications.",
        "Provide an accessible alternative for visitors who cannot complete a visual puzzle. Support keyboard navigation and meaningful focus indicators.",
        "Explain why verification is requested and what information is collected. Keep the instructions readable and avoid surprise redirects.",
        "Preserve entered data when a verification attempt fails. Offer a clear retry action and a contact route for people who need assistance.",
        "Measure completion rates across assistive technologies and slow connections. Test recovery paths before deploying the integration.",
    ];
    const prefix = "<article><h1>Verify you are human</h1>"
        + paragraphs.map((p) => `<p>${p}</p>`).join("");
    const base = html(`${prefix}<p></p></article>`, "CAPTCHA UX documentation");
    const guidance =
        "Document expected behavior, error states, privacy choices, and accessible recovery steps. "
            .repeat(4);
    const body = html(
        `${prefix}<p>${guidance.slice(0, 999 - Buffer.byteLength(base))}</p></article>`,
        "CAPTCHA UX documentation",
    );
    assert.equal(Buffer.byteLength(body), 999);
    for (const params of [open(), find("keyboard navigation")]) {
        const { result } = await run(params, [{ body }]);
        assert.equal(result.ok, true);
        assert.equal(result.completeness, "complete");
        assert.match(result.excerpts[0].text, /Verify you are human/);
        assert.match(result.warnings.join(" "), /heuristic detection cannot establish/);
        if (params.action === "find") {
            assert.equal(result.no_match, false);
            assert.equal(result.matches[0].text, "keyboard navigation");
        }
    }
});

test("compact article/main instructional headings retain useful explanatory content", async () => {
    for (const tag of ["article", "main"]) {
        const body = html(
            `<${tag}><h1>Verify you are human</h1><p>This example heading explains accessible verification UX. Offer keyboard controls and a recovery path for every visitor.</p></${tag}>`,
        );
        assert.ok(Buffer.byteLength(body) < 400);
        for (const params of [open(), find("recovery path")]) {
            const { result } = await run(params, [{ body }]);
            assert.equal(result.ok, true);
            assert.match(result.excerpts[0].text, /recovery path/);
            if (params.action === "find") assert.equal(result.no_match, false);
        }
    }
});

test("substantive text surrounding an instruction without semantic regions is ambiguous, not blocked", async () => {
    const body = html(
        "<h1>Checking your browser</h1><p>This documentation explains the message shown during verification and describes how to troubleshoot accessibility problems.</p><p>Use a keyboard-accessible alternative and preserve entered data while offering a clear recovery path for visitors.</p>",
    );
    const { result } = await run(find("accessibility"), [{ body }]);
    assert.equal(result.ok, true);
    assert.equal(result.no_match, false);
    assert.match(result.warnings.join(" "), /Possible challenge instruction/);
});

test("strong interstitial signals still fail with substantive and long main/article text", async () => {
    for (const tag of ["main", "article"]) {
        for (const long of [false, true]) {
            for (
                const marker of [
                    "<script src='/cdn-cgi/challenge-platform/check.js'></script>",
                    "<div id='cf-chl-widget'></div>",
                ]
            ) {
                const body = html(
                    `${marker}<${tag}><h1>Verify you are human</h1><p>${
                        "Complete verification before accessing the requested page. ".repeat(
                            long ? 45 : 3,
                        )
                    }</p></${tag}>`,
                );
                for (const params of [open(), find("absent")]) {
                    const { result } = await run(params, [{ body }]);
                    assert.equal(result.ok, false);
                    assert.equal(result.error.kind, "capability");
                    assert.equal(result.no_match, false);
                    assert.deepEqual(result.excerpts, []);
                }
            }
        }
    }
    const titled = await run(open(), [{
        body: html(
            `<main><h1>Checking your browser</h1><p>${
                "Please wait for verification. ".repeat(100)
            }</p></main>`,
            "Just a moment...",
        ),
    }]);
    assert.equal(titled.result.error.kind, "capability");
});

test("visible interstitial after a 66 KiB comment fails before open/find absence claims", async () => {
    const body = `<html><head><!--${
        "x".repeat(66000)
    }--></head><body><p>Checking your browser</p></body></html>`;
    for (const params of [open(), find("absent")]) {
        const { result } = await run(params, [{ body }]);
        assert.equal(result.ok, false);
        assert.equal(result.error.kind, "capability");
        assert.equal(result.no_match, false);
        assert.deepEqual(result.excerpts, []);
    }
});

test("multiline literals map start coordinates and include context through the matched end", async () => {
    const exact = await run(find("alpha\nbeta"), [{
        body: "alpha\nbeta",
        headers: { "content-type": "text/plain" },
    }]);
    assert.deepEqual(exact.result.matches, [{ line: 1, column: 1, text: "alpha\nbeta" }]);
    assert.equal(exact.result.no_match, false);
    assert.equal(exact.result.excerpts[0].text, "alpha\nbeta");
    const body = "before\nprefix ALPHA\nbeta\ngamma\ndelta\nomega suffix\nafter\nlast\nend";
    const spanning = await run(find("alpha\nbeta\ngamma\ndelta\nomega"), [{
        body,
        headers: { "content-type": "text/plain" },
    }]);
    assert.deepEqual(spanning.result.matches, [{
        line: 2,
        column: 8,
        text: "ALPHA\nbeta\ngamma\ndelta\nomega",
    }]);
    assert.deepEqual(spanning.result.excerpts, [{
        startLine: 1,
        endLine: 8,
        text: body.split("\n").slice(0, 8).join("\n"),
    }]);
    const absent = await run(find("alpha\nmissing"), [{
        body,
        headers: { "content-type": "text/plain" },
    }]);
    assert.equal(absent.result.no_match, true);
    const normalized = await run(find("alpha\nbeta"), [{
        body: html("<p> alpha </p><p>beta</p>"),
    }]);
    assert.equal(normalized.result.matches[0].text, "alpha\nbeta");
});

test("hostile nested HTML obeys the 1-second CPU deadline while the host keeps ticking", async () => {
    const body = `<html><body>${"<div>".repeat(30000)}hi${"</div>".repeat(30000)}</body></html>`;
    assert.equal(Buffer.byteLength(body), 330028);
    const f = fixture([{ body }]);
    const controller = new AbortController();
    let ticks = 0;
    const tick = setInterval(() => ticks++, 10);
    const timeout = setTimeout(
        () => controller.abort(new DOMException("deadline", "TimeoutError")),
        1000,
    );
    const started = performance.now();
    try {
        const result = await readPage(open(), { adapters: f.adapters, signal: controller.signal });
        assert.ok(performance.now() - started < 1800, "worker cancellation must return promptly");
        assert.ok(ticks >= 5, "CPU parsing must not block the host event loop");
        if (!result.ok) assert.equal(result.error.kind, "timeout");
        else {assert.equal(
                result.excerpts[0].text,
                "hi",
                "fast platforms may finish before the deadline",
            );}
    } finally {
        clearInterval(tick);
        clearTimeout(timeout);
    }
});

test("cancellation during CPU parsing terminates the worker before returning", async () => {
    const active = new Set();
    const controller = new AbortController();
    let spawned = 0;
    let abortTimer;
    const hook = createHook({
        init(id, type) {
            if (type === "WORKER") {
                active.add(id);
                spawned++;
                abortTimer = setTimeout(() => controller.abort(), 100);
            }
        },
        destroy(id) {
            active.delete(id);
        },
    }).enable();
    try {
        const f = fixture([{ body: html(`${"<div>".repeat(30000)}hi${"</div>".repeat(30000)}`) }]);
        const started = performance.now();
        const result = await readPage(find("hi"), {
            adapters: f.adapters,
            signal: controller.signal,
        });
        assert.equal(result.error.kind, "cancelled");
        assert.ok(performance.now() - started < 1000);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(spawned, 1);
        assert.equal(active.size, 0, "no worker survives cancellation");
    } finally {
        clearTimeout(abortTimer);
        hook.disable();
    }
});

test("installed jiti loads the page module and resolves its shipped native worker", async () => {
    const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
    const loaded = await jiti.import("../src/page/index.ts");
    const f = fixture([{ body: html("<p>Worker path works</p>") }]);
    const result = await loaded.readPage(open(), { adapters: f.adapters });
    assert.equal(result.ok, true);
    assert.equal(result.excerpts[0].text, "Worker path works");
});

test("invalid operation/window/find parameters fail before network", async () => {
    for (
        const params of [
            open({ start_line: 0 }),
            open({ max_lines: -1 }),
            open({ start_line: 1.5 }),
            find(""),
            find("x", { max_matches: 0 }),
            find("x", { case_sensitive: "yes" }),
            { action: "crawl", url: "https://public.site" },
        ]
    ) {
        const { result, requests } = await run(params, []);
        assert.equal(result.error.kind, "capability");
        assert.equal(requests.length, 0);
    }
});
