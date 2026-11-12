import { stripVTControlCharacters } from "node:util";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { wrapWords } from "./word-wrap.js";
import { HorizontalRule } from "@narumitw/pi-tui-kit";
import { formatInteractionHints } from "../hints.ts";
import { replaceTerminalControls, safeMenuText } from "./text.js";
export { safeMenuText } from "./text.js";

export function actionMenuItemPresentation(item) {
    const label = safeMenuText(item.label);
    const description = item.description ? safeMenuText(item.description) : undefined;
    return { label: item.disabled ? `[-] ${label}` : label, description };
}

export function actionMenuUnavailableDescription(item) {
    if (!item.disabled) {
        return undefined;
    }
    const reason = safeMenuText(item.disabledReason ?? "");
    return reason ? `Unavailable: ${reason}` : undefined;
}

export function renderFrame(title, lines, content, destination, width, options, layout = {}) {
    const safeWidth = Math.max(1, width);
    const rule = renderHorizontalRule(safeWidth, options.theme);
    const confirmAction = layout.confirmAction ?? "select";
    const navigation = layout.navigation ?? true;
    const titleRows = wrapWords(
        title,
        safeWidth,
        (text) => options.theme.fg("accent", options.theme.bold(text)),
    );
    const contextRows = lines.flatMap((line) =>
        wrapWords(line, safeWidth, (text) => options.theme.fg("muted", text))
    );
    const hintText = layout.hint
        ?? options.interactionHint
        ?? menuHint(options.keybindings, destination, confirmAction, navigation);
    const hintRows = wrapWords(hintText, safeWidth, (text) => options.theme.fg("dim", text));
    const compactFullHintRows = wrapWords(
        layout.compactOverflowText
            ? `${hintText} · ${safeMenuText(layout.compactOverflowText).trim()}`
            : hintText,
        safeWidth,
        (text) => options.theme.fg("dim", text),
    );
    const compactHintRow = options.theme.fg(
        "dim",
        compactMenuHint(
            hintText,
            options.keybindings,
            destination,
            confirmAction,
            navigation,
            layout.compactOverflowText,
            safeWidth,
        ),
    );
    const fullFrame = [
        rule,
        ...titleRows,
        ...contextRows,
        ...(content.length > 0 ? ["", ...content] : []),
        ...hintRows,
        rule,
    ];
    const maxRows = componentRows(options.tui.terminal.rows);
    const result = fullFrame.length <= maxRows
        ? fullFrame
        : compactFrame(
            rule,
            titleRows,
            contextRows,
            content,
            compactFullHintRows,
            compactHintRow,
            maxRows,
            layout.pinnedContentRows ?? 0,
            layout.priorityTailRows ?? 0,
        );
    return result.map((line) => truncateToWidth(line, safeWidth, ""));
}

function compactFrame(
    rule,
    titleRows,
    contextRows,
    contentRows,
    hintRows,
    compactHintRow,
    maxRows,
    pinnedContentRows,
    priorityTailRows,
) {
    const framed = maxRows >= 5;
    const availableRows = framed ? maxRows - 2 : maxRows;
    const compactContentRows = contentRows.filter((line) =>
        stripVTControlCharacters(line).trim().length > 0
    );
    const body = compactContentRows.length > 0
        ? compactInteractiveRows(
            titleRows,
            contextRows,
            compactContentRows,
            hintRows,
            compactHintRow,
            availableRows,
            pinnedContentRows,
            priorityTailRows,
        )
        : compactStaticRows(titleRows, contextRows, compactHintRow, availableRows);
    return framed ? [rule, ...body, rule] : body;
}

function compactInteractiveRows(
    titleRows,
    contextRows,
    contentRows,
    hintRows,
    compactHintRow,
    availableRows,
    pinnedContentRows,
    priorityTailRows,
) {
    const hintBudget = compactHintRow && availableRows > 1 ? 1 : 0;
    const minimumContentRows = Math.min(
        availableRows - hintBudget,
        minimumFocusedRows(contentRows, pinnedContentRows, priorityTailRows),
    );
    let remainingRows = Math.max(0, availableRows - hintBudget - minimumContentRows);
    const titleBudget = titleRows.length > 0 && remainingRows > 0 ? 1 : 0;
    remainingRows -= titleBudget;
    const extraHintRows = Math.max(0, hintRows.length - hintBudget);
    const useFullHints = hintBudget > 0 && extraHintRows <= remainingRows;
    if (useFullHints) {
        remainingRows -= extraHintRows;
    }
    const contentBudget = Math.min(contentRows.length, minimumContentRows + remainingRows);
    remainingRows -= contentBudget - minimumContentRows;
    const contextBudget = Math.min(contextRows.length, remainingRows);
    const boundedContent = focusedRows(
        contentRows,
        contentBudget,
        pinnedContentRows,
        priorityTailRows,
    );
    return [
        ...titleRows.slice(0, titleBudget),
        ...contextRows.slice(0, contextBudget),
        ...boundedContent,
        ...(hintBudget > 0 ? (useFullHints ? hintRows : [compactHintRow]) : []),
    ];
}

