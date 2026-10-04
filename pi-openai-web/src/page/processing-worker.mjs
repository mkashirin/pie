import { load } from "cheerio";
import { parentPort, workerData } from "node:worker_threads";

// Shipped native ESM: no TypeScript loader, browser, network, or executable page content.
const { bytes, charset, mime, params, start, limit, extractedBytes } = workerData;
const warnings = [];
let decoder;
try {
    decoder = new TextDecoder(charset);
} catch {
    warnings.push(
        `Unsupported charset ${charset.slice(0, 80)}; decoded as UTF-8 with replacement.`,
    );
    decoder = new TextDecoder("utf-8");
}
// Node 22.19's TextDecoder reports windows-1252 but maps its C1 bytes to
// controls (which clean() removes). Decode this canonical encoding explicitly
// so all accepted aliases follow the HTML/WHATWG mapping on every runtime.
const windows1252C1 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const source = decoder.encoding === "windows-1252"
    ? Buffer.from(bytes).toString("latin1").replace(
        /[\u0080-\u009f]/g,
        (character) => windows1252C1[character.charCodeAt(0) - 0x80],
    )
    : decoder.decode(bytes);

const clean = (text) =>
    text.replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
        .split("\n").map((line) => line.replace(/[^\S\n]+/g, " ").trim()).filter(Boolean)
        .join("\n");

const blocks = new Set(
    "address article blockquote dd div dl dt fieldset figcaption figure h1 h2 h3 h4 h5 h6 hr li main ol p pre section table tbody thead tfoot tr ul"
        .split(" "),
);
const omitted = new Set(
    "script style noscript template svg canvas iframe object embed nav header footer aside form button input select textarea head"
        .split(" "),
);

const invisible = (node) =>
    node.attribs
    && (Object.hasOwn(node.attribs, "hidden") || node.attribs["aria-hidden"] === "true");

// Iterative traversal avoids recursive text/selector operations and quadratic string joins.
function textOf(root, omit = true) {
    const parts = [];
    const stack = [{ node: root, end: false }];
    while (stack.length) {
        const { node, end } = stack.pop();
        if (end) {
            parts.push(blocks.has(node.name) ? "\n" : " ");
            continue;
        }
        if (node.type === "text") {
            parts.push(node.data ?? "");
            continue;
        }
        if (node.type === "comment" || node.type === "directive") continue;
        if (omit && (omitted.has(node.name) || invisible(node))) continue;
        if (node.name === "br" || node.name === "hr") {
            parts.push("\n");
            continue;
        }
        if (blocks.has(node.name)) parts.push("\n");
        if (blocks.has(node.name) || node.name === "td" || node.name === "th") {
            stack.push({ node, end: true });
        }
        for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) {
            stack.push({ node: node.children[i], end: false });
        }
    }
    return clean(parts.join(""));
}

