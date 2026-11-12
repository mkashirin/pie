import { runCustomInteraction, sanitizeTerminalText } from "@narumitw/pi-tui-kit";
const DEFAULT_LABELS = {
    reviewTab: "Review",
    reviewTitle: "Review answers",
    otherOption: "Other (free-form)",
    customAnswer: "Custom answer",
    optionalNote: "Optional note",
    answer: "Answer",
    note: "Note",
};

/** Plan Mode's word-wrapped TUI questionnaire; other modes use the upstream adapter. */
export async function runQuestionnaire(ctx, options) {
    if (!isCurrent(options) || options.signal?.aborted) {
        return { kind: "stale" };
    }
    const validationError = validateOptions(options);
    if (validationError) {
        return questionnaireError(ctx, options, validationError);
    }
    const resolved = resolveOptions(options);
    return runTuiQuestionnaire(ctx, options, resolved);
}

async function runTuiQuestionnaire(ctx, options, resolved) {
    let QuestionnaireComponent;
    try {
        ({ QuestionnaireComponent } = await import("./questionnaire-component.js"));
    } catch (error) {
        return questionnaireError(ctx, options, error);
    }
    if (!isCurrent(options) || options.signal?.aborted) {
        return { kind: "stale" };
    }
    const result = await runCustomInteraction(ctx, {
        signal: options.signal,
        isCurrent: options.isCurrent,
        onError: (currentCtx, error) => reportQuestionnaireError(currentCtx, options, error),
        create: ({ tui, theme, keybindings, complete }) =>
            new QuestionnaireComponent({
                ...resolved,
                tui,
                theme,
                keybindings,
                isCurrent: () => isCurrent(options),
                onDone: complete,
            }),
    });
    return result.kind === "completed" ? result.value : result;
}

function resolveOptions(options) {
    return {
        questions: options.questions,
        allowCustomAnswer: options.allowCustomAnswer ?? true,
        allowNotes: options.allowNotes ?? false,
        maxTextLength: options.maxTextLength,
        labels: { ...DEFAULT_LABELS, ...options.labels },
    };
}

function validateOptions(options) {
    if (options.questions.length === 0) {
        return new Error("Questionnaire requires at least one question");
    }
    if (
        options.maxTextLength !== undefined
        && (!Number.isInteger(options.maxTextLength) || options.maxTextLength <= 0)
    ) {
        return new Error("Questionnaire maxTextLength must be a positive integer");
    }
    const ids = new Set();
    for (const question of options.questions) {
        if (!question.id.trim()) {
            return new Error("Questionnaire question ids must not be blank");
        }
        if (ids.has(question.id)) {
            return new Error(`Duplicate questionnaire question id: ${question.id}`);
        }
        ids.add(question.id);
        if (!sanitizeTerminalText(question.header).trim()) {
            return new Error(`Questionnaire question ${question.id} requires a displayable header`);
        }
        if (!sanitizeTerminalText(question.prompt).trim()) {
            return new Error(`Questionnaire question ${question.id} requires a displayable prompt`);
        }
        if (question.options.length === 0) {
            return new Error(`Questionnaire question ${question.id} requires at least one option`);
        }
        for (const option of question.options) {
            if (!sanitizeTerminalText(option.label).trim()) {
                return new Error(`Questionnaire question ${question.id} has a blank option label`);
            }
        }
    }
    for (const [name, label] of Object.entries(options.labels ?? {})) {
        if (!sanitizeTerminalText(label).trim()) {
            return new Error(`Questionnaire label ${name} must be displayable`);
        }
    }
    return undefined;
}

async function questionnaireError(ctx, options, error) {
    if (!isCurrent(options) || options.signal?.aborted) {
        return { kind: "stale" };
    }
    await reportQuestionnaireError(ctx, options, error);
    if (!isCurrent(options) || options.signal?.aborted) {
        return { kind: "stale" };
    }
    return { kind: "error", error };
}

async function reportQuestionnaireError(ctx, options, error) {
    let reported = false;
    if (options.onError) {
        try {
            await options.onError(ctx, error);
            reported = true;
        } catch {
            // Fall through to Pi's notifier when a custom reporter is unavailable.
        }
    }
    if (reported || !ctx.hasUI || !isCurrent(options) || options.signal?.aborted) {
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    try {
        uiFor(ctx).notify(`Questionnaire failed: ${sanitizeTerminalText(message)}`, "error");
    } catch {
        // Error reporting must not change the typed result.
    }
}

function isCurrent(options) {
    return options.isCurrent?.() ?? true;
}

function uiFor(ctx) {
    return ctx.ui;
}
