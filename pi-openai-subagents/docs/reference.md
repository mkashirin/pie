# Subagents reference

This is the execution and maintenance contract for [pi-openai-subagents](../README.md). The
foreground coordinates specialists; the extension validates configuration, enforces policies,
schedules bounded work and tracks results. It is not a workflow engine or filesystem sandbox.

## Execution paths

- [index.ts](../index.ts) registers commands, lifecycle/policy/evidence hooks and `subagents_run`.
  Orchestrator mode changes the foreground prompt/loadout, not the delegation mechanism.
- [config.ts](../src/config.ts) merges definitions/settings and resolves assignments;
  [commands.ts](../src/commands.ts) edits assignments/policies.
- [runtime.ts](../src/runtime.ts) validates all tasks, assignments, input IDs and ownership paths
  before starting work. It creates a fresh public Pi `Agent` per task through the session model
  registry, with inherited tool bridges and a child-local `agent_report`.
- [scheduler.ts](../src/scheduler.ts) reserves ownership across simultaneous calls, limits
  concurrency and orders reviewers against writers. Children share the host workspace.
- [policy.ts](../src/policy.ts) applies role ceilings, allow/deny and consent. Async-local
  agent/run identity follows direct and nested/wrapper calls; authorized bridges use
  `ctx.executeTool()` so argument validation and every parent permission hook retain their veto.
- [state.ts](../src/state.ts) tracks settled runs, evidence IDs, revisions and quality gaps;
  [search-packet.ts](../src/search-packet.ts) validates captured web packets. Mode, runs and
  evidence restore from the active session branch. Full reports/evidence, not child transcripts,
  are retained in `pi-openai-subagents-*-v1` session entries.
- [ui.ts](../src/ui.ts), [presentation.ts](../src/presentation.ts) and
  [activity.ts](../src/activity.ts) own fleet state, agent cards and activity previews. Generic UI
  infrastructure belongs to the [shared TUI framework](../../docs/tui.md); domain presentation and
  runtime behavior remain here. Non-TUI execution creates no fleet widget or UI heartbeat.

A child can execute multiple tool calls concurrently only when **every inherited tool** is
classified as read. Write, execute and unknown-capability loadouts stay sequential. Children cannot
delegate, activate tools, reload extensions or change session settings. Cancellation, provider
errors, turn limits and timeouts stop runs without automatic restarts. No chains, background jobs,
worktrees, commits, automatic installations, rollback or separate child artifacts are provided.

Repeated role assignments resolve/authenticate once per batch, and tool registry metadata is
snapshotted once. Project context files load at each child's **actual start**, so queued children
see instructions changed by earlier work. Explicit input reports are the batch's supplied context,
not an implicit shared fleet transcript.

## Commands and persistence

```text
/subagents on | off | status | list | models | reload
/subagents model <agent|default> <provider/model-id|reset> [--save]
/subagents thinking <agent|default> <level|reset> [--save]
/subagents tools <agent>
/subagents tools <agent> allow <tool,...> [--save]
/subagents tools <agent> deny <tool,...> [--save]
/subagents tools <agent> inherit [--save]
/subagents classify <tool> <read|write|execute|delegate|control|unknown> [--save]
```

Execution-setting changes require an idle session. Enabling orchestration selects its assigned
model/thinking; disabling restores the prior selection unless manually changed. `/model` and
`/thinking` while enabled become session-local orchestrator assignments.

`allow` replaces the optional allow subset; `deny` replaces the deny subset; `inherit` clears both
at the edited scope. Deny wins. Commands never activate unavailable tools. Session changes persist
on the active branch. `--save` atomically writes canonical user settings, removes the corresponding
session override, and does **not** override higher-precedence project settings. `reset --save`
removes a saved field. Reload rereads definitions/settings, retains session overrides, clears
consent, and keeps the last valid configuration if parsing fails.

## Delegation tool

`subagents_run` accepts only `tasks`, a nonempty array bounded by `maxTasks`. Each task has:

| Field      | Type     | Contract                                                            |
| ---------- | -------- | ------------------------------------------------------------------- |
| agent      | string   | Required, nonempty named specialist; never `orchestrator`.          |
| task       | string   | Required, nonempty task.                                            |
| context    | string   | Optional explicit task context.                                     |
| inputs     | string[] | Prior run/evidence IDs on the current session branch.               |
| tools      | string[] | Exact replacement allowlist; no duplicates or unavailable tools.    |
| writePaths | string[] | Explicit workspace-relative files/directories for writer ownership. |

