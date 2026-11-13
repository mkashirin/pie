import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import type { InteractionKeybindings } from "../hints.ts";

export interface InteractionOwner {
    signal?: AbortSignal;
    isCurrent?: () => boolean;
    onUnsupportedMode?: (ctx: ExtensionContext, mode: string) => void | Promise<void>;
}
export type RunMenuResult =
    | { kind: "closed"; reason: "close" | "back" }
    | { kind: "stale" }
    | { kind: "unsupported"; mode: string };
export interface MenuItem {
    id: string;
    label: string;
    description?: string;
    details?: readonly string[];
    searchText?: string;
    disabled?: boolean;
    disabledReason?: string;
    action?: string;
    to?: string;
    selected?: boolean;
    currentValue?: string;
    values?: readonly string[];
}
export interface MenuScreen {
    kind: "actions" | "detail" | "choice" | "settings" | "input" | "multiSelect";
    title: string;
    lines?: readonly string[];
    items?: readonly MenuItem[];
    actions?: readonly MenuItem[];
    action?: string;
    enableSearch?: boolean;
    viewportSize?: number;
    currentItemId?: string;
    initialItemId?: string;
    initialValue?: string;
    value?: string;
    placeholder?: string;
    submitLabel?: string;
}
export interface MenuScreenContext<State> {
    state: State;
    ctx: ExtensionContext;
    signal: AbortSignal;
}
export interface MenuActionContext<State> extends MenuScreenContext<State> {
    itemId?: string;
    value?: string;
    selected?: boolean;
}
export type MenuActionResult =
    | { kind: "stay" | "rejected" | "close" | "back" }
    | { kind: "navigate"; to: string };
export interface MenuDefinition<State = unknown> {
    start: string;
    screens: Record<string, (context: MenuScreenContext<State>) => MenuScreen>;
    actions?: Record<
        string,
        (
            context: MenuActionContext<State>,
        ) => MenuActionResult | void | Promise<MenuActionResult | void>
    >;
}
export interface RunMenuOptions<State = unknown> extends InteractionOwner {
    getState: () => State;
}
export interface QuestionnaireOption {
    label: string;
    description?: string;
}
export interface QuestionnaireQuestion {
    id: string;
    header: string;
    prompt: string;
    options: readonly QuestionnaireOption[];
}
export interface QuestionnaireAnswer {
    questionId: string;
    answer: string;
    wasCustom: boolean;
    optionIndex?: number;
    note?: string;
}
export interface RunQuestionnaireOptions extends InteractionOwner {
    questions: readonly QuestionnaireQuestion[];
    allowNotes?: boolean;
    title?: string;
}
export type RunQuestionnaireResult = RunMenuResult | {
    kind: "submitted";
    answers: QuestionnaireAnswer[];
};
export interface InteractionTheme {
    fg(role: "accent" | "muted" | "dim" | "error" | "success", text: string): string;
    bold(text: string): string;
}
export interface InteractionTui {
    terminal: { rows: number };
    requestRender(): void;
}
export interface InteractiveComponent extends Component, Focusable {
    dispose(): void;
}
export interface InteractionEnvironment {
    tui: InteractionTui;
    theme: InteractionTheme;
    keybindings: InteractionKeybindings;
}
