import {
    formatInteractionHints as kitInteractionHints,
    type InteractionHint,
    type InteractionKeybindings,
} from "@narumitw/pi-tui-kit";

/** Adapt vendor chrome only, never user/model text. Uses the injected keybinding manager. */
export function formatInteractionHints(
    keybindings: InteractionKeybindings,
    hints: readonly InteractionHint[],
): string {
    return kitInteractionHints(keybindings, hints, { separator: "·" });
}

const arrowKeys: Readonly<Record<string, string>> = { up: "↑", down: "↓", left: "←", right: "→" };

/** Native arrow-key hints; retain platform-specific Option naming. */
export function formatHintKeys(keys: readonly string[]): string {
    return [...new Set(keys)].map((key) =>
        key.split("+").map((part) =>
            arrowKeys[part.toLowerCase()]
                ?? (process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part)
        ).join("+")
    ).join("/");
}