Unknown fields are rejected. One task is a single run; multiple tasks form a bounded batch. For
example, disjoint writers can be requested together:

```json
{
    "tasks": [
        { "agent": "worker", "task": "Add API validation", "writePaths": ["src/api/"] },
        { "agent": "worker", "task": "Add UI validation", "writePaths": ["src/ui/"] }
    ]
}
```

Sequence dependent calls yourself. Pass settled worker IDs to `reviewer`, and research/evidence IDs
to `research-validator`. An exact `tools` list can narrow the default set or explicitly select
named callable deferred/codemode tools. Each must already be callable in the parent and pass the
role policy; this does not activate tools. Model-only orchestration tools are not child-callable.

### Results, prompt projections and performance

Results retain input order, including partial successes. Each carries ID, agent/profile,
model/thinking/normalization, task/input/ownership fields, status/reason, report, evidence,
usage/turns/duration, truncation/report size, mutation/revision tracking and tool activity.
Statuses are `queued`, `running`, `complete`, `incomplete`, `failed`, `cancelled`; batch `partial`
records failed/incomplete/cancelled members. Model usage is counted once; Pi accounts for
nested-tool usage separately.

Keep these three representations distinct:

1. **Final/ledger records:** actual retrieved text and structured evidence plus complete reports.
   Parent-visible report text is capped at 50 KiB per task; complete final reports/evidence remain
   in result `details` / `structuredContent`. Child transcripts are not persisted.
2. **Later-child input:** [prompt-inputs.ts](../src/prompt-inputs.ts) removes runtime telemetry,
   summarizes tool activity, deduplicates evidence and omits duplicate structured provider details.
   Evidence text is capped at 12 KiB/item and 32 KiB/task; serialized inputs at 64 KiB/child, with
   an explicit truncation marker. Prior task/reason text is capped at 4 KiB each. The current
   `task` and explicit `context` are not covered by these input caps. Full originals remain
   parent-visible.
3. **Live progress:** evidence metadata only—ID, owner, tool, retrieval time, error and inspection
   kind—not retrieved text or provider packets. Settled progress rows are deeply frozen and reused;
   treat all progress snapshots as read-only. Headless calls without an update consumer skip
   progress snapshots entirely.

Final structured results are detached and JSON-normalized. Large evidence batches use a
string-preserving serialization fast path; other batches/exotic values use native JSON. This
optimization does not replace full final evidence with the live projection. Tests in
[performance.test.mjs](../tests/performance.test.mjs) and [json.test.mjs](../tests/json.test.mjs)
cover payload isolation, snapshot reuse, headless behavior and serialization.

## Roles, tools and authorization

| Name/profile       | Intended work                           | Known capability ceiling  |
| ------------------ | --------------------------------------- | ------------------------- |
| orchestrator       | Foreground conversation and synthesis   | read/search/delegate      |
| scout              | Locate code, map constraints            | read/search               |
| worker             | Scoped implementation and verification  | read/search/write/execute |
| gardener (worker)  | Optional style-grounded cleanup         | read/search/write/execute |
| reviewer           | Independent inspection/checks, no fixes | read/search/execute       |
| researcher         | Claims, sources, dates and uncertainty  | read/search               |
| research-validator | Independent fact-checking/grounding     | read/search               |

Specialists inherit only the parent's active `direct` tools by default, then apply ceilings and
allow/deny subsets. Task `tools` replaces that set as described above. Known delegation/control
tools are always blocked in children. Known edit/shell/control/delegation primitives cannot be
reclassified as reads.

Known Pi inspection tools, Lens inspection/navigation/diagnostic tools and OpenAI search/page tools
are reads; Lens replacement/rename operations mutate. LSP operations are checked per call. Explicit
classifications override extension metadata except for protected primitives; otherwise
`readOnlyHint: true` is a read classification. Other tools remain discoverable as unknown and need
explicit approval showing agent, tool and arguments. Confirmations are serialized and cached
(including denials) per agent/tool/schema/metadata for the session. Reload, policy changes and tree
navigation clear consent. Without dialog-capable TUI/RPC, unknown calls are denied; preclassify
trusted tools instead.

In orchestrator mode disallowed declarations are hidden but tools remain callable for authorized
children. There is no direct invocation of inherited implementations, extension reload in children,
Plan allowlist change or permission bypass. Plan Mode may deny `subagents_run`; use Plan's own
configuration if choosing to allow delegation. User-entered Pi and `!` commands are outside this
model-tool policy.

