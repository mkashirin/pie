# Evidence-first academic discussion and fact-checking

## Establish what is being checked

For each paper, confirm the title, authors, identifier/DOI when available, publication year,
version/date, and preprint versus published status. Check that a title-based tool resolved the
right work. Distinguish arXiv submission date from journal publication date. Do not assert
peer-review, acceptance, corrections or retractions unless verified from an appropriate source.
Cite the version actually inspected; reconcile changed claims across versions explicitly.

For discussion, start from the user's specific question. For literature work, define scope,
comparison criteria, date boundaries, and a modest retrieval budget. A small discovery pass is not
an exhaustive or systematic review. Avoid unsupported claims such as "the first", "the best", "no
prior work", or "the literature agrees". To assess novelty, search earlier and competing work and
qualify conclusions to the inspected set.

For fact-checking, split compound sentences into checkable claims. Keep exact manuscript wording
and identify the source of each assertion: author's result, cited prior work, definition,
interpretation, or unsubstantiated generalization. Check citation entailment, not merely whether
the citation exists or is on a similar topic.

## Keep a compact evidence ledger

Maintain the ledger in working context, not as an unsolicited repository file. For each material
claim record:

- Exact claim and scope: population/domain, assumptions, version, dataset, baseline, conditions.
- Source identity, stable URL, real section/page/equation/table locator, and retrieval date.
- Evidence type: original paper passage, extracted PDF pages, abstract, AI-generated intermediate
  report, search synthesis, publisher metadata, supplied text, or your inference.
- Relevant short quotation/paraphrase, result and uncertainty; unresolved conflicts/access gaps.
- Actual run/evidence IDs only when supplied by the subagent/web ledger; a working label such as C1
  is a local claim label, not a tool evidence ID.

Search hits, abstracts, and generated summaries can guide reading but cannot establish detailed
methods or exact numerical results. Inspect the original text for central assertions, quotations,
proof conditions, and data. Targeted pages can support a claim without proving the rest of the
paper was read. Describe inspected scope honestly. If OCR or equation extraction is suspect, ask
for the relevant passage/figure or mark the claim unresolved.

## Read critically, not adversarially

For a method or experiment, inspect as applicable:

- Research question, assumptions, objective, design, comparators and intended application.
- Sample sizes, splits, preprocessing, selection criteria, controls and possible data leakage.
- Baseline fairness, compute budgets, evaluation metrics, uncertainty estimates and robustness.
- Ablations, negative results, limitations and whether conclusions exceed tested conditions.
- Distinctions between correlation and causation, statistical and practical significance, in-sample
  fit and generalization, simulated and real-world evidence.
- Numerical context: denominator, units, absolute versus relative change, percentage points versus
  percent, mean versus median, uncertainty intervals, and higher/lower-is-better metrics.

For a theorem or proof, identify definitions, quantifiers, hypotheses, dependencies and claimed
conclusion. Preserve these in explanations. A plausible proof sketch is not a verified proof; state
which steps were checked and which require further work. Do not extrapolate an asymptotic claim
into finite-sample performance without evidence.

Distinguish "the authors report X" from "X is established" and from "I reproduced X". Paper or
repository access is not reproduction. Do not execute code or install packages without explicit
authorization; propose a reproducibility check separately when useful.

## Verify and assign claim-level verdicts

For important claims, inspect the cited original passage and actively consider contradicting
sources or changed versions. Independent validation is optional but must be genuinely independent
if reported: follow the role contract in `tools.md`. One paper can support a narrow statement while
leaving a broader conclusion unresolved.

Use these verdicts in either language:

| Verdict                                       | Meaning                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `supported` / подтверждается                  | Inspected evidence supports the claim within the stated scope.         |
| `contradicted` / опровергается                | Inspected evidence conflicts with the claim as written.                |
| `insufficient-evidence` / недостаточно данных | Evidence is missing, inaccessible, indirect, ambiguous, or too narrow. |

Do not mark an inaccessible claim contradicted merely because support was not found. Mixed claims
need separate verdicts. Provide a correction only when the evidence justifies it; otherwise give an
author query or a cautiously scoped alternative. Do not manufacture a number or reference to fill a
gap. Avoid numerical confidence estimates unless there is an explicit defensible method.

## Sources and final presentation

Place citations beside substantive claims. Use stable arXiv/AlphaXiv/publisher links and locators
actually returned or inspected. Preserve native citation tags when provided; never invent them. For
direct quotations, verify exact wording and keep them short. If translating a quotation, label it
as your translation rather than attributing the translated wording verbatim.

For bibliography/BibTeX work, verify required metadata from retrieved sources. Keep original
citation keys and author order. Do not infer a DOI, issue, venue, page range, transliteration or
publication year; report missing fields. Follow the user's style or venue guidance; do not assume
Russian text always requires GOST or English always requires APA.

A useful fact-check format is:

| Claim | Verdict | Inspected source/locator | Reason and scope | Proposed action |
| ----- | ------- | ------------------------ | ---------------- | --------------- |

Use prose instead for a short single-claim check. End substantial research with a compact coverage
note: what was searched/read, source versions/date, whether independent validation occurred, and
important omissions. Do not bury conflicting evidence or claim all facts in an edited manuscript
were checked when only selected ones were reviewed.
