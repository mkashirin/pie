/** Original prompt compatibility contract, derived from the source identified in reference/source.json.
 * Coverage is partial: pending bindings are applicable but not yet supported by the controller.
 * Arguments describe the resolved upstream action, not shadowed defaults.
 */
import { resolvedArguments } from "../reference/resolved-arguments.ts";
export type Mode = "normal" | "select" | "insert" | "replace";
export type Binding = {
    modes: Mode[];
    keys: string[];
    action: string;
    args?: unknown;
    classification: "implemented" | "excluded" | "pi" | "pending";
    reason?: string;
    context?: string;
};
export const bindings: Binding[] = [
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "i",
        ],
        "action": "vim::HelixInsert",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "i",
        ],
        "action": "vim::InsertBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "a",
        ],
        "action": "vim::HelixAppend",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "a",
        ],
        "action": "vim::HelixAppend",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "left",
        ],
        "action": "vim::WrappingLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "left",
        ],
        "action": "vim::WrappingLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "h",
        ],
        "action": "vim::WrappingLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "h",
        ],
        "action": "vim::WrappingLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "backspace",
        ],
        "action": "vim::WrappingLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "backspace",
        ],
        "action": "vim::WrappingLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "down",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "down",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+j",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+j",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "j",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "j",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+m",
        ],
        "action": "vim::NextLineStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+m",
        ],
        "action": "vim::NextLineStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "+",
        ],
        "action": "vim::PreviousLineStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "+",
        ],
        "action": "vim::PreviousLineStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "enter",
        ],
        "action": "vim::NextLineStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "enter",
        ],
        "action": "vim::NextLineStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "shift+tab",
        ],
        "action": "vim::Tab",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "shift+tab",
        ],
        "action": "vim::Tab",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "tab",
        ],
        "action": "vim::Tab",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "tab",
        ],
        "action": "vim::Tab",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "up",
        ],
        "action": "vim::Up",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "up",
        ],
        "action": "vim::Up",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "k",
        ],
        "action": "vim::Up",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "k",
        ],
        "action": "vim::Up",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "right",
        ],
        "action": "vim::WrappingRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "right",
        ],
        "action": "vim::WrappingRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "l",
        ],
        "action": "vim::WrappingRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "l",
        ],
        "action": "vim::WrappingRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
        ],
        "action": "vim::WrappingRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
        ],
        "action": "vim::WrappingRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "end",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "end",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "$",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "$",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "^",
        ],
        "action": "vim::FirstNonWhitespace",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "^",
        ],
        "action": "vim::FirstNonWhitespace",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "_",
        ],
        "action": "vim::HelixTrimSelections",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "_",
        ],
        "action": "vim::HelixTrimSelections",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "_",
        ],
        "action": "vim::EndOfLineDownward",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "_",
        ],
        "action": "vim::EndOfLineDownward",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "G",
        ],
        "action": "vim::HelixGotoLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "G",
        ],
        "action": "vim::HelixGotoLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "{",
        ],
        "action": "vim::StartOfParagraph",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "{",
        ],
        "action": "vim::StartOfParagraph",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "}",
        ],
        "action": "vim::EndOfParagraph",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "}",
        ],
        "action": "vim::EndOfParagraph",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "(",
        ],
        "action": "vim::SentenceBackward",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "(",
        ],
        "action": "vim::SentenceBackward",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            ")",
        ],
        "action": "vim::SentenceForward",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            ")",
        ],
        "action": "vim::SentenceForward",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "|",
        ],
        "action": "vim::GoToColumn",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "|",
        ],
        "action": "vim::GoToColumn",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "w",
        ],
        "action": "vim::NextWordStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "w",
        ],
        "action": "vim::NextWordStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "e",
        ],
        "action": "vim::NextWordEnd",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "e",
        ],
        "action": "vim::NextWordEnd",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "b",
        ],
        "action": "vim::PreviousWordStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "b",
        ],
        "action": "vim::PreviousWordStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "e",
        ],
        "action": "vim::EndOfDocument",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "e",
        ],
        "action": "vim::EndOfDocument",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "W",
        ],
        "action": "vim::NextWordStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "W",
        ],
        "action": "vim::NextWordStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "E",
        ],
        "action": "vim::NextWordEnd",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "E",
        ],
        "action": "vim::NextWordEnd",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "B",
        ],
        "action": "vim::PreviousWordStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "B",
        ],
        "action": "vim::PreviousWordStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "E",
        ],
        "action": "vim::PreviousWordEnd",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "E",
        ],
        "action": "vim::PreviousWordEnd",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "/",
        ],
        "action": "vim::Search",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "/",
        ],
        "action": "vim::Search",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "/",
        ],
        "action": "pane::DeploySearch",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "/",
        ],
        "action": "pane::DeploySearch",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "?",
        ],
        "action": "vim::Search",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "?",
        ],
        "action": "vim::Search",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "*",
        ],
        "action": "buffer_search::UseSelectionForFind",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "*",
        ],
        "action": "buffer_search::UseSelectionForFind",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "#",
        ],
        "action": "vim::MoveToPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "#",
        ],
        "action": "vim::MoveToPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "n",
        ],
        "action": "vim::HelixSelectNext",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "n",
        ],
        "action": "vim::HelixSelectNext",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "N",
        ],
        "action": "vim::HelixSelectPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "N",
        ],
        "action": "vim::HelixSelectPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "%",
        ],
        "action": "editor::SelectAll",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "%",
        ],
        "action": "editor::SelectAll",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "f",
        ],
        "action": "vim::PushFindForward",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "f",
        ],
        "action": "vim::PushFindForward",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "t",
        ],
        "action": "vim::PushFindForward",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "t",
        ],
        "action": "vim::PushFindForward",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "F",
        ],
        "action": "vim::PushFindBackward",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "F",
        ],
        "action": "vim::PushFindBackward",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "T",
        ],
        "action": "vim::PushFindBackward",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "T",
        ],
        "action": "vim::PushFindBackward",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "m",
        ],
        "action": "vim::PushHelixMatch",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "m",
        ],
        "action": "vim::PushHelixMatch",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "'",
        ],
        "action": "vim::PushJump",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "'",
        ],
        "action": "vim::PushJump",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "`",
        ],
        "action": "vim::ConvertToLowerCase",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "`",
        ],
        "action": "vim::ConvertToLowerCase",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            ";",
        ],
        "action": "vim::HelixCollapseSelection",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            ";",
        ],
        "action": "vim::HelixCollapseSelection",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            ",",
        ],
        "action": "vim::HelixKeepNewestSelection",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            ",",
        ],
        "action": "vim::HelixKeepNewestSelection",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+o",
        ],
        "action": "pane::GoBack",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+o",
        ],
        "action": "pane::GoBack",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+i",
        ],
        "action": "pane::GoForward",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+i",
        ],
        "action": "pane::GoForward",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+]",
        ],
        "action": "editor::GoToDefinition",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+]",
        ],
        "action": "editor::GoToDefinition",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+t",
        ],
        "action": "pane::GoToOlderTag",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+t",
        ],
        "action": "pane::GoToOlderTag",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "escape",
        ],
        "action": "vim::SwitchToHelixNormalMode",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "escape",
        ],
        "action": "vim::SwitchToHelixNormalMode",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+[",
        ],
        "action": "editor::Cancel",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+[",
        ],
        "action": "vim::SwitchToNormalMode",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "v",
        ],
        "action": "vim::ToggleVisual",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "v",
        ],
        "action": "vim::NormalBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "V",
        ],
        "action": "vim::ToggleVisualLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "V",
        ],
        "action": "vim::ToggleVisualLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+g",
        ],
        "action": "vim::ShowLocation",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+g",
        ],
        "action": "vim::ShowLocation",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+v",
        ],
        "action": "vim::ToggleVisualBlock",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+v",
        ],
        "action": "vim::ToggleVisualBlock",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+q",
        ],
        "action": "vim::ToggleVisualBlock",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+q",
        ],
        "action": "vim::ToggleVisualBlock",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "K",
        ],
        "action": "editor::Hover",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "K",
        ],
        "action": "editor::Hover",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "R",
        ],
        "action": "vim::HelixReplaceWithYanked",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "R",
        ],
        "action": "vim::HelixReplaceWithYanked",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "0",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "0",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "home",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "home",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+f",
        ],
        "action": "vim::PageDown",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+f",
        ],
        "action": "vim::PageDown",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "pagedown",
        ],
        "action": "vim::PageDown",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "pagedown",
        ],
        "action": "vim::PageDown",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+b",
        ],
        "action": "vim::PageUp",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+b",
        ],
        "action": "vim::PageUp",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "pageup",
        ],
        "action": "vim::PageUp",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "pageup",
        ],
        "action": "vim::PageUp",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+d",
        ],
        "action": "vim::ScrollDown",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+d",
        ],
        "action": "vim::ScrollDown",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+u",
        ],
        "action": "vim::ScrollUp",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+u",
        ],
        "action": "vim::ScrollUp",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+e",
        ],
        "action": "vim::LineDown",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+e",
        ],
        "action": "vim::LineDown",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+y",
        ],
        "action": "vim::LineUp",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+y",
        ],
        "action": "vim::LineUp",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "R",
        ],
        "action": "git::Restore",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "R",
        ],
        "action": "git::Restore",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "r",
            "n",
        ],
        "action": "editor::Rename",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "r",
            "n",
        ],
        "action": "editor::Rename",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "r",
            "r",
        ],
        "action": "editor::FindAllReferences",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "r",
            "r",
        ],
        "action": "editor::FindAllReferences",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "r",
            "i",
        ],
        "action": "editor::GoToImplementation",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "r",
            "i",
        ],
        "action": "editor::GoToImplementation",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "r",
            "a",
        ],
        "action": "editor::ToggleCodeActions",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "r",
            "a",
        ],
        "action": "editor::ToggleCodeActions",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "g",
        ],
        "action": "vim::StartOfDocument",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "g",
        ],
        "action": "vim::StartOfDocument",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "h",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "h",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "B",
        ],
        "action": "editor::BlameHover",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "B",
        ],
        "action": "editor::BlameHover",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "d",
        ],
        "action": "editor::GoToDefinition",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "d",
        ],
        "action": "editor::GoToDefinition",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "D",
        ],
        "action": "editor::GoToDeclaration",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "D",
        ],
        "action": "editor::GoToDeclaration",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "y",
        ],
        "action": "editor::GoToTypeDefinition",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "y",
        ],
        "action": "editor::GoToTypeDefinition",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "I",
        ],
        "action": "editor::GoToImplementation",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "I",
        ],
        "action": "editor::GoToImplementation",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "x",
        ],
        "action": "editor::OpenUrl",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "x",
        ],
        "action": "editor::OpenUrl",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "f",
        ],
        "action": "editor::OpenSelectedFilename",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "f",
        ],
        "action": "editor::OpenSelectedFilename",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "n",
        ],
        "action": "pane::ActivateNextItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "n",
        ],
        "action": "pane::ActivateNextItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "N",
        ],
        "action": "vim::SelectPreviousMatch",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "N",
        ],
        "action": "vim::SelectPreviousMatch",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "l",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "l",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "L",
        ],
        "action": "vim::SelectPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "L",
        ],
        "action": "vim::SelectPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            ">",
        ],
        "action": "editor::SelectNext",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            ">",
        ],
        "action": "editor::SelectNext",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "<",
        ],
        "action": "editor::SelectPrevious",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "<",
        ],
        "action": "editor::SelectPrevious",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "a",
        ],
        "action": "pane::AlternateFile",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "a",
        ],
        "action": "pane::AlternateFile",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "s",
        ],
        "action": "vim::FirstNonWhitespace",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "s",
        ],
        "action": "vim::FirstNonWhitespace",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "O",
        ],
        "action": "git::ToggleStaged",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "O",
        ],
        "action": "git::ToggleStaged",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "S",
        ],
        "action": "project_symbols::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "S",
        ],
        "action": "project_symbols::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            ".",
        ],
        "action": "vim::HelixGotoLastModification",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            ".",
        ],
        "action": "vim::HelixGotoLastModification",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "A",
        ],
        "action": "editor::FindAllReferences",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "A",
        ],
        "action": "editor::FindAllReferences",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "space",
        ],
        "action": "editor::OpenExcerpts",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "space",
        ],
        "action": "editor::OpenExcerpts",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "*",
        ],
        "action": "vim::MoveToNext",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "*",
        ],
        "action": "vim::MoveToNext",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "#",
        ],
        "action": "vim::MoveToPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "#",
        ],
        "action": "vim::MoveToPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "j",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "j",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "down",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "down",
        ],
        "action": "vim::Down",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "k",
        ],
        "action": "vim::Up",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "k",
        ],
        "action": "vim::Up",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "up",
        ],
        "action": "vim::Up",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "up",
        ],
        "action": "vim::Up",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "$",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "$",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "end",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "end",
        ],
        "action": "vim::EndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "0",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "0",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "home",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "home",
        ],
        "action": "vim::StartOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "M",
        ],
        "action": "vim::MiddleOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "M",
        ],
        "action": "vim::MiddleOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "^",
        ],
        "action": "vim::FirstNonWhitespace",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "^",
        ],
        "action": "vim::FirstNonWhitespace",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "v",
        ],
        "action": "vim::RestoreVisualSelection",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "v",
        ],
        "action": "vim::RestoreVisualSelection",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "]",
        ],
        "action": "editor::GoToDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "]",
        ],
        "action": "editor::GoToDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "[",
        ],
        "action": "editor::GoToPreviousDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "[",
        ],
        "action": "editor::GoToPreviousDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "i",
        ],
        "action": "editor::GoToImplementation",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "i",
        ],
        "action": "editor::GoToImplementation",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            ",",
        ],
        "action": "vim::ChangeListNewer",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            ",",
        ],
        "action": "vim::ChangeListNewer",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            ";",
        ],
        "action": "vim::ChangeListOlder",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            ";",
        ],
        "action": "vim::ChangeListOlder",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "H",
        ],
        "action": "pane::ActivatePreviousItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "H",
        ],
        "action": "pane::ActivatePreviousItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "M",
        ],
        "action": "vim::WindowMiddle",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "M",
        ],
        "action": "vim::WindowMiddle",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "L",
        ],
        "action": "pane::ActivateNextItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "L",
        ],
        "action": "pane::ActivateNextItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "q",
        ],
        "action": "vim::ReplayLastRecording",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "q",
        ],
        "action": "vim::ReplayLastRecording",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "Q",
        ],
        "action": "vim::ToggleRecord",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "Q",
        ],
        "action": "vim::ToggleRecord",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "@",
        ],
        "action": "vim::PushReplayRegister",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "@",
        ],
        "action": "vim::PushReplayRegister",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "enter",
        ],
        "action": "workspace::SendKeystrokes",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "enter",
        ],
        "action": "workspace::SendKeystrokes",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "+",
        ],
        "action": "workspace::SendKeystrokes",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "+",
        ],
        "action": "workspace::SendKeystrokes",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "^",
        ],
        "action": "workspace::SendKeystrokes",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "^",
        ],
        "action": "workspace::SendKeystrokes",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "t",
        ],
        "action": "editor::ScrollCursorTop",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "t",
        ],
        "action": "editor::ScrollCursorTop",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "z",
        ],
        "action": "editor::ScrollCursorCenter",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "z",
        ],
        "action": "editor::ScrollCursorCenter",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            ".",
        ],
        "action": "workspace::SendKeystrokes",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            ".",
        ],
        "action": "workspace::SendKeystrokes",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "b",
        ],
        "action": "editor::ScrollCursorBottom",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "b",
        ],
        "action": "editor::ScrollCursorBottom",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "a",
        ],
        "action": "editor::ToggleFold",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "a",
        ],
        "action": "editor::ToggleFold",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "A",
        ],
        "action": "editor::ToggleFoldRecursive",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "A",
        ],
        "action": "editor::ToggleFoldRecursive",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "c",
        ],
        "action": "editor::ScrollCursorCenter",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "c",
        ],
        "action": "editor::ScrollCursorCenter",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "C",
        ],
        "action": "editor::FoldRecursive",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "C",
        ],
        "action": "editor::FoldRecursive",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "o",
        ],
        "action": "editor::UnfoldLines",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "o",
        ],
        "action": "editor::UnfoldLines",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "O",
        ],
        "action": "editor::UnfoldRecursive",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "O",
        ],
        "action": "editor::UnfoldRecursive",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "f",
        ],
        "action": "editor::FoldSelectedRanges",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "f",
        ],
        "action": "editor::FoldSelectedRanges",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "M",
        ],
        "action": "editor::FoldAll",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "M",
        ],
        "action": "editor::FoldAll",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "R",
        ],
        "action": "editor::UnfoldAll",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "R",
        ],
        "action": "editor::UnfoldAll",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "l",
        ],
        "action": "vim::ColumnRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "l",
        ],
        "action": "vim::ColumnRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "h",
        ],
        "action": "vim::ColumnLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "h",
        ],
        "action": "vim::ColumnLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "L",
        ],
        "action": "vim::HalfPageRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "L",
        ],
        "action": "vim::HalfPageRight",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
            "H",
        ],
        "action": "vim::HalfPageLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
            "H",
        ],
        "action": "vim::HalfPageLeft",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "Z",
            "Q",
        ],
        "action": "pane::CloseActiveItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "Z",
            "Q",
        ],
        "action": "pane::CloseActiveItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "Z",
            "Z",
        ],
        "action": "pane::CloseActiveItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "Z",
            "Z",
        ],
        "action": "pane::CloseActiveItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "1",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "1",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "2",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "2",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "3",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "3",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "4",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "4",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "5",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "5",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "6",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "6",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "7",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "7",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "8",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "8",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "9",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "9",
        ],
        "action": "vim::Number",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+w",
            "d",
        ],
        "action": "editor::GoToDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+w",
            "d",
        ],
        "action": "editor::GoToDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+w",
            "g",
            "d",
        ],
        "action": "editor::GoToDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+w",
            "g",
            "d",
        ],
        "action": "editor::GoToDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+w",
            "]",
        ],
        "action": "editor::GoToDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+w",
            "]",
        ],
        "action": "editor::GoToDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+w",
            "ctrl+]",
        ],
        "action": "editor::GoToDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+w",
            "ctrl+]",
        ],
        "action": "editor::GoToDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+w",
            "D",
        ],
        "action": "editor::GoToTypeDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+w",
            "D",
        ],
        "action": "editor::GoToTypeDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+w",
            "g",
            "D",
        ],
        "action": "editor::GoToTypeDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+w",
            "g",
            "D",
        ],
        "action": "editor::GoToTypeDefinitionSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+w",
            "space",
        ],
        "action": "editor::OpenExcerptsSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+w",
            "space",
        ],
        "action": "editor::OpenExcerptsSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+w",
            "g",
            "space",
        ],
        "action": "editor::OpenExcerptsSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+w",
            "g",
            "space",
        ],
        "action": "editor::OpenExcerptsSplit",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+^",
        ],
        "action": "pane::AlternateFile",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+^",
        ],
        "action": "pane::AlternateFile",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            ".",
        ],
        "action": "vim::Repeat",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            ".",
        ],
        "action": "vim::Repeat",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "~",
        ],
        "action": "vim::ChangeCase",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+a",
        ],
        "action": "vim::Increment",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+x",
        ],
        "action": "vim::Decrement",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "J",
        ],
        "action": "vim::JoinLines",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "o",
        ],
        "action": "vim::InsertLineBelow",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "O",
        ],
        "action": "vim::InsertLineAbove",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "p",
        ],
        "action": "vim::HelixPaste",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "u",
        ],
        "action": "vim::Undo",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "r",
        ],
        "action": "vim::PushReplace",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "s",
        ],
        "action": "vim::HelixSelectRegex",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+pageup",
        ],
        "action": "pane::ActivatePreviousItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+pagedown",
        ],
        "action": "pane::ActivateNextItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+.",
        ],
        "action": "vim::RepeatFind",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+c",
        ],
        "action": "vim::NormalBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+[",
        ],
        "action": "vim::NormalBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "escape",
        ],
        "action": "vim::NormalBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+x",
            "ctrl+o",
        ],
        "action": "editor::ShowCompletions",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+x",
            "ctrl+a",
        ],
        "action": "assistant::InlineAssist",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+x",
            "ctrl+c",
        ],
        "action": "editor::ShowEditPrediction",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+x",
            "ctrl+l",
        ],
        "action": "editor::ToggleCodeActions",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+x",
            "ctrl+z",
        ],
        "action": "editor::Cancel",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+x",
            "ctrl+e",
        ],
        "action": "vim::LineDown",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+x",
            "ctrl+y",
        ],
        "action": "vim::LineUp",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+w",
        ],
        "action": "editor::DeleteToPreviousWordStart",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+u",
        ],
        "action": "editor::DeleteToBeginningOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+t",
        ],
        "action": "vim::Indent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+d",
        ],
        "action": "vim::Outdent",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+y",
        ],
        "action": "vim::InsertFromAbove",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+e",
        ],
        "action": "vim::InsertFromBelow",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+k",
        ],
        "action": "vim::PushDigraph",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+v",
        ],
        "action": "vim::PushLiteral",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+V",
        ],
        "action": "editor::Paste",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+q",
        ],
        "action": "vim::PushLiteral",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+Q",
        ],
        "action": "vim::PushLiteral",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+r",
        ],
        "action": "vim::PushRegister",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "insert",
        ],
        "action": "vim::ToggleReplace",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+o",
        ],
        "action": "vim::TemporaryNormal",
        "classification": "implemented",
    },
    {
        "modes": [
            "insert",
        ],
        "keys": [
            "ctrl+s",
        ],
        "action": "editor::ShowSignatureHelp",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "D",
        ],
        "action": "vim::DeleteToEndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "J",
        ],
        "action": "vim::JoinLines",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "Y",
        ],
        "action": "vim::YankLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "I",
        ],
        "action": "vim::InsertFirstNonWhitespace",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "A",
        ],
        "action": "vim::HelixInsertEndOfLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "o",
        ],
        "action": "vim::InsertLineBelow",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "O",
        ],
        "action": "vim::InsertLineAbove",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "~",
        ],
        "action": "vim::ChangeCase",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+a",
        ],
        "action": "vim::Increment",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+x",
        ],
        "action": "vim::Decrement",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "p",
        ],
        "action": "vim::HelixPaste",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "P",
        ],
        "action": "vim::HelixPaste",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "u",
        ],
        "action": "vim::Undo",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "U",
        ],
        "action": "editor::Redo",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "r",
        ],
        "action": "vim::PushReplace",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "s",
        ],
        "action": "vim::HelixSelectRegex",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "S",
        ],
        "action": "vim::SubstituteLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "\"",
        ],
        "action": "vim::PushRegister",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+pagedown",
        ],
        "action": "pane::ActivateNextItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+pageup",
        ],
        "action": "pane::ActivatePreviousItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+.",
        ],
        "action": "vim::RepeatFind",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+b",
        ],
        "action": "editor::MoveToStartOfLargerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+b",
        ],
        "action": "editor::MoveToStartOfLargerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+e",
        ],
        "action": "editor::MoveToEndOfLargerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+e",
        ],
        "action": "editor::MoveToEndOfLargerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+`",
        ],
        "action": "vim::ConvertToUpperCase",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+`",
        ],
        "action": "vim::ConvertToUpperCase",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "insert",
        ],
        "action": "vim::InsertBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "insert",
        ],
        "action": "vim::InsertBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "U",
        ],
        "action": "editor::Redo",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+r",
        ],
        "action": "vim::Redo",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+r",
        ],
        "action": "vim::Redo",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "y",
        ],
        "action": "vim::HelixYank",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "y",
        ],
        "action": "vim::HelixYank",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "P",
        ],
        "action": "vim::HelixPaste",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            ">",
        ],
        "action": "vim::Indent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            ">",
        ],
        "action": "vim::Indent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "<",
        ],
        "action": "vim::Outdent",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "<",
        ],
        "action": "vim::Outdent",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "=",
        ],
        "action": "vim::AutoIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "=",
        ],
        "action": "vim::AutoIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "d",
        ],
        "action": "vim::HelixDelete",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "d",
        ],
        "action": "vim::HelixDelete",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+d",
        ],
        "action": "editor::Delete",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+d",
        ],
        "action": "editor::Delete",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::HelixSubstitute",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::HelixSubstitute",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+c",
        ],
        "action": "vim::HelixSubstituteNoYank",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+c",
        ],
        "action": "vim::HelixSubstituteNoYank",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+s",
        ],
        "action": "editor::SplitSelectionIntoLines",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+s",
        ],
        "action": "editor::SplitSelectionIntoLines",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+;",
        ],
        "action": "vim::OtherEnd",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+;",
        ],
        "action": "vim::OtherEnd",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "C",
        ],
        "action": "vim::HelixDuplicateBelow",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "C",
        ],
        "action": "vim::HelixDuplicateBelow",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+C",
        ],
        "action": "vim::HelixDuplicateAbove",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+C",
        ],
        "action": "vim::HelixDuplicateAbove",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "x",
        ],
        "action": "vim::HelixSelectLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "x",
        ],
        "action": "vim::HelixSelectLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "X",
        ],
        "action": "editor::SelectLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "X",
        ],
        "action": "editor::SelectLine",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+c",
        ],
        "action": "editor::ToggleComments",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+c",
        ],
        "action": "editor::ToggleComments",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+o",
        ],
        "action": "editor::SelectLargerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+o",
        ],
        "action": "editor::SelectLargerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+i",
        ],
        "action": "editor::SelectSmallerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+i",
        ],
        "action": "editor::SelectSmallerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+p",
        ],
        "action": "editor::SelectPreviousSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+p",
        ],
        "action": "editor::SelectPreviousSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "alt+n",
        ],
        "action": "editor::SelectNextSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "alt+n",
        ],
        "action": "editor::SelectNextSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "t",
        ],
        "action": "vim::WindowTop",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "t",
        ],
        "action": "vim::WindowTop",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "c",
        ],
        "action": "vim::WindowMiddle",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "c",
        ],
        "action": "vim::WindowMiddle",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "b",
        ],
        "action": "vim::WindowBottom",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "b",
        ],
        "action": "vim::WindowBottom",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "r",
        ],
        "action": "editor::FindAllReferences",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "r",
        ],
        "action": "editor::FindAllReferences",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "p",
        ],
        "action": "pane::ActivatePreviousItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "p",
        ],
        "action": "pane::ActivatePreviousItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "w",
        ],
        "action": "vim::HelixJumpToWord",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "w",
        ],
        "action": "vim::HelixJumpToWord",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "o",
        ],
        "action": "editor::ToggleSelectedDiffHunks",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "o",
        ],
        "action": "editor::ToggleSelectedDiffHunks",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "u",
        ],
        "action": "git::StageAndNext",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "u",
        ],
        "action": "git::StageAndNext",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "U",
        ],
        "action": "git::UnstageAndNext",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "U",
        ],
        "action": "git::UnstageAndNext",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "w",
            "v",
        ],
        "action": "pane::SplitRight",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "w",
            "v",
        ],
        "action": "pane::SplitRight",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "w",
            "s",
        ],
        "action": "pane::SplitDown",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "w",
            "s",
        ],
        "action": "pane::SplitDown",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "w",
            "h",
        ],
        "action": "workspace::ActivatePaneLeft",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "w",
            "h",
        ],
        "action": "workspace::ActivatePaneLeft",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "w",
            "j",
        ],
        "action": "workspace::ActivatePaneDown",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "w",
            "j",
        ],
        "action": "workspace::ActivatePaneDown",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "w",
            "k",
        ],
        "action": "workspace::ActivatePaneUp",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "w",
            "k",
        ],
        "action": "workspace::ActivatePaneUp",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "w",
            "l",
        ],
        "action": "workspace::ActivatePaneRight",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "w",
            "l",
        ],
        "action": "workspace::ActivatePaneRight",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "w",
            "q",
        ],
        "action": "pane::CloseActiveItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "w",
            "q",
        ],
        "action": "pane::CloseActiveItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "w",
            "r",
        ],
        "action": "pane::SplitRight",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "w",
            "r",
        ],
        "action": "pane::SplitRight",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "w",
            "d",
        ],
        "action": "pane::SplitDown",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "w",
            "d",
        ],
        "action": "pane::SplitDown",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "b",
        ],
        "action": "tab_switcher::OpenInActivePane",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "b",
        ],
        "action": "tab_switcher::OpenInActivePane",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "f",
        ],
        "action": "file_finder::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "f",
        ],
        "action": "file_finder::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "k",
        ],
        "action": "editor::Hover",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "k",
        ],
        "action": "editor::Hover",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "s",
        ],
        "action": "outline::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "s",
        ],
        "action": "outline::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "S",
        ],
        "action": "project_symbols::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "S",
        ],
        "action": "project_symbols::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "d",
        ],
        "action": "editor::GoToDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "d",
        ],
        "action": "editor::GoToDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "r",
        ],
        "action": "editor::Rename",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "r",
        ],
        "action": "editor::Rename",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "a",
        ],
        "action": "editor::ToggleCodeActions",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "a",
        ],
        "action": "editor::ToggleCodeActions",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "h",
        ],
        "action": "editor::SelectAllMatches",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "h",
        ],
        "action": "editor::SelectAllMatches",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "c",
        ],
        "action": "editor::ToggleComments",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "c",
        ],
        "action": "editor::ToggleComments",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "p",
        ],
        "action": "editor::Paste",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "p",
        ],
        "action": "editor::Paste",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "y",
        ],
        "action": "editor::Copy",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "y",
        ],
        "action": "editor::Copy",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "/",
        ],
        "action": "pane::DeploySearch",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "/",
        ],
        "action": "pane::DeploySearch",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "l",
        ],
        "action": "debugger::Start",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "l",
        ],
        "action": "debugger::Start",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "r",
        ],
        "action": "debugger::Restart",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "r",
        ],
        "action": "debugger::Restart",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "b",
        ],
        "action": "editor::ToggleBreakpoint",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "b",
        ],
        "action": "editor::ToggleBreakpoint",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "c",
        ],
        "action": "debugger::Continue",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "c",
        ],
        "action": "debugger::Continue",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "h",
        ],
        "action": "debugger::Pause",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "h",
        ],
        "action": "debugger::Pause",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "i",
        ],
        "action": "debugger::StepInto",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "i",
        ],
        "action": "debugger::StepInto",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "o",
        ],
        "action": "debugger::StepOut",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "o",
        ],
        "action": "debugger::StepOut",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "n",
        ],
        "action": "debugger::StepOver",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "n",
        ],
        "action": "debugger::StepOver",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "t",
        ],
        "action": "debugger::Stop",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "t",
        ],
        "action": "debugger::Stop",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
            "G",
            "ctrl+l",
        ],
        "action": "editor::EditLogBreakpoint",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
            "G",
            "ctrl+l",
        ],
        "action": "editor::EditLogBreakpoint",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            ":",
        ],
        "action": "command_palette::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            ":",
        ],
        "action": "command_palette::Toggle",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "]",
        ],
        "action": "vim::PushHelixNext",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "]",
        ],
        "action": "vim::PushHelixNext",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "[",
        ],
        "action": "vim::PushHelixPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "[",
        ],
        "action": "vim::PushHelixPrevious",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "ctrl+s",
        ],
        "action": "editor::SaveLocation",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "ctrl+s",
        ],
        "action": "editor::SaveLocation",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
            "q",
        ],
        "action": "vim::PushRewrap",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
            "q",
        ],
        "action": "vim::PushRewrap",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "ctrl+c",
        ],
        "action": "vim::NormalBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "ctrl+[",
        ],
        "action": "vim::NormalBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "escape",
        ],
        "action": "vim::NormalBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "ctrl+k",
        ],
        "action": "vim::PushDigraph",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "ctrl+v",
        ],
        "action": "vim::PushLiteral",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "ctrl+V",
        ],
        "action": "editor::Paste",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "ctrl+q",
        ],
        "action": "vim::PushLiteral",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "ctrl+Q",
        ],
        "action": "vim::PushLiteral",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "backspace",
        ],
        "action": "vim::UndoReplace",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "tab",
        ],
        "action": "vim::Tab",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "enter",
        ],
        "action": "vim::Enter",
        "classification": "implemented",
    },
    {
        "modes": [
            "replace",
        ],
        "keys": [
            "insert",
        ],
        "action": "vim::InsertBefore",
        "classification": "implemented",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "escape",
        ],
        "action": "vim::SwitchToNormalMode",
        "classification": "implemented",
        "context": "Editor && vim_mode == waiting && (vim_operator == ys || vim_operator == cs)",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "escape",
        ],
        "action": "vim::SwitchToNormalMode",
        "classification": "implemented",
        "context": "Editor && vim_mode == waiting && (vim_operator == ys || vim_operator == cs)",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "w",
        ],
        "action": "vim::Word",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "w",
        ],
        "action": "vim::Word",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "W",
        ],
        "action": "vim::Word",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "W",
        ],
        "action": "vim::Word",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "t",
        ],
        "action": "vim::Tag",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "t",
        ],
        "action": "vim::Tag",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "s",
        ],
        "action": "vim::Sentence",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "s",
        ],
        "action": "vim::Sentence",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "p",
        ],
        "action": "vim::Paragraph",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "p",
        ],
        "action": "vim::Paragraph",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "'",
        ],
        "action": "vim::Quotes",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "'",
        ],
        "action": "vim::Quotes",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "`",
        ],
        "action": "vim::BackQuotes",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "`",
        ],
        "action": "vim::BackQuotes",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "\"",
        ],
        "action": "vim::DoubleQuotes",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "\"",
        ],
        "action": "vim::DoubleQuotes",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "q",
        ],
        "action": "vim::MiniQuotes",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "q",
        ],
        "action": "vim::MiniQuotes",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "|",
        ],
        "action": "vim::VerticalBars",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "|",
        ],
        "action": "vim::VerticalBars",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "(",
        ],
        "action": "vim::Parentheses",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "(",
        ],
        "action": "vim::Parentheses",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            ")",
        ],
        "action": "vim::Parentheses",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            ")",
        ],
        "action": "vim::Parentheses",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "b",
        ],
        "action": "vim::Parentheses",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "b",
        ],
        "action": "vim::Parentheses",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "[",
        ],
        "action": "vim::SquareBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "[",
        ],
        "action": "vim::SquareBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "]",
        ],
        "action": "vim::SquareBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "]",
        ],
        "action": "vim::SquareBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "r",
        ],
        "action": "vim::SquareBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "r",
        ],
        "action": "vim::SquareBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "{",
        ],
        "action": "vim::CurlyBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "{",
        ],
        "action": "vim::CurlyBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "}",
        ],
        "action": "vim::CurlyBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "}",
        ],
        "action": "vim::CurlyBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "B",
        ],
        "action": "vim::CurlyBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "B",
        ],
        "action": "vim::CurlyBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "<",
        ],
        "action": "vim::AngleBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "<",
        ],
        "action": "vim::AngleBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            ">",
        ],
        "action": "vim::AngleBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            ">",
        ],
        "action": "vim::AngleBrackets",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "a",
        ],
        "action": "vim::Argument",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "a",
        ],
        "action": "vim::Argument",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "i",
        ],
        "action": "vim::IndentObj",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "i",
        ],
        "action": "vim::IndentObj",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "I",
        ],
        "action": "vim::IndentObj",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "I",
        ],
        "action": "vim::IndentObj",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "f",
        ],
        "action": "vim::Method",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "f",
        ],
        "action": "vim::Method",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::Class",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::Class",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "e",
        ],
        "action": "vim::EntireFile",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "e",
        ],
        "action": "vim::EntireFile",
        "classification": "implemented",
        "context":
            "vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "m",
        ],
        "action": "vim::AnyPair",
        "classification": "implemented",
        "context":
            "(vim_operator == a || vim_operator == i || vim_operator == helix_next || vim_operator == helix_previous) && helix_mode",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "m",
        ],
        "action": "vim::AnyPair",
        "classification": "implemented",
        "context":
            "(vim_operator == a || vim_operator == i || vim_operator == helix_next || vim_operator == helix_previous) && helix_mode",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "t",
        ],
        "action": "vim::Class",
        "classification": "implemented",
        "context":
            "(vim_operator == a || vim_operator == i || vim_operator == helix_next || vim_operator == helix_previous) && helix_mode",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "t",
        ],
        "action": "vim::Class",
        "classification": "implemented",
        "context":
            "(vim_operator == a || vim_operator == i || vim_operator == helix_next || vim_operator == helix_previous) && helix_mode",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::Comment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context":
            "(vim_operator == a || vim_operator == i || vim_operator == helix_next || vim_operator == helix_previous) && helix_mode",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::Comment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context":
            "(vim_operator == a || vim_operator == i || vim_operator == helix_next || vim_operator == helix_previous) && helix_mode",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "x",
        ],
        "action": "vim::Tag",
        "classification": "implemented",
        "context":
            "(vim_operator == a || vim_operator == i || vim_operator == helix_next || vim_operator == helix_previous) && helix_mode",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "x",
        ],
        "action": "vim::Tag",
        "classification": "implemented",
        "context":
            "(vim_operator == a || vim_operator == i || vim_operator == helix_next || vim_operator == helix_previous) && helix_mode",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "m",
        ],
        "action": "vim::Matching",
        "classification": "implemented",
        "context": "vim_operator == helix_m",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "m",
        ],
        "action": "vim::Matching",
        "classification": "implemented",
        "context": "vim_operator == helix_m",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "s",
        ],
        "action": "vim::PushHelixSurroundAdd",
        "classification": "implemented",
        "context": "vim_operator == helix_m",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "s",
        ],
        "action": "vim::PushHelixSurroundAdd",
        "classification": "implemented",
        "context": "vim_operator == helix_m",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "r",
        ],
        "action": "vim::PushHelixSurroundReplace",
        "classification": "implemented",
        "context": "vim_operator == helix_m",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "r",
        ],
        "action": "vim::PushHelixSurroundReplace",
        "classification": "implemented",
        "context": "vim_operator == helix_m",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "d",
        ],
        "action": "vim::PushHelixSurroundDelete",
        "classification": "implemented",
        "context": "vim_operator == helix_m",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "d",
        ],
        "action": "vim::PushHelixSurroundDelete",
        "classification": "implemented",
        "context": "vim_operator == helix_m",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
        ],
        "action": "vim::NextSectionStart",
        "classification": "implemented",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
        ],
        "action": "vim::NextSectionStart",
        "classification": "implemented",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "Z",
        ],
        "action": "vim::NextSectionEnd",
        "classification": "implemented",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "Z",
        ],
        "action": "vim::NextSectionEnd",
        "classification": "implemented",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "*",
        ],
        "action": "vim::NextComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "*",
        ],
        "action": "vim::NextComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "/",
        ],
        "action": "vim::NextComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "/",
        ],
        "action": "vim::NextComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "+",
        ],
        "action": "vim::NextGreaterIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "+",
        ],
        "action": "vim::NextGreaterIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "=",
        ],
        "action": "vim::NextSameIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "=",
        ],
        "action": "vim::NextSameIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "b",
        ],
        "action": "pane::ActivateNextItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "b",
        ],
        "action": "pane::ActivateNextItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "B",
        ],
        "action": "pane::ActivateLastItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "B",
        ],
        "action": "pane::ActivateLastItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "x",
        ],
        "action": "editor::SelectSmallerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "x",
        ],
        "action": "editor::SelectSmallerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "d",
        ],
        "action": "editor::GoToDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "d",
        ],
        "action": "editor::GoToDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::NextComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::NextComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
        ],
        "action": "editor::GoToHunk",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
        ],
        "action": "editor::GoToHunk",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
        ],
        "action": "vim::InsertEmptyLineBelow",
        "classification": "implemented",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
        ],
        "action": "vim::InsertEmptyLineBelow",
        "classification": "implemented",
        "context": "vim_operator == helix_next",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "z",
        ],
        "action": "vim::PreviousSectionStart",
        "classification": "implemented",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "z",
        ],
        "action": "vim::PreviousSectionStart",
        "classification": "implemented",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "Z",
        ],
        "action": "vim::PreviousSectionEnd",
        "classification": "implemented",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "Z",
        ],
        "action": "vim::PreviousSectionEnd",
        "classification": "implemented",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "*",
        ],
        "action": "vim::PreviousComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "*",
        ],
        "action": "vim::PreviousComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "/",
        ],
        "action": "vim::PreviousComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "/",
        ],
        "action": "vim::PreviousComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "+",
        ],
        "action": "vim::PreviousGreaterIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "+",
        ],
        "action": "vim::PreviousGreaterIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "=",
        ],
        "action": "vim::PreviousSameIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "=",
        ],
        "action": "vim::PreviousSameIndent",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "b",
        ],
        "action": "pane::ActivatePreviousItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "b",
        ],
        "action": "pane::ActivatePreviousItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "B",
        ],
        "action": "pane::ActivateItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "B",
        ],
        "action": "pane::ActivateItem",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "x",
        ],
        "action": "editor::SelectLargerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "x",
        ],
        "action": "editor::SelectLargerSyntaxNode",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "d",
        ],
        "action": "editor::GoToPreviousDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "d",
        ],
        "action": "editor::GoToPreviousDiagnostic",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::PreviousComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "c",
        ],
        "action": "vim::PreviousComment",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "g",
        ],
        "action": "editor::GoToPreviousHunk",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "g",
        ],
        "action": "editor::GoToPreviousHunk",
        "classification": "excluded",
        "reason": "Requires language/syntax services or host application UI outside the prompt.",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "normal",
        ],
        "keys": [
            "space",
        ],
        "action": "vim::InsertEmptyLineAbove",
        "classification": "implemented",
        "context": "vim_operator == helix_previous",
    },
    {
        "modes": [
            "select",
        ],
        "keys": [
            "space",
        ],
        "action": "vim::InsertEmptyLineAbove",
        "classification": "implemented",
        "context": "vim_operator == helix_previous",
    },
];