**These are trust policies, not an OS sandbox.** Unknown approval/read-only metadata do not prove
absence of side effects. Reviewer shell access is unrestricted: tests/builds can write artifacts or
execute project code. Instructions prohibit intentional source fixes, not all filesystem writes.
Use OS/container isolation for stronger boundaries.

### Workspace ownership and limits

Defaults: 8 tasks/batch, 4 concurrent children, 24 model turns and 600000 ms/task. Limits are
configurable; hitting one yields incomplete work, never an automatic mutating retry.

Parallel writers require nonempty explicit workspace-relative `writePaths`. Globs, escapes,
conflicting symlink aliases and ancestor/descendant overlaps are rejected, including across
simultaneous calls. A lone unscoped writer runs exclusively against other writers. Reviewers wait
for pending writers; writers do not run alongside active reviewers. Ownership lasts to settlement.
Direct edit/write and explicitly scoped AST replacements must stay within owned paths. Broad LSP
mutation cannot guarantee all affected paths and is denied for scoped workers.

Shell and unfamiliar extension side effects cannot be comprehensively constrained. Disjoint workers
still share builds, lockfiles and generated files; concurrent shell commands can conflict.
Read-only scouts may see work in progress. Sequence calls for a stable snapshot.

## Gardener and context requests

Bundled `gardener` is a **worker-profile** specialist for scoped behavior-preserving cleanup and
refactoring. Its default high reasoning precedes shared default assignments; explicit per-agent
assignments can override it (`/subagents thinking gardener medium`). Worker ownership/mutation
accounting, tool ceilings and mandatory core instructions still apply.

The foreground may run Gardener after relevant workers settle when useful/requested; it is **not
automatic after every worker**. Standalone cleanup/refactoring requests need no preceding worker.
Supply worker/scout/conventions report IDs via `inputs`, known constraints in `context`, and scoped
`writePaths`. Gardener also inspects representative current code and configuration for naming,
style, architecture, error handling and verification conventions. It must not invent a style, make
speculative rewrites or expand scope.

If conventions cannot be established safely, stop **before editing** and finish with an incomplete
report containing optional `contextRequests`. All required report fields still apply; this fragment
illustrates only the optional field:

```json
{
    "contextRequests": [
        {
            "agent": "scout",
            "task": "Inspect src/api conventions, boundaries and check commands with supporting paths",
            "reason": "Project conventions are missing from the supplied context"
        }
    ]
}
```

This is a request to the foreground, **not recursive delegation** or an automatic background job:

1. The foreground runs a scoped scout when appropriate. Its report distinguishes documented rules
   from observed conventions, cites paths/examples and discloses unknowns/conflicts.
2. Start a fresh Gardener with the original task/writePaths and request, scout and relevant worker
   run IDs in `inputs`.
3. If context remains unavailable, seek user guidance or disclose the limitation; do not blindly
   rerun unchanged requests.
4. Independently review changed/uncertain cleanup, supplying both relevant worker and Gardener IDs.

Existing reporters need not supply `contextRequests`. When present it is a nonempty array of scout
requests with nonempty `task`/`reason`. The gap remains visible until a later completed run of the
**same agent** links the request run ID via `inputs` and requests no more context. A scout report
alone or an unrelated run does not mark cleanup complete. Requests never grant tools, bypass parent
permission hooks or increase the one-continuation reminder limit.

## Agent report and quality checks

Every child finishes through local `agent_report`; missing/invalid reports mean incomplete work.
The closed schema in [state.ts](../src/state.ts) requires all these fields (empty arrays are valid
where inapplicable):

| Field           | Shape / meaning                                                               |
| --------------- | ----------------------------------------------------------------------------- |
| summary         | Nonempty string.                                                              |
| changeStatus    | `changed`, `none`, or `unknown`; do not claim none with unclear side effects. |
| changes         | String array of actual changes.                                               |
| verification    | String array of checks actually performed and results.                        |
| findings        | Objects: severity `blocking`/`warning`/`info`, nonempty text.                 |
| limitations     | String array of incomplete work, uncertainty and risks.                       |
| claims          | Objects: nonempty claim, evidence ID array, URL array, date, uncertainty.     |
| checks          | Objects: target input ID, verdict, nonempty reason, evidence ID array.        |
| contextRequests | Optional nonempty array as above; makes the run incomplete.                   |

Claim/check evidence IDs must refer to supplied or newly captured evidence; check targets must have
been supplied through `inputs`. Review verdicts are `pass`, `blocked`, `insufficient`; validation
verdicts are `supported`, `contradicted`, `insufficient-evidence`. A completed review requires
linked checks, described verification and an actual successful read/execute tool call. Findings
remain model judgments, not mechanically proven facts.