let title = null;
let text;
let visible;
let strongMarkup = false;
let selectedRegion = false;
if (mime === "text/plain") {
    text = visible = clean(source);
} else {
    const $ = load(source, { xml: mime === "application/xhtml+xml" });
    const root = $.root().get(0);
    let body;
    let titleNode;
    const mains = [];
    const articles = [];
    const sizes = new Map();
    const stack = [{ node: root, end: false }];
    while (stack.length) {
        const { node, end } = stack.pop();
        if (end) {
            sizes.set(
                node,
                (node.children ?? []).reduce((sum, child) => sum + (sizes.get(child) ?? 0), 0),
            );
            continue;
        }
        if (node.name === "body" && !body) body = node;
        if (node.name === "title" && !titleNode) titleNode = node;
        const attrs = node.attribs ?? {};
        // Structured interstitial assets, never arbitrary raw-source keywords/comments.
        if (
            node.name === "script"
            && /(?:\/cdn-cgi\/challenge-platform\/|\/cdn-cgi\/scripts\/.*\/challenge)/i.test(
                attrs.src ?? "",
            )
        ) {
            strongMarkup = true;
        }
        if (/^cf-chl-/i.test(attrs.id ?? "")) strongMarkup = true;
        if (node.type === "text") {
            sizes.set(node, node.data?.length ?? 0);
            continue;
        }
        if (node.type === "comment" || node.type === "directive") continue;
        if (omitted.has(node.name) || invisible(node)) {
            // Head is still inspected for title and challenge assets; its text is never selected.
            if (node.name !== "head") continue;
        }
        if (node.name === "main" || attrs.role === "main") mains.push(node);
        if (node.name === "article") articles.push(node);
        stack.push({ node, end: true });
        for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) {
            stack.push({ node: node.children[i], end: false });
        }
    }
    title = titleNode ? textOf(titleNode, false).replace(/\n/g, " ").slice(0, 1024) || null : null;
    visible = textOf(body ?? root);
    text = visible;
    for (const candidates of [mains, articles]) {
        let best;
        for (const node of candidates) {
            if ((sizes.get(node) ?? 0) >= 80 && (!best || sizes.get(node) > sizes.get(best))) {
                best = node;
            }
        }
        if (best) {
            const candidate = textOf(best);
            if (candidate.length < 80) continue;
            text = candidate;
            selectedRegion = true;
            warnings.push(
                "Selected the most substantive main/article region; other page regions are omitted.",
            );
            break;
        }
    }
    warnings.push(
        "Non-executing text extraction omits scripts, styles, navigation, forms, hidden content, and embedded media; layout and dynamic content are not reproduced.",
    );
}
// Recognize interstitial instructions, not explanations of CAPTCHA integrations.
// Full visible text is examined before selection/capping, including after large comments.
const instruction =
    /^(?:checking your browser(?:[.!…]|(?: before| to|,| please).*)?|verify (?:that )?you (?:are|'re) (?:a )?human(?:[.!…]|(?: to|,| before).*)?|just a moment[.!…]*|enable javascript and cookies to continue[.!…]*|attention required!\s*\|\s*cloudflare)$/i;
const visibleLines = visible.split("\n");
const hasInstruction = visibleLines.some((line) => instruction.test(line));
const interstitialTitle = instruction.test(title ?? "");
// An instructional heading alone is weak evidence when useful prose surrounds it.
// Count cleaned, non-instruction text, not source bytes, comments, or hidden assets.
const surroundingLength = visibleLines.filter((line) => !instruction.test(line)).join("\n").length;
const regionLength = selectedRegion
    ? text.split("\n").filter((line) => !instruction.test(line)).join("\n").length
    : 0;
const substantiveContent = regionLength >= 80 || surroundingLength >= 160;
// Strong markup/title signals still win, even for long main/article interstitials.
const challenge = (hasInstruction
    && ((visible.length < 2000 && !substantiveContent) || interstitialTitle || strongMarkup))
    || (interstitialTitle && visible.length < 2000 && !substantiveContent)
    || (strongMarkup && visible.length < 500);
if (!challenge && (hasInstruction || interstitialTitle)) {
    warnings.push(
        "Possible challenge instruction appears alongside substantive text; heuristic detection cannot establish an access restriction.",
    );
}
const truncation = { extracted: false, matches: false };
if (Buffer.byteLength(text, "utf8") > extractedBytes) {
    text = new TextDecoder().decode(Buffer.from(text).subarray(0, extractedBytes), {
        stream: true,
    });
    truncation.extracted = true;
    warnings.push("Extracted text was capped at 100 KiB; totalLines counts retained lines only.");
}
const lines = text ? text.split("\n") : [];

const window = (startLine, endLine) => ({
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join("\n"),
});

const matches = [];
let excerpts = [];
let no_match = false;
if (!challenge && params.action === "open") {
    if (start <= lines.length) {
        excerpts.push(window(start, Math.min(lines.length, start + limit - 1)));
    }
} else if (!challenge) {
    const regex = new RegExp(
        params.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        params.case_sensitive ? "gu" : "giu",
    );
    const offsets = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") offsets.push(i + 1);

    const lineAt = (offset) => {
        let low = 0;
        let high = offsets.length;
        while (low + 1 < high) {
            const mid = (low + high) >>> 1;
            if (offsets[mid] <= offset) low = mid;
            else high = mid;
        }
        return low;
    };

    const ranges = [];
    for (const match of text.matchAll(regex)) {
        if (matches.length >= limit) {
            truncation.matches = true;
            warnings.push("Additional literal matches were omitted at max_matches.");
            break;
        }
        const first = lineAt(match.index);
        const last = lineAt(match.index + match[0].length - 1);
        matches.push({ line: first + 1, column: match.index - offsets[first] + 1, text: match[0] });
        const range = [Math.max(1, first - 1), Math.min(lines.length, last + 3)];
        const previous = ranges.at(-1);
        if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]);
        else ranges.push(range);
    }
    excerpts = ranges.map(([first, last]) => window(first, last));
    no_match = matches.length === 0 && !truncation.extracted;
    if (!matches.length && truncation.extracted) {
        warnings.push(
            "No match in retained text; absence cannot be established in omitted content.",
        );
    }
}
parentPort.postMessage({
    title,
    challenge,
    warnings,
    totalLines: lines.length,
    matches,
    excerpts,
    no_match,
    truncation,
});