/** Prompt-only overrides are explicit, not attributed to the upstream keymap. */
bindings.push(
    {
        modes: ["normal", "select", "insert", "replace"],
        keys: ["enter"],
        action: "pi::Submit",
        classification: "pi",
        reason: "Submit the prompt rather than navigate a document.",
    },
    {
        modes: ["insert", "replace"],
        keys: ["shift+enter"],
        action: "pi::InsertNewline",
        classification: "pi",
        reason: "Terminal prompt multiline entry.",
    },
);
// Pi overrides take precedence over shared defaults for the same mode and key.
for (let i = bindings.length - 3; i >= 0; i--) {
    const binding = bindings[i];
    if (!binding.context && binding.keys.length === 1 && binding.keys[0] === "enter") {
        bindings.splice(i, 1);
    }
}
/** Mode- and operator-aware controller dispatch inventory. Implemented prefixes denote
 * grammar entry, not completion of an arbitrary following command or upstream semantic parity.
 */
const runtimeKeys = new Set([
    "ctrl+m",
    "+",
    "-",
    "tab",
    "shift+tab",
    "#",
    "ctrl+[",
    "V",
    "pagedown",
    "pageup",
    "ctrl+e",
    "ctrl+y",
    "g N",
    "g .",
    "g *",
    "g #",
    "M",
    "insert",
    "alt+C",
    "z t",
    "z z",
    "z c",
    "z b",
    "h",
    "left",
    "backspace",
    "l",
    "right",
    "j",
    "down",
    "ctrl+j",
    "k",
    "up",
    "w",
    "b",
    "e",
    "W",
    "B",
    "E",
    "G",
    "home",
    "end",
    "$",
    "^",
    "|",
    "v",
    "i",
    "a",
    "I",
    "A",
    "R",
    "o",
    "O",
    "x",
    "d",
    "c",
    "alt+d",
    "alt+c",
    "y",
    "p",
    "P",
    "u",
    "ctrl+r",
    "U",
    ".",
    "~",
    "`",
    "alt+`",
    "ctrl+a",
    "ctrl+x",
    ">",
    "<",
    "J",
    "C",
    "%",
    ";",
    "alt+;",
    ",",
    "_",
    "alt+x",
    "alt+s",
    "*",
    "s",
    "/",
    "?",
    "n",
    "N",
    "escape",
    "Q",
    "q",
    "@",
    "r",
    "f",
    "F",
    "t",
    "T",
    "\"",
    "g g",
    "g e",
    "g h",
    "g j",
    "g k",
    "g a",
    "g >",
    "g <",
    "g ;",
    "g ,",
    "m m",
    "m i",
    "m a",
    "m s",
    "m d",
    "m r",
    "m",
    "[",
    "]",
    "'",
    "space",
    "ctrl+g",
    "0",
    "D",
    "Y",
    "X",
    "S",
    "alt+.",
    "ctrl+f",
    "ctrl+b",
    "ctrl+d",
    "ctrl+u",
    "ctrl+v",
    "ctrl+q",
    "ctrl+o",
    "ctrl+i",
    "{",
    "}",
    "(",
    ")",
    "g l",
    "g L",
    "g s",
    "g E",
    "g M",
    "g v",
    "g 0",
    "g home",
    "g end",
    "g $",
    "g ^",
    "g _",
    "g down",
    "g up",
    "g t",
    "g c",
    "g b",
    "g w",
    "space h",
]);