Successful edits, reported changes and uncertain worker shell effects need independent linked
review. Every changed/uncertain worker (including Gardener) needs its own coverage. Freshness is
tracked per target run/revision: a target's later mutation stales its review; mutations to
unrelated runs do not. This is not a filesystem diff or workspace-wide certificate. Later
overlapping work needs its own review but does not automatically reopen earlier run IDs.

Researcher outputs and direct orchestrator web packets need independent linked validation. At
settlement in orchestrator mode, at most **one automatic continuation per user workflow** requests
missing checks or blocking/insufficient findings. Historical negatives are superseded only by a
later completed independent reviewer/validator with the same target in `inputs` and a successful
matching check. Blocking findings additionally require an explicit successful check against the
blocking report's run ID. Reviewers must inspect the target's latest recorded revision; validators
must perform their own successful search. Unrelated, self-reported, incomplete or mixed negative
reports do not clear gates; newer negatives restore warnings. Remaining gaps/blockers produce a
visible model-context warning, not a loop or false certificate. Cancellation/provider errors do not
trigger reminders. Natural-language final-answer truth is not hard-enforced.

### Research evidence

Web tools retain installed schemas, citations, freshness, partial failures and authentication.
`openai_search` uses Pi's configured OpenAI auth even when a child uses another provider.
`web_action` is explicit credential-free public HTTP open/find: not native search, a browser,
login, screenshots or rendered JavaScript. There is no automatic fallback or native-action failure
detection. A citation is not proof or full-page inspection; unavailable access and weak evidence
must remain visible. Missing tools are nonfatal for coding but prevent completed research claims.

Captured packets have stable evidence IDs and actual retrieved text/details, timestamps and
`search` versus `page-action` inspection kind. Search completion requires a structurally valid
**entire version-1 packet**, at least one successful query, nonempty completed answer and completed
native search action. Malformed nested fields invalidate the whole packet. Partial results can
count, but failures/cancellations remain disclosed. Page actions never count as search. Direct
orchestrator web calls also produce packets. Researchers need material claims; validators receive
original evidence through `inputs` (subject to prompt projection) and must conduct their own
successful search. A `supported` verdict requires actual evidence references. See the
[web reference](../../pi-openai-web/docs/reference.md) for retrieval proof and bounds.

## Settings and definitions

Files: `<agent-dir>/pi-openai-subagents.json` and trusted current
`<cwd>/.pi/pi-openai-subagents.json` only; no ancestor search. Old settings/definition directories
are ignored and left untouched. Configure assignments manually with `/subagents`.

```json
{
    "default": { "model": "openai/<installed-model-id>", "thinking": "high" },
    "agents": {
        "scout": { "model": "openai/<installed-model-id>" },
        "reviewer": { "denyTools": ["mystery-tool"] }
    },
    "classifications": { "my-inspector": "read" },
    "maxTasks": 8,
    "concurrency": 4,
    "maxTurns": 24,
    "timeoutMs": 600000
}
```

All fields are optional; invalid/unknown fields fail clearly. Model references are fully qualified,
split only at the first slash; assignments validate existence and authentication. Initial default
is an eligible active physical `openai`/`openai-multi` model using `openai-responses`, otherwise
the registered `openai/gpt-6.1-sol`. Virtual models and similarly named arbitrary providers are
ineligible initial defaults. Missing/ineligible fallback or auth fails clearly; no silent unrelated
provider fallback. Other providers need explicit assignment. Initial thinking is high; unsupported
inherited/default levels normalize visibly, but explicit unsupported thinking commands fail.

Per-field precedence: session agent → trusted project agent → user agent → effective Markdown
definition → session shared default → project shared default → user shared default → initial
default. `/subagents models` and `/subagents tools` show provenance.

Definitions merge by name: bundled [agents/](../agents) →
`<agent-dir>/pi-openai-subagents/agents/*.md` → trusted
`<cwd>/.pi/pi-openai-subagents/agents/*.md`. Duplicate names within a directory, unknown fields,
invalid profiles and malformed settings are rejected. Custom names require an explicit base profile
on every replacement and may change it across scopes. Built-in names keep fixed profiles and
mandatory core instructions even when customized.

```markdown
---
name: api-scout
description: Inspect public API compatibility
profile: scout
model: openai/<installed-model-id>
thinking: medium
allowTools: [read, grep, module_report, read_symbol]
denyTools: []
---

Inspect public interfaces and identify compatibility risks. Be concise.
```

## Live presentation

