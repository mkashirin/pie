import type { Keybinding } from "@earendil-works/pi-tui";

export interface InteractionKeybindings {
    matches(data: string, action: Keybinding): boolean;
    getKeys(action: Keybinding): readonly string[];
}
export interface InteractionHint {
    bindings?: readonly Keybinding[];
    keys?: readonly string[];
    label: string;
}

export function formatHintKeys(keys: readonly string[]): string {
    const arrows: Record<string, string> = { up: "↑", down: "↓", left: "←", right: "→" };
    return [...new Set(keys)].map((key) =>
        key.split("+").map((part) =>
            arrows[part] ?? (part === "alt" && process.platform === "darwin" ? "option" : part)
        ).join("+")
    ).join("/");
}

export function formatInteractionHints(
    keybindings: InteractionKeybindings,
    hints: readonly InteractionHint[],
): string {
    return hints.map((hint) => {
        const keys = [
            ...(hint.keys ?? []),
            ...(hint.bindings ?? []).flatMap((id) => [...keybindings.getKeys(id)]),
        ];
        const label = formatHintKeys(keys);
        return label ? `${label} ${hint.label}` : "";
    }).filter(Boolean).join(" · ");
}
