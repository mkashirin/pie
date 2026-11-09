# AlphaXiv and optional research subagents

## Discover the connected tools

Pi exposes the connected server as `mcp__alphaxiv`, normally through `codemode`. Tools need not
appear in the ordinary tool list to be callable. Discover them and inspect declarations before
calling; use current tool descriptions over these examples if schemas or limits change:

```js
text(await describeNamespace("mcp__alphaxiv"));
text(await searchTools("discover papers", { namespace: "mcp__alphaxiv", limit: 3 }));
for (const name of [
  "mcp__alphaxiv__discover_papers",
  "mcp__alphaxiv__get_paper_content",
  "mcp__alphaxiv__answer_pdf_queries",
]) text(await describeTool(name));
```

These are JavaScript bodies for `codemode`, not shell commands. Call MCP tools through
`tools.<discovered_name>(args)`. Do not run `codemode` concurrently with another foreground tool
call. Within a script, use awaited `Promise.allSettled()` for independent reads; do not leave
promises running when the script ends. MCP tools return a `CallToolResult`: inspect `isError`,
`content`, `structuredContent`, omissions, and extraction warnings. A resolved promise with
`isError: true` is not successful retrieval. Retain useful provenance when reducing large output;
read saved full output or request targeted passages if relevant evidence was truncated. Sandbox
scripts have no direct filesystem/network/Node APIs; reach them only through authorized tools.

If the namespace is missing, tools are denied, or connection fails, state that AlphaXiv could not
be used. Suggest `/mcp` to inspect connection/exposure and `/reload` after configuration changes;
do not automatically reconnect, enable, authenticate, or rewrite configuration. Use supplied
sources or permitted alternative retrieval, and explain any resulting gaps.

## Choose the paper tool

AlphaXiv primarily covers arXiv literature: computer science, mathematics, physics, statistics,
electrical engineering, and quantitative biology/finance. It is not a comprehensive biomedical,
clinical, life-science, humanities, or Russian-language journal index. An empty result is not proof
that relevant research does not exist. Use domain-appropriate primary literature beyond its
coverage; for multilingual topics consider Russian and English search terms without silently
changing the research question.

### Literature discovery: `discover_papers`

Use for multiple candidate papers, related work, or topical research; not as a preliminary lookup
for a single known paper. The currently connected tool accepts:

- `question`: the user's research question in their terms.
- `keywords`: only terms actually stated by the user or observed in tool results, spelled as given;
  do not guess acronym expansions or pad with vaguely related concepts.
- `difficulty`: effort estimate from 1 to 10, proportionate to scope and budget.
- Optional `prioritize`: `default`, `recency`, `historical`, or `popular`. Use recency for latest
  work, historical for foundational work, popular only when community attention is requested.
- Optional `published_after` / `published_before`: YYYY-MM-DD boundaries only when the user gives a
  real time window; a recency preference is not a hard cutoff.

Respect the current two-searches-per-message discovery budget. Cover facets together in one broad
call, then read candidates rather than repeating many narrow searches. Do not equate popularity
with quality. Preserve returned IDs for subsequent reading. Render `[ID=<id>]` handles as
`https://www.alphaxiv.org/abs/<id>` in user-facing prose, while retaining versioned arXiv links
when available; do not expose raw handles as citations.

### Known paper: `get_paper_content` or `answer_pdf_queries`

`get_paper_content({ url })` returns an **AI-generated intermediate report by default**, falling
back to extracted text if no report exists. Use it for orientation only. Request
`get_paper_content({ url, fullText: true })` for original extracted text when checking wording,
proofs, exact claims, results, or references. Verify the identity/version of the returned paper.
Full extracted text still may omit figures or contain OCR/LaTeX errors.

`answer_pdf_queries({ paper, queries })` accepts an ID, URL, or title; no prior discovery is needed
for a known paper. A title resolves to a best match, so check authors/title/version before relying
on it. Put every current question for that paper into the `queries` array as separate strings. It
returns relevant raw PDF pages, not a guarantee of complete paper coverage. Preserve returned page
numbers and citation tags for claims based on those pages; do not fabricate tags/locators. An
ordinary webpage URL returns readable webpage text, not PDF page-ranked content.

For example, after identifying a public paper from the user's request:

```js
const result = await tools.mcp__alphaxiv__answer_pdf_queries({
  paper: "2307.12307",
  queries: ["What assumptions does the method require?", "What limitations are stated?"],
});
text(result);
```