Interactive TUI calls show a fleet widget above the editor even with orchestration off or no update
consumer. Concurrent calls merge; duplicate agent names remain separate. Up to 8 runs are visible,
active first, plus call/run/overflow counts: at most 9 physical lines. Rows contain only plain
agent name, themed status and elapsed seconds—no model/profile/tool/action/path/task/snippet, focus
numbers or decorative icons. Settled rows may stay while another call runs; the widget clears after
the last call settles/cancels.

Chat AgentCards separately show agent/status, role/model, elapsed/turns, activity stage/action/tool
and focus path/query/command. Long fields wrap by ANSI-aware terminal width in both expansion
modes. Edit previews extract at most two old and two new +/- lines; wrapping adds rows, not more
extracted content. Succeeded/failed activities use status colors; pending/running/blocked retain
labels. Tool-reported success is not diff verification. Expanded Markdown reports remain intact. At
width 0 cards are empty; at width 1 a two-column grapheme may be clipped because it cannot fit.

Fallback rows use `Status`. Native-style titles bold shell commands and read/edit actions, color
paths and read windows (`read src/example.ts:1-2000` by default). Bounded edit/write snippets have
muted `...` framing, one separator above and no trailing child blank row. Shell output is not
extracted into activity previews. Pi owns tool-shell margin, bottom padding and backgrounds; cards
add no background. The fleet widget is full-width without left margin, independent of `outputPad`;
custom info/warning messages honor `outputPad` 0/1, including `/settings` changes. Sanitization and
margins affect presentation only, not model-facing content, reports or structured results.

One lazy shared one-second heartbeat refreshes fleet and live tool-result tracking, including quiet
model waits. Stream updates coalesce at about 100 ms; lifecycle/tool transitions and initial/final
snapshots are immediate. Elapsed time starts at actual job start, excludes queuing and freezes at
settlement; start clocks are ephemeral. Reload/session changes/shutdown/cancellation/errors clean
up ownership and subscriptions. RPC/print/JSON create no widget/UI timer; event-driven partial
snapshots still measure actual elapsed time.

## Troubleshooting and verification

- Missing model/auth: inspect `/subagents models`, sign in/select the intended account, and use a
  fully qualified installed model. There is no silent provider fallback.
- Tool missing/denied: inspect `/subagents tools <agent>`, parent callable tools, classifications,
  role ceilings and parent/Plan vetoes. `--save` cannot override a project field.
- Incomplete run: inspect status/reason, report, limits and pending context requests before
  retrying potentially mutating work. Supply settled IDs when requesting independent
  review/validation.
- Missing evidence in progress or a later child: inspect full final details and truncation
  metadata; live snapshots and bounded prompt projections are intentionally not full evidence
  stores.

See [workspace development](../../docs/development.md) for shared tooling. With existing root
setup, run `npm run check` from this package, or `npm run format:check`, `npm run typecheck` and
`npm test` separately. Format Markdown at 99 columns with pinned dprint; do not broadly format
other workers' files or run shared builds without coordination.

Tests use isolated temporary homes/users, restored environment variables, fake authenticated
registries/streams, the real public `Agent` loop and installed-Pi SDK smoke tests. SDK loading
checks canonical registration once. Model networking and Jiti filesystem caching are disabled;
fixtures use no real credentials/paid APIs. Web-contract fixtures call sibling packet producers
without retrieval; checks need the workspace/root tooling rather than only a managed Pi
installation. Coverage includes config/branches, nested policies/consent/vetoes,
scheduling/symlinks, reports and web evidence, quality reminders, Gardener/context handoffs,
cancellation/limits/usage, payload projections/serialization, narrow/Unicode/theme rendering, fleet
overflow/layout and clock cleanup. Installed-host layout fixtures cover 80×24 and 100×24 with
four/eight edit workers and representative status/editor/footer content; quiet waits and staggered
queued starts exercise elapsed time.

Manual smoke checks after `/reload` (live research/confirmation checks are not offline fixtures):

1. Enable, converse, steer, assign two role models, then disable and check restoration.
2. Run disjoint workers, optional Gardener, then independent executable review of all changed IDs.
3. Try standalone Gardener and missing-conventions request → scout → fresh retry with linked IDs.
4. Research and independently validate actual evidence, including partial/failing retrieval.
5. Approve/cancel an unknown tool; confirm Plan Mode still vetoes prohibited delegation/tools.
6. Inspect narrow/fullscreen layout, resize/theme/output padding and teardown on cancellation or
   session replacement; check quiet-wait clocks and queue-excluded elapsed time.
