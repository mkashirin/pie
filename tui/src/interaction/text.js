import { inlineText, sanitizeDisplayText } from "../text.ts";

export function safeMenuText(value) {
    return inlineText(String(value));
}

export function replaceTerminalControls(value) {
    return sanitizeDisplayText(String(value), {
        multiline: false,
        tabs: "space",
        controls: "space",
    });
}
