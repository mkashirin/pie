import { PLAN_MODE_COMPLETE_TOOL_NAME, planFromCompletionDetails } from "./completion-tool.ts";
import type { ActiveImplementationPlan } from "./state.ts";

export const PLAN_IMPLEMENTATION_CONTEXT_MESSAGE_TYPE = "plan-mode-implementation-context";
export const PLAN_HISTORY_IMPLEMENTATION_PROMPT = "Implement the plan.";
export type ProposedPlanParseResult =
    | { kind: "absent" }
    | { kind: "valid"; plan: string }
    | { kind: "empty" }
    | { kind: "multiple" }
    | { kind: "malformed" }
    | { kind: "unclosed" };

const object = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;

export function parseProposedPlan(text: string): ProposedPlanParseResult {
    const opens = [...text.matchAll(/<proposed_plan>/gu)];
    const closes = [...text.matchAll(/<\/proposed_plan>/gu)];
    const mentions = text.match(/<\/?proposed_plan\b/gu)?.length ?? 0;
    if (!mentions) return { kind: "absent" };
    if (mentions !== opens.length + closes.length) return { kind: "malformed" };
    if (opens.length > 1 || closes.length > 1) return { kind: "multiple" };
    if (opens.length === 1 && closes.length === 0) return { kind: "unclosed" };
    if (opens.length !== 1 || closes[0]!.index! < opens[0]!.index!) return { kind: "malformed" };
    const plan = text.slice(opens[0]!.index! + "<proposed_plan>".length, closes[0]!.index).trim();
    return plan ? { kind: "valid", plan } : { kind: "empty" };
}
export function invalidPlanMessage(kind: "empty" | "multiple" | "malformed" | "unclosed"): string {
    return `The proposed plan is ${kind}. Use plan_mode_complete alone with one complete, nonblank Markdown plan.`;
}
export function messageTextContent(message: unknown): string {
    const content = object(message)?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((part) => object(part)?.type === "text")
        .map((part) => typeof part.text === "string" ? part.text : "").join("\n");
}
function latestAssistant(messages: unknown): Record<string, unknown> | undefined {
    if (!Array.isArray(messages)) return undefined;
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = object(messages[index]);
        if (message?.role === "assistant") return message;
    }
    return undefined;
}
export function latestAssistantText(messages: unknown): string {
    return messageTextContent(latestAssistant(messages));
}
export function latestAssistantStopReason(messages: unknown): string | undefined {
    const reason = latestAssistant(messages)?.stopReason;
    return typeof reason === "string" ? reason : undefined;
}
export function messageContainsLegacyPlanModeContextArtifact(message: unknown): boolean {
    const value = object(message);
    return value?.role === "custom"
        && ["plan-mode-context", "plan-mode-prompt"].includes(String(value.customType));
}
export function messageContainsPlanModeImplementationContextArtifact(message: unknown): boolean {
    const value = object(message);
    return value?.role === "custom"
        && value.customType === PLAN_IMPLEMENTATION_CONTEXT_MESSAGE_TYPE;
}
export function injectActiveImplementationContext(
    messages: unknown[],
    activeImplementation: ActiveImplementationPlan,
): unknown[] {
    const retained = messages.filter((message) =>
        !messageContainsPlanModeImplementationContextArtifact(message)
    );
    const context = {
        role: "custom",
        customType: PLAN_IMPLEMENTATION_CONTEXT_MESSAGE_TYPE,
        content: `Approved implementation plan:\n\n${activeImplementation.plan}`,
        display: false,
        details: { version: 1, implementationId: activeImplementation.id },
        timestamp: activeImplementation.startedAt,
    };
    let index = 0;
    while (
        ["system", "compactionSummary", "branchSummary"].includes(
            String(object(retained[index])?.role),
        )
    ) index++;
    return [...retained.slice(0, index), context, ...retained.slice(index)];
}
export function messageContainsInactivePlanModeArtifact(message: unknown): boolean {
    const value = object(message);
    return messageContainsLegacyPlanModeContextArtifact(message)
        || value?.role === "custom"
            && ["plan-mode-plan", "plan-mode-ready", "plan-mode-finalize"].includes(
                String(value.customType),
            );
}
interface HistoryImplementationArtifact {
    messageIndex: number;
    kind: "completion" | "legacy" | "presentation";
    toolCallId?: string;
    toolCallMessageIndex?: number;
}
export function findHistoryImplementationArtifact(
    messages: unknown[],
): HistoryImplementationArtifact | undefined {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
        const message = object(messages[messageIndex]);
        if (!message) continue;
        if (
            message.role === "toolResult" && message.toolName === PLAN_MODE_COMPLETE_TOOL_NAME
            && !message.isError && planFromCompletionDetails(message.details)
        ) {
            const toolCallId = typeof message.toolCallId === "string"
                ? message.toolCallId
                : undefined;
            let toolCallMessageIndex: number | undefined;
            if (toolCallId) {
                for (let index = messageIndex - 1; index >= 0; index--) {
                    const previous = object(messages[index]);
                    if (
                        previous?.role === "assistant" && Array.isArray(previous.content)
                        && previous.content.some((part) => {
                            const call = object(part);
                            return call?.type === "toolCall"
                                && call.name === PLAN_MODE_COMPLETE_TOOL_NAME
                                && call.id === toolCallId;
                        })
                    ) {
                        toolCallMessageIndex = index;
                        break;
                    }
                }
            }
            return { messageIndex, kind: "completion", toolCallId, toolCallMessageIndex };
        }
        if (
            message.role === "assistant"
            && parseProposedPlan(messageTextContent(message)).kind === "valid"
        ) {
            return { messageIndex, kind: "legacy" };
        }
        if (
            message.role === "custom"
            && ["plan-mode-plan", "plan-mode-ready"].includes(String(message.customType))
        ) {
            return { messageIndex, kind: "presentation" };
        }
    }
    return undefined;
}
export function messageContainsPlanModeImplementationHandoff(message: unknown): boolean {
    const value = object(message);
    if (value?.role !== "user") return false;
    const text = messageTextContent(message).trim();
    return text === PLAN_HISTORY_IMPLEMENTATION_PROMPT
        || text.startsWith(`${PLAN_HISTORY_IMPLEMENTATION_PROMPT}\n\n`);
}
export function messageContainsExactPlanModeImplementationHandoff(
    message: unknown,
    plan: string,
): boolean {
    return object(message)?.role === "user"
        && messageTextContent(message).trim()
            === `${PLAN_HISTORY_IMPLEMENTATION_PROMPT}\n\n${plan}`.trim();
}
export function stripProposedPlanBlocks(text: string): string {
    return text.replace(/<proposed_plan>[\s\S]*?<\/proposed_plan>/gu, "")
        .replace(/<proposed_plan>[\s\S]*$/u, "").trim();
}
export function stripProposedPlanBlocksFromMessage<T>(message: T): T {
    const value = object(message);
    if (!value || value.role !== "assistant") return message;
    if (typeof value.content === "string") {
        const content = stripProposedPlanBlocks(value.content);
        return content === value.content ? message : { ...message, content };
    }
    if (!Array.isArray(value.content)) return message;
    const content = value.content.map((part: unknown) => {
        const block = object(part);
        return block?.type === "text" && typeof block.text === "string"
            ? { ...block, text: stripProposedPlanBlocks(block.text) }
            : part;
    }).filter((part: unknown) => object(part)?.type !== "text" || object(part)?.text !== "");
    return { ...message, content };
}
export function stripPlanModeCompletionCallsFromMessage<T>(
    message: T,
    preservedToolCallId?: string,
): T {
    const value = object(message);
    if (value?.role !== "assistant" || !Array.isArray(value.content)) return message;
    const content = value.content.filter((part) => {
        const call = object(part);
        return call?.type !== "toolCall" || call.name !== PLAN_MODE_COMPLETE_TOOL_NAME
            || preservedToolCallId !== undefined && call.id === preservedToolCallId;
    });
    return content.length === value.content.length ? message : { ...message, content };
}
export function isEmptyAssistantMessage(message: unknown): boolean {
    const value = object(message);
    if (value?.role !== "assistant") return false;
    if (typeof value.content === "string") return !value.content.trim();
    return Array.isArray(value.content) && value.content.every((part) => {
        const block = object(part);
        return block?.type === "text" && typeof block.text === "string" && !block.text.trim();
    });
}
