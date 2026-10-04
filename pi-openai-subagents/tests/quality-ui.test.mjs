import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import test from "node:test";
import { call, harness, report, searchPacket, state, stream, tool } from "./helpers.mjs";

const qualityRun = (id, profile, extra = {}) => ({
    id,
    agent: profile,
    profile,
    model: "x/y",
    thinking: "high",
    status: "complete",
    inputs: [],
    evidence: [],
    task: "task",
    writePaths: [],
    turns: 1,
    durationMs: 1,
    usage: state.emptyUsage(),
    changed: false,
    uncertainShell: false,
    revision: 1,
    reviewRevision: 1,
    toolActivity: [],
    truncated: false,
    reportBytes: 1,
    report: report(),
    ...extra,
});

const qualityCheck = (target, verdict, evidence = []) => ({
    target,
    verdict,
    reason: "Explicit linked check",
    evidence,
});

const reviewRun = (id, targets, extra = {}) =>
    qualityRun(id, "reviewer", {
        inputs: targets,
        toolActivity: [{ tool: "read", capability: "read", isError: false }],
        report: report({
            verification: ["Independent inspection and tests"],
            checks: targets.map((target) => qualityCheck(target, "pass")),
        }),
        ...extra,
    });

const searchEvidence = (owner, extra = {}) => ({
    id: `evidence-${owner}`,
    owner,
    tool: "openai_search",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    text: "Independent source",
    details: searchPacket(),
    isError: false,
    inspection: "search",
    ...extra,
});

const validationRun = (id, targets, extra = {}) =>
    qualityRun(id, "research-validator", {
        inputs: targets,
        evidence: [searchEvidence(id)],
        report: report({
            checks: targets.map((target) => qualityCheck(target, "supported", [`evidence-${id}`])),
        }),
        ...extra,
    });

const unresolvedGaps = (ledger) => ledger.gaps().filter((gap) => gap.startsWith("Unresolved"));

