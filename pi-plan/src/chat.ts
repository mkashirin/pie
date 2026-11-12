import {
    getMarkdownTheme,
    type MessageRenderer,
    type Theme,
} from "@earendil-works/pi-coding-agent";
import {
    type Component,
    escapeMarkdownText,
    sanitizeDisplayText,
    ThemedMarkdown,
    wrapProse,
} from "@pi-extensions/tui";
import type { PlanModeQuestion, PlanModeQuestionAnswer } from "./question-tool.ts";

interface ChatResult {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
}
type Status = "waiting" | "answered" | "cancelled" | "ready" | "error";
const plain = (text: string) => sanitizeDisplayText(text, { multiline: true, tabs: "space" });
const literal = (text: string) => escapeMarkdownText(plain(text));

/** Transcript formatting never mutates the tool's model-facing payload. */
export class PlanChatCard implements Component {
    private body: ThemedMarkdown;

    constructor(
        private title: string,
        body: string,
        private theme: Theme,
        private status: Status,
    ) {
        this.body = new ThemedMarkdown(() => body, () => getMarkdownTheme());
    }

    invalidate(): void {
        this.body.invalidate();
    }

    render(width: number): string[] {
        const columns = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
        if (!columns) return [];
        const heading = this.theme.fg("toolTitle", `${plain(this.title)} · ${this.status}`);
        return [...wrapProse(heading, columns), "", ...this.body.render(columns)];
    }
}

/** Message shells, unlike tool-shell children, receive the current outputPad from Pi. */
export const renderPlanMessage: MessageRenderer = (message, options, theme) => {
    const details = message.details as { title?: string; plan?: string } | undefined;
    const body = details?.plan ?? (typeof message.content === "string"
        ? message.content
        : message.content.filter((part) => part.type === "text").map((part) => part.text).join(
            "\n",
        ));
    const card = new PlanChatCard(details?.title ?? "Plan", body, theme, "ready");
    return {
        invalidate: () => card.invalidate(),
        render(width) {
            const columns = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
            const pad = options.outputPad === 1 && columns >= 3 ? " " : "";
            return card.render(columns - pad.length * 2).map((line) => pad + line + pad);
        },
    };
};

export function renderPlanQuestionCall(args: unknown, theme: Theme): PlanChatCard {
    const questions = (args as { questions?: PlanModeQuestion[] } | undefined)?.questions;
    const body = Array.isArray(questions)
        ? questions.map((question) =>
            [
                `### ${literal(question.header ?? "Question")}`,
                literal(question.question ?? ""),
                ...(Array.isArray(question.options)
                    ? question.options.map((option, index) =>
                        `${index + 1}. ${literal(option.label)}${
                            option.description ? ` — ${literal(option.description)}` : ""
                        }`
                    )
                    : []),
            ].join("\n\n")
        ).join("\n\n")
        : "Preparing questions.";
    return new PlanChatCard("Plan · Questions", body, theme, "waiting");
}

function questionDetails(result: ChatResult): {
    cancelled?: boolean;
    answers?: PlanModeQuestionAnswer[];
} | undefined {
    if (result.details && typeof result.details === "object") return result.details;
    for (const part of result.content) {
        if (part.type !== "text" || !part.text) continue;
        try {
            const parsed = JSON.parse(part.text);
            if (parsed && typeof parsed === "object") return parsed;
        } catch {
            // Legacy results can be prose rather than JSON.
        }
    }
    return undefined;
}

export function renderPlanQuestionResult(
    result: ChatResult,
    options: { isPartial: boolean },
    theme: Theme,
): PlanChatCard {
    if (options.isPartial) {
        return new PlanChatCard("Plan · Answers", "Waiting for answers", theme, "waiting");
    }
    const details = questionDetails(result);
    const answers = details?.answers;
    const body = Array.isArray(answers)
        ? answers.map((answer) =>
            [
                `### ${literal(answer.header ?? "Answer")}`,
                literal(answer.question ?? ""),
                `Answer: ${answer.optionIndex ? `${answer.optionIndex}. ` : ""}${
                    literal(answer.answer)
                }`,
                ...(answer.note ? [`Note: ${literal(answer.note)}`] : []),
            ].join("\n\n")
        ).join("\n\n")
        : result.content.filter((part) => part.type === "text").map((part) =>
            plain(part.text ?? "")
        )
            .join("\n");
    return new PlanChatCard(
        "Plan · Answers",
        body,
        theme,
        details?.cancelled ? "cancelled" : "answered",
    );
}

export function renderPlanCompletionCall(_args: unknown, theme: Theme): PlanChatCard {
    return new PlanChatCard("Plan", "Preparing the completed plan for review.", theme, "waiting");
}
