import {
    getMarkdownTheme,
    type MessageRenderer,
    type Theme,
} from "@earendil-works/pi-coding-agent";
import {
    Box,
    type Component,
    escapeMarkdownText,
    Markdown,
    sanitizeDisplayText,
    Spacer,
    Text,
    ThemedMarkdown,
    wrapProse,
} from "@pi-extensions/tui";

interface ChatResult {
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
}

type RecordValue = Record<string, unknown>;
type Status = "waiting" | "answered" | "cancelled" | "ready" | "error";

function record(value: unknown): RecordValue {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as RecordValue
        : {};
}

function clean(value: unknown): string {
    return sanitizeDisplayText(typeof value === "string" ? value : "", {
        multiline: true,
        tabs: "space",
        controls: "space",
    }).trim();
}

function prose(value: unknown): string {
    return escapeMarkdownText(clean(value));
}

function contentText(result: ChatResult): string {
    return result.content.filter((block) => block.type === "text")
        .map((block) => block.text ?? "").join("\n");
}

/** Match Pi's custom-message shell, but let its render options own horizontal padding. */
export const renderPlanMessage: MessageRenderer = (message, options, theme) => {
    const box = new Box(options?.outputPad ?? 1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(
        new Text(
            theme.fg("customMessageLabel", theme.bold(`[${message.customType}]`)),
            0,
            0,
        ),
    );
    box.addChild(new Spacer(1));
    const text = typeof message.content === "string"
        ? message.content
        : message.content.filter((block) => block.type === "text").map((block) => block.text)
            .join("\n");
    box.addChild(
        new Markdown(text, 0, 0, getMarkdownTheme(), {
            color: (value) => theme.fg("customMessageText", value),
        }),
    );
    return box;
};

/** Transcript presentation only: payloads, IDs and model-facing JSON remain unchanged. */
export class PlanChatCard implements Component {
    private body: ThemedMarkdown;

    constructor(
        private title: string,
        body: string,
        private theme: Theme,
        private status: Status,
    ) {
        const text = clean(body);
        this.body = new ThemedMarkdown(() => text, getMarkdownTheme);
    }

    invalidate() {
        this.body.invalidate();
    }

    render(width: number): string[] {
        if (!Number.isFinite(width) || width < 1) return [];
        const columns = Math.floor(width);
        const color = this.status === "error"
            ? "error"
            : this.status === "cancelled"
            ? "warning"
            : this.status === "waiting"
            ? "muted"
            : "success";
        const heading = this.theme.fg("accent", this.theme.bold(this.title))
            + " · " + this.theme.fg(color, this.status);
        return [...wrapProse(heading, columns), "", ...this.body.render(columns)];
    }
}

export function renderPlanQuestionCall(args: unknown, theme: Theme) {
    const questions = record(args).questions;
    const body = Array.isArray(questions)
        ? questions.map((value, index) => {
            const question = record(value);
            const options = Array.isArray(question.options) ? question.options : [];
            return [
                `### ${prose(question.header) || `Question ${index + 1}`}`,
                prose(question.question),
                options.map((value, optionIndex) => {
                    const option = record(value);
                    const description = prose(option.description);
                    return `${optionIndex + 1}. **${prose(option.label)}**`
                        + (description ? ` - ${description}` : "");
                }).join("\n"),
            ].filter(Boolean).join("\n\n");
        }).join("\n\n")
        : "_Preparing questions._";
    return new PlanChatCard("Plan · Questions", body, theme, "waiting");
}

export function renderPlanQuestionResult(
    result: ChatResult,
    options: { isPartial: boolean },
    theme: Theme,
) {
    let payload: RecordValue = {};
    const text = contentText(result);
    try {
        payload = record(JSON.parse(text));
    } catch {
        // Plain tool errors are still readable; only structured question results are decoded.
    }
    const details = { ...payload, ...record(result.details) };
    if (details.cancelled === true) {
        const message = prose(details.message) || prose(details.reason) || "Question cancelled.";
        return new PlanChatCard("Plan · Questions", message, theme, "cancelled");
    }
    if (Array.isArray(details.answers)) {
        const body = details.answers.map((value, index) => {
            const answer = record(value);
            const number = Number.isInteger(answer.optionIndex) ? `${answer.optionIndex}. ` : "";
            return [
                `### ${prose(answer.header) || `Question ${index + 1}`}`,
                prose(answer.question),
                `**${answer.wasCustom ? "Custom answer" : "Answer"}:** ${number}${
                    prose(answer.answer)
                }`,
                ...(typeof answer.note === "string" && answer.note
                    ? [`**Note:**\n\n${prose(answer.note)}`]
                    : []),
            ].filter(Boolean).join("\n\n");
        }).join("\n\n");
        return new PlanChatCard("Plan · Answers", body, theme, "answered");
    }
    const body = options.isPartial
        ? "_Waiting for answers._"
        : Object.keys(payload).length
        ? "_No answers available._"
        : prose(text);
    return new PlanChatCard(
        "Plan · Questions",
        body,
        theme,
        options.isPartial ? "waiting" : "error",
    );
}

export function renderPlanCompletionCall(_args: unknown, theme: Theme) {
    return new PlanChatCard("Plan", "_Preparing the implementation plan._", theme, "waiting");
}