function compactStaticRows(titleRows, contextRows, compactHintRow, availableRows) {
    if (availableRows <= 0) {
        return [];
    }
    if (availableRows === 1) {
        return [contextRows[0] || compactHintRow || titleRows[0] || ""];
    }
    const hintBudget = compactHintRow ? 1 : 0;
    const minimumContextRows = contextRows.length > 0 ? 1 : 0;
    let remainingRows = Math.max(0, availableRows - hintBudget - minimumContextRows);
    const titleBudget = titleRows.length > 0 && remainingRows > 0 ? 1 : 0;
    remainingRows -= titleBudget;
    const contextBudget = Math.min(contextRows.length, minimumContextRows + remainingRows);
    return [
        ...titleRows.slice(0, titleBudget),
        ...contextRows.slice(0, contextBudget),
        ...(hintBudget > 0 ? [compactHintRow] : []),
    ];
}

function minimumFocusedRows(rows, pinnedRows, priorityTailRows) {
    const priorities = priorityRowIndexes(rows, pinnedRows, priorityTailRows);
    return Math.max(1, priorities.size);
}

function focusedRows(rows, budget, pinnedRows = 0, priorityTailRows = 0) {
    if (budget <= 0) {
        return [];
    }
    if (rows.length <= budget) {
        return rows;
    }
    const indexes = priorityRowIndexes(rows, pinnedRows, priorityTailRows, budget);
    const selectedIndex = selectedRowIndex(rows, pinnedRows);
    const fillOrder = Array.from({ length: rows.length }, (_, index) => index).sort(
        (left, right) => {
            if (selectedIndex < 0) {
                return left - right;
            }
            return Math.abs(left - selectedIndex) - Math.abs(right - selectedIndex) || left - right;
        },
    );
    for (const index of fillOrder) {
        if (indexes.size >= budget) {
            break;
        }
        indexes.add(index);
    }
    return [...indexes]
        .sort((left, right) => left - right)
        .map((index) => rows[index])
        .filter((line) => line !== undefined);
}

function priorityRowIndexes(rows, pinnedRows, priorityTailRows, budget = Number.POSITIVE_INFINITY) {
    const indexes = new Set();
    const pinned = Math.max(0, Math.min(rows.length, Math.floor(pinnedRows)));
    // Keep the selected item's physical rows together before spending the budget
    // on search, explanatory tails or neighboring items. At one row, selection wins.
    const selectedIndex = selectedRowIndex(rows, pinned);
    if (selectedIndex >= 0 && indexes.size < budget) {
        indexes.add(selectedIndex);
        for (
            let index = selectedIndex + 1;
            index < rows.length && indexes.size < budget;
            index += 1
        ) {
            if (!/^│/u.test(stripVTControlCharacters(rows[index]))) break;
            indexes.add(index);
        }
    }
    for (let index = 0; index < pinned && indexes.size < budget; index += 1) {
        indexes.add(index);
    }
    const tailStart = Math.max(pinned, rows.length - Math.max(0, Math.floor(priorityTailRows)));
    for (let index = tailStart; index < rows.length && indexes.size < budget; index += 1) {
        indexes.add(index);
    }
    return indexes;
}

function selectedRowIndex(rows, pinnedRows = 0) {
    const start = Math.max(0, Math.min(rows.length, Math.floor(pinnedRows)));
    const selected = rows.slice(start).findIndex((line) =>
        /^→/u.test(stripVTControlCharacters(line))
    );
    return selected < 0 ? -1 : start + selected;
}

export function componentRows(rows) {
    const terminalRows = Number.isFinite(rows) ? Math.floor(rows) : 24;
    return Math.max(1, terminalRows - 3);
}