The ID is illustrative; replace it with the actual requested/returned paper. Several different
papers can be read in one script with `Promise.allSettled()`. Broaden to full text if filtered
pages omit context needed for the conclusion.

Default to public research retrieval. Library/notes tools access private user material: use them
only when requested and keep retrieved notes private. Saving, removing, moving papers, creating,
renaming/deleting folders, following/unfollowing researchers, or editing private paper metadata
requires explicit authorization. A request to discuss or polish a paper grants none of these.

## Complementary web evidence

Use callable `openai_search` for broader source discovery or external corroboration. Use `live`
freshness for changing facts such as latest work, publication status, or corrections/retractions;
`cached` for stable topics, noting that cached disables live external search. Inspect per-query
errors, cancellations, warnings, timestamps, and truncation. Search synthesis and citations do not
prove full-page inspection. Use `web_action` explicitly when original public webpage inspection is
needed; it is credential-free HTTP open/find, not a browser, login, rendered JavaScript, or
automatic fallback. Do not use it as an assumed PDF parser. Preserve stable URLs and actual fetched
locators. If retrieval fails, say so rather than treating a snippet as proof.

## Delegate only when useful and allowed

The skill named `researcher` and the subagent named `researcher` are different resources:
`/skill:researcher` loads this workflow; `subagents_run` runs optional specialists.

Check whether `subagents_run` is callable and the requested roles are available. Do not activate
orchestration, switch models, grant unknown-tool consent, or change tool policies to make it work.
If needed, tell the user to inspect `/subagents list`, `/subagents tools researcher`, or
`/subagents tools research-validator`; enabling/authenticating/configuring is their choice. Missing
delegation is not fatal: continue in the foreground when permitted.

Both roles are read/search-only: no edits, shell execution, control operations, or further
children. They inherit currently callable tools subject to role ceilings, allow/deny subsets,
unknown-tool consent, and parent permissions. MCP/codemode availability in the foreground does not
guarantee availability or approval in a child. Do not rely on children loading the skill or
inheriting the parent conversation.

### Explicit task contract

For each task, provide in `task`/`context`:

1. The bounded question, exact claims to evaluate, research scope, output language and budget.
2. Public paper IDs/URLs and versions, selected local paths if authorized, and relevant source
   excerpts with tool name, retrieval date, source URL and real page/section/table locators.
3. Constraints on confidentiality, network access, edits and scientific meaning.
4. Expected findings: claim-level sources, dates, uncertainty, contradictions, alternatives, and a
   concise summary. Retain the extension's required structured report fields.
5. Role limits and whether AlphaXiv is actually accessible. Ask the role to disclose limitations,
   not claim unavailable reading or successful independent checks.

Normally use one researcher; split into at most two independent tasks only for distinct questions
or source sets. Do not delegate mere copyediting to research roles. For independent checking,
sequence the `research-validator` call after research settles. Put actual returned settled run or
web-evidence IDs in `inputs`; never guess IDs or pass a URL/file path as if it were a ledger ID.
Include original claim text and provenance in context as well. Require checks linked to all
supplied targets with verdicts `supported`, `contradicted`, or `insufficient-evidence`.

### Important completion limitation in this bundle

The bundled `pi-openai-subagents` research profiles require **each child's own successful
`openai_search`**, including a validator's independent search. Parent searches, supplied excerpts,
AlphaXiv retrieval, and `web_action` reads alone do not satisfy that completion requirement. A
validator must also report checks linked to supplied `inputs` with actual captured evidence. Do not
tell a child to skip its required search or claim an AlphaXiv-only run is formally complete. For
offline/provided-sources-only work, stay in the foreground; for unavailable `openai_search`, prefer
foreground research and accurately label self-checking.

The extension captures ledger evidence for `openai_search` / `web_action`; do not assume MCP
results are registered as such packets. Retrieve AlphaXiv in the foreground when needed, then pass
excerpts and provenance explicitly to the child. These remain supplied source material, not
independently retrieved child evidence or invented ledger IDs. To validate foreground-only AlphaXiv
findings with a child, provide actual existing web-evidence/run inputs if available; otherwise
obtain a settled researcher run for the claims before requesting linked validation, or keep the
check in the foreground. Never manufacture an input ID to clear a quality gate.

After each call, inspect status, completion limitations, evidence, linked checks and truncation. An
extension's completed status is a workflow signal, not proof of scientific correctness. Read
important original passages yourself, reconcile contradictions and disclose coverage. If a child
fails, keep useful findings but do not count that run as completed independent validation. Do not
enter retry loops, suppress outstanding gates, or call a self-check independent validation.
