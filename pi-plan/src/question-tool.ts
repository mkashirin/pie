import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runQuestionnaire } from "@pi-extensions/pi-kit";

export const PLAN_MODE_QUESTION_TOOL_NAME = "plan_mode_question";
export const MAX_PLAN_MODE_RESPONSE_LENGTH = 4000;
export type PlanModeQuestionOption = { label: string; description?: string };
export type PlanModeQuestion = {
    id: string;
    header: string;
    question: string;
    options: PlanModeQuestionOption[];
};
export type PlanModeQuestionAnswer = {
    id: string;
    header: string;
    question: string;
    answer: string;
    wasCustom: boolean;
    optionIndex?: number;
    note?: string;
};
type PlanModeQuestionReason =
    | "cancelled"
    | "ui_unavailable"
    | "plan_mode_inactive"
    | "invalid_input";

export const PLAN_MODE_QUESTION_PARAMS = {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
        questions: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            description: "Questions to show the user. Prefer 1 and do not exceed 3.",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "header", "question", "options"],
                properties: {
                    id: {
                        type: "string",
                        description: "Stable identifier for mapping answers (snake_case).",
                    },
                    header: {
                        type: "string",
                        description: "Short header label shown in the UI (12 or fewer chars).",
                    },
                    question: {
                        type: "string",
                        description: "Single-sentence prompt shown to the user.",
                    },
                    options: {
                        type: "array",
                        minItems: 2,
                        maxItems: 4,
                        description:
                            "Two to four distinct choices. The user may also enter a custom answer.",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["label", "description"],
                            properties: {
                                label: {
                                    type: "string",
                                    description: "User-facing label (1-5 words).",
                                },
                                description: {
                                    type: "string",
                                    description: "Explain the choice and its tradeoffs.",
                                },
                            },
                        },
                    },
                },
            },
        },
    },
} as const;

type NormalizePlanModeQuestionParamsResult =
    | { ok: true; questions: PlanModeQuestion[] }
    | { ok: false; error: string };
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const nonblank = (value: unknown): value is string => typeof value === "string" && !!value.trim();

export function normalizePlanModeQuestionParams(
    input: unknown,
): NormalizePlanModeQuestionParamsResult {
    const invalid = (error: string): NormalizePlanModeQuestionParamsResult => ({
        ok: false,
        error,
    });
    if (
        !object(input) || !Array.isArray(input.questions)
        || input.questions.length < 1 || input.questions.length > 3
    ) {
        return invalid("Provide between one and three questions.");
    }
    const ids = new Set<string>();
    const questions: PlanModeQuestion[] = [];
    for (const item of input.questions) {
        if (
            !object(item) || !nonblank(item.id) || !nonblank(item.header)
            || !nonblank(item.question)
        ) {
            return invalid("Each question needs a nonblank id, header and question.");
        }
        if (ids.has(item.id)) return invalid("Question IDs must be unique.");
        ids.add(item.id);
        if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4) {
            return invalid("Each question needs two to four options.");
        }
        const options: PlanModeQuestionOption[] = [];
        for (const option of item.options) {
            if (
                !object(option) || !nonblank(option.label)
                || (option.description !== undefined && typeof option.description !== "string")
            ) {
                return invalid("Each option needs a label and a text description.");
            }
            options.push({
                label: option.label,
                ...(option.description !== undefined ? { description: option.description } : {}),
            });
        }
        questions.push({ id: item.id, header: item.header, question: item.question, options });
    }
    return { ok: true, questions };
}

export function planModeQuestionAnswered(
    questions: PlanModeQuestion[],
    answers: PlanModeQuestionAnswer[],
) {
    const details = { cancelled: false as const, questions, answers };
    return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}

export function planModeQuestionCancelled(
    questions: PlanModeQuestion[],
    reason: PlanModeQuestionReason,
    message: string,
) {
    return {
        content: [{ type: "text" as const, text: message }],
        details: { cancelled: true as const, reason, questions },
    };
}

export async function askPlanModeQuestions(
    questions: PlanModeQuestion[],
    ctx: ExtensionContext,
    shouldContinue: () => boolean = () => true,
): Promise<PlanModeQuestionAnswer[] | undefined> {
    if (!ctx.hasUI || !["tui", "rpc"].includes(ctx.mode) || !shouldContinue()) return undefined;
    const result = await runQuestionnaire(ctx, {
        questions: questions.map((question) => ({
            id: question.id,
            header: question.header,
            prompt: question.question,
            options: question.options,
        })),
        allowNotes: true,
        signal: ctx.signal,
        isCurrent: shouldContinue,
    });
    if (result.kind !== "submitted" || !shouldContinue() || ctx.signal?.aborted) return undefined;
    const answers: PlanModeQuestionAnswer[] = [];
    for (const question of questions) {
        const response = result.answers.find((answer) => answer.questionId === question.id);
        if (!response) return undefined;
        const answer = response.wasCustom
            ? response.answer.trim().slice(0, MAX_PLAN_MODE_RESPONSE_LENGTH)
            : response.answer;
        if (!answer.trim()) return undefined;
        const note = response.note?.trim().slice(0, MAX_PLAN_MODE_RESPONSE_LENGTH);
        answers.push({
            id: question.id,
            header: question.header,
            question: question.question,
            answer,
            wasCustom: response.wasCustom,
            ...(response.optionIndex !== undefined ? { optionIndex: response.optionIndex } : {}),
            ...(note ? { note } : {}),
        });
    }
    return answers;
}

export async function answerPlanModeQuestions(
    questions: PlanModeQuestion[],
    ctx: ExtensionContext,
    lifecycle: { isCurrent(): boolean; isEnabled(): boolean },
) {
    const active = () => lifecycle.isCurrent() && lifecycle.isEnabled();
    if (!active()) {
        return planModeQuestionCancelled(
            questions,
            "plan_mode_inactive",
            "Plan Mode is not active.",
        );
    }
    if (!ctx.hasUI || !["tui", "rpc"].includes(ctx.mode)) {
        return planModeQuestionCancelled(
            questions,
            "ui_unavailable",
            "Interactive UI is unavailable.",
        );
    }
    const answers = await askPlanModeQuestions(questions, ctx, active);
    if (!active()) {
        return planModeQuestionCancelled(
            questions,
            "plan_mode_inactive",
            "The planning workflow is no longer active.",
        );
    }
    if (!answers) return planModeQuestionCancelled(questions, "cancelled", "User cancelled.");
    return planModeQuestionAnswered(questions, answers);
}