test("checks are run-linked, review coverage is invalidated by new changes, and reminders are bounded", async (t) => {
    const h = await harness(t, {
        stream: (m) =>
            stream(m, [
                call("agent_report", report({ changeStatus: "changed", changes: ["src/x.ts"] })),
            ]),
    });
    await h.command("on");
    await h.emit("before_agent_start", {
        prompt: "Implement",
        systemPromptOptions: { sections: {} },
    });
    const worker = await h.execute("subagents_run", {
        tasks: [{ agent: "worker", task: "Implement" }],
    });
    const id = worker.result.details.results[0].id;
    const first = (await h.emit("agent_before_settle", { outcome: "completed" }))[0];
    assert.equal(first.continue, true);
    assert.match(first.entries[0].content, new RegExp(id));
    const second = (await h.emit("agent_before_settle", { outcome: "completed" }))[0];
    assert.equal(second.continue, false);
    assert.match(second.entries[0].content, /No further automatic/);
    assert.equal((await h.emit("agent_before_settle", { outcome: "aborted" }))[0], undefined);
    assert.equal((await h.emit("agent_before_settle", { outcome: "error" }))[0], undefined);
    h.ctx.modelRegistry.streamSimple = (m, c) =>
        stream(
            m,
            c.messages.filter((x) => x.role === "assistant").length === 0
                ? [call("read", {})]
                : [
                    call(
                        "agent_report",
                        report({
                            verification: ["Inspected changes"],
                            checks: [{
                                target: id,
                                verdict: "pass",
                                reason: "No blockers",
                                evidence: [],
                            }],
                        }),
                    ),
                ],
        );
    const review = await h.execute("subagents_run", {
        tasks: [{ agent: "reviewer", task: "Review", inputs: [id] }],
    });
    assert.equal(review.result.details.results[0].status, "complete");
    assert.equal((await h.emit("agent_before_settle", { outcome: "completed" }))[0], undefined);
    h.ctx.modelRegistry.streamSimple = (m) =>
        stream(m, [
            call("agent_report", report({ changeStatus: "changed", changes: ["src/y.ts"] })),
        ]);
    await h.execute("subagents_run", { tasks: [{ agent: "worker", task: "Further changes" }] });
    const stale = (await h.emit("agent_before_settle", { outcome: "completed" }))[0];
    assert.equal(stale.continue, false);
    assert.match(stale.entries[0].content, /stale/);
    await h.command("off");
    assert.equal((await h.emit("agent_before_settle", { outcome: "completed" }))[0], undefined);
});
test("direct orchestrator web retrieval is recorded and needs independent validation", async (t) => {
    const h = await harness(t, {
        tools: [
            tool(
                "openai_search",
                async () => ({
                    content: [{ type: "text", text: "Retrieved claim" }],
                    details: searchPacket(),
                }),
            ),
        ],
    });
    await h.command("on");
    await h.emit("before_agent_start", {
        prompt: "Research",
        systemPromptOptions: { sections: {} },
    });
    const search = await h.execute("openai_search", { queries: ["grounded claim"] });
    const id = search.result.content.at(-1).text.match(/evidence-[\w-]+/)[0];
    const packets = h.entries.filter((e) => e.customType === state.EVIDENCE_ENTRY);
    assert.equal(packets.length, 1);
    assert.equal(packets[0].data.id, id);
    const reminder = (await h.emit("agent_before_settle", { outcome: "completed" }))[0];
    assert.match(reminder.entries[0].content, new RegExp(id));
    h.ctx.modelRegistry.streamSimple = (m, c) => {
        if (c.messages.filter((x) => x.role === "assistant").length === 0) {
            return stream(m, [call("openai_search", { queries: ["independent countercheck"] })]);
        }
        const evidence =
            c.messages.filter((x) => x.role === "toolResult").at(-1).content.at(-1).text.match(
                /evidence-[\w-]+/,
            )[0];
        return stream(m, [
            call(
                "agent_report",
                report({
                    verification: ["Independent source search"],
                    checks: [{
                        target: id,
                        verdict: "supported",
                        reason: "Confirmed scope/date",
                        evidence: [evidence],
                    }],
                }),
            ),
        ]);
    };
    const validation = await h.execute("subagents_run", {
        tasks: [{ agent: "research-validator", task: "Check direct evidence", inputs: [id] }],
    });
    assert.equal(validation.result.details.results[0].status, "complete");
    assert.equal((await h.emit("agent_before_settle", { outcome: "completed" }))[0], undefined);
});
test("blocking and insufficient verdicts remain visible; unrelated checks do not satisfy review", () => {
    const ledger = new state.Ledger();
    const run = qualityRun;
    ledger.putRun(run("worker", "worker", { changed: true }));
    ledger.putRun(
        run("reviewer", "reviewer", {
            inputs: ["some-other-run"],
            report: report({
                verification: ["test"],
                checks: [{
                    target: "some-other-run",
                    verdict: "pass",
                    reason: "different changes",
                    evidence: [],
                }],
            }),
        }),
    );
    assert.ok(ledger.gaps().some((x) => /Review required/.test(x)));
    ledger.putRun(
        run("validator", "research-validator", {
            report: report({
                checks: [{
                    target: "claim",
                    verdict: "insufficient-evidence",
                    reason: "No page access",
                    evidence: [],
                }],
            }),
        }),
    );
    assert.ok(ledger.gaps().some((x) => /Unresolved/.test(x)));
});
test("blocker, repair and fresh linked independent review clear historical quality warnings", () => {
    const ledger = new state.Ledger();
    ledger.putRun(qualityRun("widget-worker", "worker", { changed: true }));
    ledger.putRun(qualityRun("scout", "scout", {
        inputs: ["widget-worker"],
        report: report({ checks: [qualityCheck("widget-worker", "insufficient")] }),
    }));
    ledger.putRun(qualityRun("elapsed-worker", "worker", {
        changed: true,
        inputs: ["widget-worker"],
        report: report({ checks: [qualityCheck("widget-worker", "insufficient")] }),
    }));
    ledger.putRun(reviewRun("blocking-review", ["widget-worker", "elapsed-worker"], {
        report: report({
            verification: ["Reproduced callback failure"],
            findings: [{ severity: "blocking", text: "Callback crash" }],
            checks: ["widget-worker", "elapsed-worker"].map((id) => qualityCheck(id, "blocked")),
        }),
    }));
    assert.ok(unresolvedGaps(ledger).some((gap) => gap.includes("blocking-review")));
    ledger.putRun(qualityRun("repair-worker", "worker", { changed: true, revision: 2 }));
    ledger.putRun(reviewRun("final-review", [
        "widget-worker",
        "elapsed-worker",
        "repair-worker",
        "blocking-review",
    ], { revision: 2, reviewRevision: 2 }));
    assert.deepEqual(ledger.gaps(), []);
    const restored = state.restore([{
        type: "custom",
        customType: state.RUN_ENTRY,
        data: structuredClone([...ledger.runs.values()]),
    }]).ledger;
    assert.deepEqual(restored.gaps(), []);
    ledger.mutation();
    assert.ok(ledger.gaps().some((gap) => gap.startsWith("Review required")));
    assert.ok(unresolvedGaps(ledger).some((gap) => gap.includes("blocking-review")));
});
test("scout and worker insufficient checks clear only after a same-target independent pass", () => {
    const ledger = new state.Ledger();
    ledger.putRun(qualityRun("target", "worker"));
    ledger.putRun(qualityRun("scout", "scout", {
        inputs: ["target"],
        report: report({ checks: [qualityCheck("target", "insufficient")] }),
    }));
    assert.match(unresolvedGaps(ledger)[0], /scout/);
    ledger.putRun(qualityRun("worker", "worker", {
        inputs: ["target"],
        report: report({ checks: [qualityCheck("target", "insufficient")] }),
    }));
    // Warn the latest limitation for this target, not every historical observer.
    assert.equal(unresolvedGaps(ledger).length, 1);
    assert.match(unresolvedGaps(ledger)[0], /worker/);
    ledger.putRun(reviewRun("review", ["target"]));
    assert.deepEqual(ledger.gaps(), []);
});
test("blocking report findings require an explicit report-ID resolution, not just worker approval", () => {
    const ledger = new state.Ledger();
    ledger.putRun(qualityRun("target", "worker", { changed: true }));
    ledger.putRun(reviewRun("blocker", ["target"], {
        report: report({
            verification: ["Found crash"],
            findings: [{ severity: "blocking", text: "Crash" }],
            checks: [qualityCheck("target", "blocked")],
        }),
    }));
    ledger.putRun(reviewRun("worker-approval", ["target"]));
    assert.equal(ledger.gaps().length, 1);
    assert.match(ledger.gaps()[0], /blocker/);
    ledger.putRun(reviewRun("report-resolution", ["blocker"]));
    assert.deepEqual(ledger.gaps(), []);
});
test("resolving one target or its report ID does not erase other negative checks", () => {
    const ledger = new state.Ledger();
    for (const id of ["first", "second"]) ledger.putRun(qualityRun(id, "worker"));
    ledger.putRun(reviewRun("limited-report", ["first", "second"], {
        report: report({
            verification: ["test"],
            findings: [{ severity: "blocking", text: "Integration failure" }],
            checks: [qualityCheck("first", "blocked"), qualityCheck("second", "insufficient")],
        }),
    }));
    ledger.putRun(reviewRun("first-pass", ["first", "limited-report"]));
    assert.match(unresolvedGaps(ledger)[0], /limited-report/);
    ledger.putRun(reviewRun("second-pass", ["second"]));
    assert.deepEqual(ledger.gaps(), []);
});
test("unrelated, unlinked, stale, incomplete and non-independent passes cannot resolve warnings", async (t) => {
    const cases = [
        ["unrelated target", {
            inputs: ["other"],
            report: report({
                verification: ["test"],
                checks: [qualityCheck("other", "pass")],
            }),
        }],
        ["missing input linkage", { inputs: [] }],
        ["stale review", { reviewRevision: 0 }],
        ...["queued", "running", "incomplete", "failed", "cancelled"].map(
            (status) => [status, { status }],
        ),
        ...["worker", "scout", "researcher", "research-validator"].map(
            (profile) => [profile, { profile }],
        ),
        ["mutating reviewer", { changed: true }],
        ["uncertain shell", { uncertainShell: true }],
        ["no inspection", { toolActivity: [] }],
        ["failed inspection", {
            toolActivity: [{ tool: "read", capability: "read", isError: true }],
        }],
        ["no verification", { report: report({ checks: [qualityCheck("target", "pass")] }) }],
        ...["changed", "unknown"].map((changeStatus) => [changeStatus, {
            report: report({
                changeStatus,
                verification: ["test"],
                checks: [qualityCheck("target", "pass")],
            }),
        }]),
        ["blocking success report", {
            report: report({
                verification: ["test"],
                findings: [{ severity: "blocking", text: "Still broken" }],
                checks: [qualityCheck("target", "pass")],
            }),
        }],
        ["mixed negative report", {
            inputs: ["target", "other"],
            report: report({
                verification: ["test"],
                checks: [qualityCheck("target", "pass"), qualityCheck("other", "insufficient")],
            }),
        }],
    ];
    for (const [name, extra] of cases) {
        await t.test(name, () => {
            const ledger = new state.Ledger();
            ledger.putRun(qualityRun("target", "worker", { changed: true }));
            ledger.putRun(qualityRun("other", "worker"));
            ledger.putRun(qualityRun("limitation", "scout", {
                inputs: ["target"],
                report: report({ checks: [qualityCheck("target", "insufficient")] }),
            }));
            ledger.putRun(reviewRun("candidate", ["target"], extra));
            assert.ok(ledger.gaps().some((gap) => gap.startsWith("Review required for target")));
            assert.ok(unresolvedGaps(ledger).some((gap) => gap.includes("limitation")));
        });
    }
});
test("self checks, unknown targets and passes inserted before their source cannot resolve it", () => {
    const ledger = new state.Ledger();
    ledger.putRun(reviewRun("early", ["target"]));
    ledger.putRun(qualityRun("target", "worker", { changed: true }));
    assert.ok(ledger.gaps().some((gap) => gap.startsWith("Review required")));
    // Updating a restored run does not invent a later insertion position.
    ledger.putRun(reviewRun("early", ["target"]));
    assert.ok(ledger.gaps().some((gap) => gap.startsWith("Review required")));
    ledger.putRun(reviewRun("self", ["self"], {
        report: report({
            verification: ["test"],
            findings: [{ severity: "blocking", text: "Own finding" }],
            checks: [qualityCheck("self", "pass")],
        }),
    }));
    ledger.putRun(qualityRun("unknown-source", "scout", {
        report: report({ checks: [qualityCheck("missing-target", "insufficient")] }),
    }));
    ledger.putRun(reviewRun("unknown-resolution", ["missing-target"]));
    assert.ok(unresolvedGaps(ledger).some((gap) => gap.includes("self")));
    assert.ok(unresolvedGaps(ledger).some((gap) => gap.includes("unknown-source")));
    for (const status of ["queued", "running"]) {
        const pending = new state.Ledger();
        pending.putRun(qualityRun("pending", "worker", { status, changed: true }));
        pending.putRun(reviewRun("invalid-pass", ["pending"]));
        assert.ok(pending.gaps().some((gap) => gap.startsWith("Review required")));
    }
});
test("newer blocked checks restore review gates and supersede older negative statuses", () => {
    const ledger = new state.Ledger();
    ledger.putRun(qualityRun("target", "worker", { changed: true }));
    ledger.putRun(reviewRun("old-negative", ["target"], {
        report: report({ verification: ["test"], checks: [qualityCheck("target", "blocked")] }),
    }));
    ledger.putRun(reviewRun("pass", ["target"]));
    assert.deepEqual(ledger.gaps(), []);
    ledger.putRun(reviewRun("new-negative", ["target"], {
        report: report({ verification: ["test"], checks: [qualityCheck("target", "blocked")] }),
    }));
    assert.ok(ledger.gaps().some((gap) => gap.startsWith("Review required for target")));
    assert.equal(unresolvedGaps(ledger).length, 1);
    assert.match(unresolvedGaps(ledger)[0], /new-negative/);
    ledger.putRun(reviewRun("new-pass", ["target"]));
    assert.deepEqual(ledger.gaps(), []);
});
test("independent researched support resolves historical research limits, not contradictions or insufficient evidence", () => {
    const ledger = new state.Ledger();
    ledger.putRun(qualityRun("research", "researcher"));
    ledger.putRun(validationRun("old-limit", ["research"], {
        report: report({ checks: [qualityCheck("research", "insufficient-evidence")] }),
    }));
    assert.ok(!ledger.gaps().some((gap) => gap.startsWith("Independent research validation")));
    assert.match(unresolvedGaps(ledger)[0], /old-limit/);
    ledger.putRun(validationRun("support", ["research"]));
    assert.deepEqual(ledger.gaps(), []);
    ledger.putRun(validationRun("contradiction", ["research"], {
        report: report({ checks: [qualityCheck("research", "contradicted")] }),
    }));
    assert.match(unresolvedGaps(ledger)[0], /contradiction/);
    ledger.putRun(validationRun("new-limit", ["research"], {
        report: report({ checks: [qualityCheck("research", "insufficient-evidence")] }),
    }));
    assert.equal(unresolvedGaps(ledger).length, 1);
    assert.match(unresolvedGaps(ledger)[0], /new-limit/);
    ledger.putRun(validationRun("new-support", ["research"]));
    assert.deepEqual(ledger.gaps(), []);
});
test("research resolutions require complete independent successful searches and grounded linked support", async (t) => {
    const cases = [
        ["no search", { evidence: [] }],
        ["failed search", { evidence: [searchEvidence("candidate", { isError: true })] }],
        ["no successful query", {
            evidence: [searchEvidence("candidate", { details: searchPacket({ results: [] }) })],
        }],
        ["running packet", {
            evidence: [
                searchEvidence("candidate", { details: searchPacket({ status: "running" }) }),
            ],
        }],
        ["empty answer", {
            evidence: [searchEvidence("candidate", {
                details: searchPacket({
                    results: [
                        { ...searchPacket().results[0], answerSegments: [] },
                    ],
                }),
            })],
        }],
        ["no completed search", {
            evidence: [searchEvidence("candidate", {
                details: searchPacket({
                    results: [
                        { ...searchPacket().results[0], actions: [] },
                    ],
                }),
            })],
        }],
        ["page action only", {
            evidence: [
                searchEvidence("candidate", {
                    tool: "web_action",
                    details: searchPacket({ tool: "web_action" }),
                    inspection: "page-action",
                }),
            ],
        }],
        ["inherited search", { evidence: [searchEvidence("research")] }],
        ["incomplete", { status: "incomplete" }],
        ["worker claim", { profile: "worker" }],
        ["no inputs", { inputs: [] }],
        ["unrelated support", {
            inputs: ["other"],
            report: report({
                checks: [qualityCheck("other", "supported", ["evidence-candidate"])],
            }),
        }],
        ["ungrounded support", {
            report: report({ checks: [qualityCheck("research", "supported")] }),
        }],
        ["unknown evidence", {
            report: report({
                checks: [qualityCheck("research", "supported", ["missing-evidence"])],
            }),
        }],
        ["blocking report", {
            report: report({
                findings: [{ severity: "blocking", text: "Source unreliable" }],
                checks: [qualityCheck("research", "supported", ["evidence-candidate"])],
            }),
        }],
        ["mixed contradiction", {
            inputs: ["research", "other"],
            report: report({
                checks: [
                    qualityCheck("research", "supported", ["evidence-candidate"]),
                    qualityCheck("other", "contradicted"),
                ],
            }),
        }],
    ];
    for (const [name, extra] of cases) {
        await t.test(name, () => {
            const ledger = new state.Ledger();
            ledger.putRun(qualityRun("research", "researcher"));
            ledger.putRun(qualityRun("other", "researcher"));
            ledger.putRun(validationRun("limit", ["research"], {
                report: report({ checks: [qualityCheck("research", "insufficient-evidence")] }),
            }));
            ledger.putRun(validationRun("candidate", ["research"], extra));
            assert.ok(unresolvedGaps(ledger).some((gap) => gap.includes("limit")));
        });
    }
});
test("research report blockers and direct evidence limits resolve only through linked independent support", () => {
    const ledger = new state.Ledger();
    const direct = searchEvidence("workflow-test", { id: "direct-evidence" });
    ledger.evidence.set(direct.id, direct);
    ledger.putRun(validationRun("blocker", [direct.id], {
        report: report({
            findings: [{ severity: "blocking", text: "Unsupported claim" }],
            checks: [qualityCheck(direct.id, "contradicted")],
        }),
    }));
    ledger.putRun(validationRun("evidence-support", [direct.id]));
    assert.equal(ledger.gaps().length, 1);
    assert.match(ledger.gaps()[0], /blocker/);
    ledger.putRun(reviewRun("wrong-role", ["blocker"]));
    assert.match(ledger.gaps()[0], /blocker/);
    ledger.putRun(validationRun("report-support", ["blocker"]));
    assert.deepEqual(ledger.gaps(), []);
});
test("partial v1 search retains failures while successful independent support counts", () => {
    const packet = searchPacket();
    const failed = {
        ...packet.results[0],
        id: "query-failed",
        ok: false,
        status: "failure",
        answerSegments: [],
        actions: [],
        citations: [],
        sources: [],
        error: { kind: "cancelled", message: "Cancelled query" },
    };
    const evidence = searchEvidence("validator", {
        details: searchPacket({ status: "partial", results: [...packet.results, failed] }),
    });
    assert.equal(state.successfulSearch(evidence), true);
    const ledger = new state.Ledger();
    ledger.putRun(qualityRun("research", "researcher"));
    ledger.putRun(validationRun("validator", ["research"], { evidence: [evidence] }));
    assert.deepEqual(ledger.gaps(), []);
    assert.equal(evidence.details.results[1].error.kind, "cancelled");
});
test("unsupported search tools cannot satisfy independent validation", () => {
    const ledger = new state.Ledger();
    ledger.putRun(qualityRun("research", "researcher"));
    ledger.putRun(validationRun("validator", ["research"], {
        evidence: [
            searchEvidence("validator", { tool: "codex_search", details: { successes: [{}] } }),
        ],
    }));
    assert.ok(ledger.gaps().some((gap) => gap.includes("Independent research validation")));
});
test("report text truncates UTF-8 safely, preserving full structured details", async (t) => {
    const large = "界".repeat(30_000);
    const capped = state.capText(large);
    assert.equal(capped.truncated, true);
    assert.ok(!capped.text.includes("\uFFFD"));
    assert.match(capped.text, /full report/);
    assert.ok(Buffer.byteLength(capped.text) <= 50 * 1024);
    const h = await harness(t, {
        stream: (m) => stream(m, [call("agent_report", report({ summary: large }))]),
    });
    const r = await h.execute("subagents_run", {
        tasks: [{ agent: "scout", task: "Large report" }],
    });
    assert.equal(r.result.details.results[0].report.summary, large);
    assert.equal(r.result.details.results[0].truncated, true);
    assert.ok(r.result.content[0].text.length < large.length);
});
test("compact/expanded rendering fits narrow widths and works without TUI", async (t) => {
    const h = await harness(t);
    const r = await h.execute("subagents_run", { tasks: [{ agent: "scout", task: "Headless" }] });
    assert.equal(r.result.details.results[0].status, "complete");
    const theme = await initTheme("dark");
    // initTheme configures exported theme; direct theme import avoids custom rendering mocks.
    const themeModule = await import("@earendil-works/pi-coding-agent");
    const fallback = { fg: (_token, text) => text };
    const rendererTheme = theme?.fg ? theme : fallback;
    for (const expanded of [false, true]) {
        const component = h.tools.get("subagents_run").renderResult(
            r.result,
            { expanded },
            rendererTheme,
        );
        for (const width of [8, 20, 80]) {
            assert.ok(component.render(width).every((line) => visibleWidth(line) <= width));
        }
    }
    assert.ok(themeModule);
});
test("parent Plan/permission policies can block delegation without being altered", async (t) => {
    const h = await harness(t);
    const before = h.pi.getActiveTools();
    h.pi.on(
        "tool_call",
        (e) =>
            e.toolName === "subagents_run"
                ? { block: true, reason: "Plan policy denies subagents_run" }
                : undefined,
    );
    const r = await h.execute("subagents_run", {
        tasks: [{ agent: "worker", task: "Disallowed implementation" }],
    });
    assert.equal(r.isError, true);
    assert.match(r.result.content[0].text, /Plan policy/);
    assert.deepEqual(h.pi.getActiveTools(), before);
});