/** Actual controller grammar, not upstream operator names. Used by invocation probes too. */
export function runtimeContextPrefixes(binding: Binding): string[][] {
    if (!binding.context) return [[]];
    const context = binding.context;
    if (context.includes("vim_mode == waiting")) return [["m", "s"], ["m", "r", "("]];
    if (context === "vim_operator == helix_m") return [["m"]];
    if (context === "vim_operator == helix_next") return [["]"]];
    if (context === "vim_operator == helix_previous") return [["["]];
    if (context.includes("vim_operator == a || vim_operator == i")) return [["m", "a"], ["m", "i"]];
    return [];
}
const insertKeys = new Set([
    "escape",
    "ctrl+c",
    "ctrl+[",
    "insert",
    "backspace",
    "delete",
    "tab",
    "ctrl+v",
    "ctrl+q",
    "ctrl+k",
    "ctrl+Q",
    "ctrl+r",
    "ctrl+o",
    "ctrl+w",
    "ctrl+u",
    "ctrl+t",
    "ctrl+d",
    "ctrl+y",
    "ctrl+e",
    "left",
    "right",
    "up",
    "down",
    "home",
    "end",
    "ctrl+left",
    "ctrl+right",
    "ctrl+x ctrl+e",
    "ctrl+x ctrl+y",
    "ctrl+x ctrl+o",
]);
for (const binding of bindings) {
    const argumentKey = `${binding.modes[0]}|${binding.context ?? ""}|${binding.keys.join("|")}`;
    if (Object.hasOwn(resolvedArguments, argumentKey)) {
        binding.args = resolvedArguments[argumentKey];
    }
    if (
        !binding.context && ["ctrl+o", "ctrl+i"].includes(binding.keys.join(" "))
        && binding.modes.every((mode) => mode === "normal" || mode === "select")
    ) binding.classification = "pending";
    if (
        [
            "buffer_search::UseSelectionForFind",
            "editor::SelectNext",
            "editor::SelectPrevious",
            "editor::SelectAllMatches",
        ].includes(binding.action)
    ) binding.classification = "pending";
    if (
        ["vim::Indent", "vim::Outdent"].includes(binding.action)
        && [">", "<"].includes(binding.keys.join(" "))
    ) {
        binding.classification = "pending";
    }
    if (
        ["vim::AnyPair", "vim::Argument", "vim::Method", "vim::Class", "vim::Tag"].includes(
            binding.action,
        )
    ) {
        binding.classification = "excluded";
        binding.reason =
            "Agreed text-only scope: this object requires a syntax tree; no language parser is provided.";
    }
    if (!binding.context && ["z t", "z z", "z c", "z b"].includes(binding.keys.join(" "))) {
        binding.classification = "implemented";
    }
    if (binding.modes.includes("insert") && binding.keys.join(" ") === "ctrl+x ctrl+o") {
        binding.classification = "implemented";
        delete binding.reason;
    }
    if (/^vim::(?:Next|Previous)Section(?:Start|End)$/.test(binding.action)) {
        binding.classification = "excluded";
        binding.reason =
            "Agreed syntax exclusion: section boundaries require a language parser, unavailable in this text-only buffer.";
    }
    if (!binding.context && ["z h", "z l", "z H", "z L"].includes(binding.keys.join(" "))) {
        binding.classification = "excluded";
        binding.reason =
            "Unsupported viewport interface: Pi soft-wrapped input exposes no horizontal viewport. This exception does not exclude vertical scrolling or alignment.";
    }
    if (binding.classification === "implemented" || binding.classification === "pending") {
        const prefixes = runtimeContextPrefixes(binding);
        const contextual = prefixes.length > 0 && (binding.context === "vim_operator == helix_m"
            ? ["m", "s", "r", "d"].includes(binding.keys.join(" "))
            : binding.context?.includes("vim_mode == waiting")
            ? binding.keys.join(" ") === "escape"
            : binding.context === "vim_operator == helix_next"
                    || binding.context === "vim_operator == helix_previous"
            ? ["w", "W", "p", "s", "space"].includes(binding.keys.join(" "))
            : [
                "q",
                "|",
                "w",
                "W",
                "p",
                "s",
                "i",
                "e",
                "(",
                ")",
                "[",
                "]",
                "{",
                "}",
                "<",
                ">",
                "b",
                "B",
                "r",
                "\"",
                "'",
                "`",
            ].includes(binding.keys.join(" ")));
        const supported = binding.context
            ? contextual
            : binding.modes.every((mode) =>
                mode === "normal" || mode === "select"
                    ? runtimeKeys.has(binding.keys.join(" ")) || /^\d$/.test(binding.keys[0])
                    : insertKeys.has(binding.keys.join(" "))
            );
        binding.classification = supported ? "implemented" : "pending";
        if (supported) delete binding.reason;
        else {binding.reason = `NOT_YET_IMPLEMENTED: ${binding.action} (${
                binding.modes.join("/")
            }: ${binding.keys.join(" ")}${
                binding.context ? `; ${binding.context}` : ""
            }) has no matching audited controller grammar/argument implementation; not an agreed exclusion.`;}
    }
}
export const implementedActions = [
    ...new Set(bindings.filter((b) => b.classification === "implemented").map((b) => b.action)),
];
export type BindingResolution = { binding?: Binding; prefix: boolean };
/** Context entries never leak into ordinary mode lookup. Exact context wins over defaults. */
export function resolveBinding(mode: Mode, keys: string[], context?: string): BindingResolution {
    const candidates = bindings.filter((b) =>
        b.modes.includes(mode)
        && (b.context === undefined || b.context === context)
        && keys.every((key, i) => b.keys[i] === key)
    );
    const exact = candidates.filter((b) => b.keys.length === keys.length);
    return {
        binding: exact.find((b) => b.context === context) ?? exact[0],
        prefix: candidates.some((b) => b.keys.length > keys.length),
    };
}