export function renderHorizontalRule(width, theme) {
    return (new HorizontalRule({
        ruleStyle: (text) => theme.fg("border", text),
    }).render(Math.max(1, width))[0] ?? "");
}

export function menuHint(keybindings, destination, confirmAction, navigation = true) {
    return formatInteractionHints(keybindings, [
        ...(navigation
            ? [{ bindings: ["tui.select.up", "tui.select.down"], label: "navigate" }]
            : []),
        ...(confirmAction ? [{ bindings: ["tui.select.confirm"], label: confirmAction }] : []),
        {
            bindings: ["tui.select.cancel"],
            excludeKeys: ["ctrl+c"],
            label: destination,
        },
        ...(destination === "back" ? [{ keys: ["ctrl+c"], label: "close" }] : []),
    ]);
}

function compactMenuHint(
    hintText,
    keybindings,
    destination,
    confirmAction,
    navigation,
    compactOverflowText,
    width,
) {
    const cancel = formatInteractionHints(keybindings, [
        {
            bindings: ["tui.select.cancel"],
            excludeKeys: ["ctrl+c"],
            label: destination,
        },
    ]);
    const hardCancel = destination === "back" || !cancel
        ? formatInteractionHints(keybindings, [{ keys: ["ctrl+c"], label: "close" }])
        : "";
    const confirm = confirmAction
        ? formatInteractionHints(keybindings, [
            { bindings: ["tui.select.confirm"], label: confirmAction },
        ])
        : "";
    const navigate = navigation
        ? formatInteractionHints(keybindings, [
            { bindings: ["tui.select.up", "tui.select.down"], label: "navigate" },
        ])
        : "";
    const supplied = hintSegments(hintText);
    const groups = {
        cancel: hintSegmentKeys(cancel),
        confirm: hintSegmentKeys(confirm),
        hardCancel: hintSegmentKeys(hardCancel),
        navigate: hintSegmentKeys(navigate),
    };
    const classified = supplied.map((segment) => ({ segment, keys: hintSegmentKeys(segment) }));

    const matching = (keys) =>
        classified
            .filter((candidate) => intersects(candidate.keys, keys))
            .map(({ segment }) => segment);

    const cancelSegments = matching(groups.cancel);
    const confirmSegments = matching(groups.confirm);
    const hardCancelSegments = matching(groups.hardCancel);
    const navigationSegments = matching(groups.navigate);
    const claimed = new Set([
        ...cancelSegments,
        ...confirmSegments,
        ...hardCancelSegments,
        ...navigationSegments,
    ]);
    const remaining = classified.filter(({ segment }) => !claimed.has(segment));
    const keyedCustom = remaining.filter(({ keys }) => keys.size > 0).map(({ segment }) => segment);
    const reminders = remaining.filter(({ keys }) => keys.size === 0).map(({ segment }) => segment);
    return fitCompactHintSegments([
        ...(cancelSegments.length > 0 ? cancelSegments : [cancel]),
        ...(compactOverflowText ? [safeMenuText(compactOverflowText).trim()] : []),
        ...confirmSegments,
        ...hardCancelSegments,
        ...navigationSegments,
        ...keyedCustom,
        ...reminders,
    ], width);
}

function hintSegments(hintText) {
    return safeMenuText(hintText)
        .split(/\s+[·•*|]\s+/u)
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function hintSegmentKeys(segment) {
    const token = safeMenuText(segment).trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
    const parts = token.split("/");
    return parts.length > 0 && parts.every(isHintKey) ? new Set(parts) : new Set();
}

function isHintKey(value) {
    return (value.length === 1
        || value.includes("+")
        || [
            "esc",
            "escape",
            "enter",
            "return",
            "space",
            "^",
            "v",
            "up",
            "down",
            "pageup",
            "pagedown",
            "home",
            "end",
        ].includes(value));
}

function intersects(left, right) {
    for (const value of left) {
        if (right.has(value)) {
            return true;
        }
    }
    return false;
}

export function fitCompactHintSegments(segments, width) {
    const safeWidth = Math.max(1, width);
    let result = "";
    for (const segment of segments.map(safeMenuText).filter(Boolean)) {
        const candidate = result ? `${result} · ${segment}` : segment;
        if (visibleWidth(candidate) > safeWidth) {
            continue;
        }
        result = candidate;
    }
    return result;
}

export function handleSearchInput(input, data) {
    input.handleInput(data);
    const value = replaceTerminalControls(input.getValue());
    if (value !== input.getValue()) {
        input.setValue(value);
    }
}
