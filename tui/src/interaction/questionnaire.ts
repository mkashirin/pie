import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, parseKey } from "@earendil-works/pi-tui";
import { formatInteractionHints } from "../hints.ts";
import { inlineText } from "../text.ts";
import { AnswerEditor } from "./editor.ts";
import { columns, inset, rowBudget, windowRows, wrapWords } from "./layout.ts";
import { InteractionLifetime } from "./lifetime.ts";
import { uniqueLabels } from "./menu.ts";
import type {
    QuestionnaireAnswer,
    RunQuestionnaireOptions,
    RunQuestionnaireResult,
} from "./types.ts";

export async function runQuestionnaire(
    ctx: ExtensionContext,
    options: RunQuestionnaireOptions,
): Promise<RunQuestionnaireResult> {
    const life = new InteractionLifetime(options);
    const answers: QuestionnaireAnswer[] = [];
    const notes = new Map<number, string>();
    let index = 0;
    const questions = options.questions;
    const answer = (selection: number, custom?: string) => {
        const question = questions[index];
        answers[index] = {
            questionId: question.id,
            answer: custom ?? question.options[selection].label,
            wasCustom: custom !== undefined,
            ...(custom === undefined ? { optionIndex: selection + 1 } : {}),
            ...(notes.has(index) ? { note: notes.get(index) } : {}),
        };
        index++;
    };
    const submitted = (): RunQuestionnaireResult => ({
        kind: "submitted",
        answers: answers.map((value) => ({ ...value })),
    });
    try {
        if (!life.current) return { kind: "stale" };
        if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
            await options.onUnsupportedMode?.(ctx, ctx.mode);
            return { kind: "unsupported", mode: ctx.mode };
        }
        if (!questions.length) return submitted();
        if (ctx.mode === "rpc") {
            life.cancel = () => life.dispose();
            while (life.current) {
                if (index === questions.length) {
                    if (questions.length === 1) return submitted();
                    const labels = uniqueLabels([
                        "Submit answers",
                        ...questions.map((question) => `Edit ${inlineText(question.header)}`),
                    ]);
                    const selection = await life.wait(
                        ctx.ui.select("Review answers", labels, { signal: life.signal }),
                    );
                    if (!life.current) return { kind: "stale" };
                    if (selection === undefined) return { kind: "closed", reason: "back" };
                    const chosen = labels.indexOf(selection);
                    if (chosen === 0) return submitted();
                    if (chosen > 0) index = chosen - 1;
                    continue;
                }
                const question = questions[index];
                const title = `${inlineText(question.header)}: ${inlineText(question.prompt)}`;
                const labels = uniqueLabels([
                    ...question.options.map((option, n) =>
                        `${n + 1}. ${inlineText(option.label)}${
                            option.description ? ` — ${inlineText(option.description)}` : ""
                        }`
                    ),
                    `${question.options.length + 1}. Other (free-form)`,
                    ...(options.allowNotes ? ["Add notes"] : []),
                ]);
                const selection = await life.wait(
                    ctx.ui.select(title, labels, { signal: life.signal }),
                );
                if (!life.current) return { kind: "stale" };
                if (selection === undefined) return { kind: "closed", reason: "back" };
                const chosen = labels.indexOf(selection);
                if (chosen === question.options.length + 1 && options.allowNotes) {
                    const note = await life.wait(ctx.ui.editor("Notes", notes.get(index)));
                    if (!life.current) return { kind: "stale" };
                    if (note !== undefined) notes.set(index, note);
                } else if (chosen === question.options.length) {
                    const custom = await life.wait(
                        ctx.ui.input("Other (free-form)", undefined, { signal: life.signal }),
                    );
                    if (!life.current) return { kind: "stale" };
                    if (custom !== undefined && custom.trim()) answer(chosen, custom);
                } else if (chosen >= 0 && chosen < question.options.length) answer(chosen);
            }
            return { kind: "stale" };
        }
        let completed: RunQuestionnaireResult | undefined;
        const result = await life.wait(
            ctx.ui.custom<RunQuestionnaireResult>((tui, theme, keybindings, done) => {
                let selection = 0;
                let reviewSelection = 0;
                let editing: "note" | "custom" | undefined;
                let disposed = false;
                let focused = false;
                const editor = new AnswerEditor(keybindings);
                const finish = (result: RunQuestionnaireResult) => {
                    if (disposed) return;
                    completed = result;
                    disposed = true;
                    focused = false;
                    editor.focused = false;
                    life.dispose();
                    done(result);
                };
                const refresh = () => {
                    if (!disposed) tui.requestRender();
                };
                const choose = (chosen: number) => {
                    if (chosen === questions[index].options.length) {
                        editing = "custom";
                        editor.setValue(answers[index]?.wasCustom ? answers[index].answer : "");
                    } else {
                        answer(chosen);
                        selection = 0;
                        if (index === questions.length && questions.length === 1) {
                            finish(submitted());
                        }
                    }
                    refresh();
                };
                life.cancel = () => finish({ kind: "stale" });
                if (!life.current) finish({ kind: "stale" });
                return {
                    capturesViewportInput: true,
                    get focused() {
                        return focused;
                    },
                    set focused(value: boolean) {
                        focused = !disposed && value;
                        editor.focused = focused;
                    },
                    invalidate() {
                        editor.invalidate();
                    },
                    dispose() {
                        disposed = true;
                        focused = false;
                        editor.focused = false;
                        life.dispose();
                    },
                    handleInput(data) {
                        if (disposed) return;
                        if (!life.current) {
                            finish({ kind: "stale" });
                            return;
                        }
                        if (matchesKey(data, "ctrl+c")) {
                            finish({ kind: "closed", reason: "close" });
                            return;
                        }
                        if (keybindings.matches(data, "tui.select.cancel")) {
                            if (editing) editing = undefined;
                            else if (index === questions.length) {
                                index--;
                                selection = (answers[index]?.optionIndex ?? 1) - 1;
                            } else finish({ kind: "closed", reason: "back" });
                            refresh();
                            return;
                        }
                        if (editing) {
                            if (keybindings.matches(data, "tui.input.submit")) {
                                const value = editor.getValue();
                                if (editing === "note") {
                                    notes.set(index, value);
                                    if (answers[index]) answers[index].note = value;
                                    editing = undefined;
                                } else if (value.trim()) {
                                    editing = undefined;
                                    answer(selection, value);
                                    selection = 0;
                                }
                                if (index === questions.length && questions.length === 1) {
                                    finish(submitted());
                                }
                            } else editor.handleInput(data);
                        } else if (index === questions.length) {
                            if (keybindings.matches(data, "tui.select.up")) {
                                reviewSelection = (reviewSelection + questions.length)
                                    % (questions.length + 1);
                            } else if (keybindings.matches(data, "tui.select.down")) {
                                reviewSelection = (reviewSelection + 1) % (questions.length + 1);
                            } else if (keybindings.matches(data, "tui.select.confirm")) {
                                if (!reviewSelection) finish(submitted());
                                else {
                                    index = reviewSelection - 1;
                                    selection = (answers[index]?.optionIndex
                                        ?? questions[index].options.length + 1) - 1;
                                }
                            }
                        } else {
                            const count = questions[index].options.length + 1;
                            const key = parseKey(data);
                            if (keybindings.matches(data, "tui.select.up")) {
                                selection = (selection - 1 + count) % count;
                            } else if (keybindings.matches(data, "tui.select.down")) {
                                selection = (selection + 1) % count;
                            } else if (keybindings.matches(data, "tui.select.confirm")) {
                                choose(selection);
                            } else if (options.allowNotes && matchesKey(data, "n")) {
                                editing = "note";
                                editor.setValue(notes.get(index) ?? "");
                            } else if (key && /^[1-9]$/u.test(key) && Number(key) <= count) {
                                selection = Number(key) - 1;
                                choose(selection);
                            }
                        }
                        refresh();
                    },
                    render(width) {
                        const size = columns(width);
                        if (!size || disposed) {
                            return [];
                        }
                        const rows: string[] = [];
                        const add = (
                            text: string,
                            role: "accent" | "muted" | "success" = "muted",
                        ) => rows.push(
                            ...inset(text, size, size === 1 ? "" : " ").map((line) =>
                                theme.fg(role, line)
                            ),
                        );
                        const marker = (selected: boolean) =>
                            selected ? (size === 1 ? "→" : " → ") : "   ";
                        let active = 0;
                        if (index === questions.length) {
                            add("Review answers", "accent");
                            answers.forEach((value, n) => {
                                add(`✓ ${questions[n].header}: ${value.answer}`, "success");
                                if (value.note) add(`Notes: ${value.note}`);
                            });
                            ["Submit answers", ...questions.map((q) => `Edit ${q.header}`)].forEach(
                                (label, n) => {
                                    if (n === reviewSelection) active = rows.length;
                                    rows.push(
                                        ...inset(label, size, marker(n === reviewSelection), "   ")
                                            .map((line) =>
                                                theme.fg(
                                                    n === reviewSelection ? "accent" : "muted",
                                                    line,
                                                )
                                            ),
                                    );
                                },
                            );
                        } else {
                            const question = questions[index];
                            add(options.title ?? question.header, "accent");
                            add(question.prompt);
                            if (editing) {
                                add(editing === "note" ? "Notes" : "Other (free-form)", "accent");
                                active = rows.length;
                                rows.push(...editor.render(size, " > "));
                            } else {
                                [...question.options, { label: "Other (free-form)" }].forEach(
                                    (option, n) => {
                                        if (n === selection) active = rows.length;
                                        const label = `${n + 1}. ${option.label}${
                                            option.description ? ` - ${option.description}` : ""
                                        }`;
                                        rows.push(
                                            ...inset(label, size, marker(n === selection), "      ")
                                                .map((line) =>
                                                    theme.fg(
                                                        n === selection ? "accent" : "muted",
                                                        line,
                                                    )
                                                ),
                                        );
                                    },
                                );
                                if (notes.has(index)) add(`Notes: ${notes.get(index)}`);
                            }
                        }
                        rows.push(
                            ...wrapWords(
                                formatInteractionHints(keybindings, [
                                    {
                                        bindings: ["tui.select.up", "tui.select.down"],
                                        label: "navigate",
                                    },
                                    {
                                        bindings: [
                                            editing ? "tui.input.submit" : "tui.select.confirm",
                                        ],
                                        label: "submit",
                                    },
                                    { bindings: ["tui.select.cancel"], label: "back" },
                                    ...(options.allowNotes && !editing && index < questions.length
                                        ? [{ keys: ["n"], label: "notes" }]
                                        : []),
                                ]),
                                size,
                            ).map((line) => theme.fg("dim", line)),
                        );
                        const budget = rowBudget(tui);
                        return windowRows(rows, active >= budget ? active : 0, budget);
                    },
                };
            }, {
                blocked: {
                    kind: "question",
                    message: inlineText(options.title ?? questions[0].header),
                },
            }),
        );
        return completed ?? result ?? { kind: "stale" };
    } finally {
        life.dispose();
    }
}
