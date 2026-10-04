import { fuzzyFilter, Input, Key, matchesKey } from "@earendil-works/pi-tui";
import { renderPickerItem, wrapWords } from "./word-wrap.js";
import {
    actionMenuItemPresentation,
    actionMenuUnavailableDescription,
    handleSearchInput,
    renderFrame,
    safeMenuText,
} from "./rendering.js";

export function createMultiSelectComponent(options) {
    const searchInput = new Input();
    const toggleRows = options.screen.items.map((item) => ({ kind: "toggle", item }));
    const actionRows = (options.screen.actions ?? []).map((item) => ({ kind: "action", item }));
    const searchableRows = toggleRows.map((row) => ({
        row,
        text: [safeMenuText(row.item.label), safeMenuText(row.item.searchText ?? "")]
            .filter(Boolean)
            .join(" "),
    }));
    let rows = [...toggleRows, ...actionRows];
    const selected = new Map(options.screen.items.map((item) => [item.id, item.selected]));
    const committedSelected = new Map(selected);
    const revisions = new Map();
    let selectedIndex = Math.max(
        0,
        rows.findIndex(({ item }) => item.id === options.selectedItemId),
    );
    let restoreItemId;
    let pending = Promise.resolve();
    let closing = false;
    let disposed = false;

    const selectedRow = () => rows[selectedIndex];

    const closeAfterPending = (kind) => {
        if (closing || disposed) {
            return;
        }
        closing = true;
        void pending.then(() => {
            if (!disposed) {
                options.onEvent({ kind });
            }
        });
    };

    const setSelectedIndex = (index, rememberUserSelection) => {
        if (rows.length === 0) {
            selectedIndex = 0;
            return;
        }
        selectedIndex = Math.max(0, Math.min(index, rows.length - 1));
        const row = selectedRow();
        if (!row) {
            return;
        }
        if (rememberUserSelection) {
            restoreItemId = undefined;
        }
        options.onSelectionChange?.(row.item.id);
    };

    const selectIndex = (index) => setSelectedIndex(index, true);

    const move = (delta) => {
        if (rows.length === 0) {
            return;
        }
        selectIndex((selectedIndex + delta + rows.length) % rows.length);
    };

    const applyFilter = () => {
        if (!options.screen.enableSearch) {
            return;
        }
        const previouslySelectedId = selectedRow()?.item.id;
        const filteredRows = fuzzyFilter(
            searchableRows,
            searchInput.getValue(),
            (candidate) => candidate.text,
        ).map((candidate) => candidate.row);
        rows = [...filteredRows, ...actionRows];
        if (rows.length === 0) {
            if (previouslySelectedId) {
                restoreItemId ??= previouslySelectedId;
            }
            selectedIndex = 0;
            return;
        }
        const previousIndex = rows.findIndex((row) => row.item.id === previouslySelectedId);
        if (previousIndex < 0 && previouslySelectedId) {
            restoreItemId ??= previouslySelectedId;
        }
        const restoreIndex = rows.findIndex((row) => row.item.id === restoreItemId);
        const nextIndex = restoreIndex >= 0 ? restoreIndex : previousIndex >= 0 ? previousIndex : 0;
        if (restoreIndex >= 0) {
            restoreItemId = undefined;
        }
        setSelectedIndex(nextIndex, false);
    };

    const activate = () => {
        const row = selectedRow();
        if (!row || row.item.disabled) {
            return;
        }
        restoreItemId = undefined;
        if (row.kind === "action") {
            if (closing || disposed) {
                return;
            }
            closing = true;
            void pending.then(() => {
                if (!disposed) {
                    options.onEvent({ kind: "activate", itemId: row.item.id });
                }
            });
            return;
        }
        const item = row.item;
        const previousSelected = selected.get(item.id) ?? false;
        const nextSelected = !previousSelected;
        selected.set(item.id, nextSelected);
        const revision = (revisions.get(item.id) ?? 0) + 1;
        revisions.set(item.id, revision);
        const operation = pending.then(async () => {
            if (disposed) {
                return;
            }
            let response = false;
            try {
                response = (await options.onMultiSelectChange?.({
                    itemId: item.id,
                    selected: nextSelected,
                    previousSelected,
                })) ?? false;
            } catch (error) {
                options.onError?.(error);
            }
            if (disposed) {
                return;
            }
            const accepted = typeof response === "boolean" ? response : response.accepted;
            if (accepted) {
                committedSelected.set(item.id, nextSelected);
            } else if (revisions.get(item.id) === revision) {
                selected.set(item.id, committedSelected.get(item.id) ?? false);
            }
            options.tui.requestRender();
            if (accepted && typeof response !== "boolean") {
                closing = true;
                void pending.then(() => {
                    if (!disposed) {
                        options.onTransition?.(response.transition);
                    }
                });
            }
        });
        pending = operation.catch(() => undefined);
    };

    const component = {
        render(width) {
            const safeWidth = Math.max(1, width);
            const requestedViewport = options.screen.viewportSize ?? 13;
            const viewportSize = Math.min(requestedViewport, rows.length);
            const viewportStart = Math.max(
                0,
                Math.min(selectedIndex - Math.floor(viewportSize / 2), rows.length - viewportSize),
            );
            const visibleRows = rows.slice(viewportStart, viewportStart + viewportSize);
            const rowContent = visibleRows.flatMap((row, offset) => {
                const index = viewportStart + offset;
                const isSelected = index === selectedIndex;
                const label = row.kind === "action"
                    ? actionMenuItemPresentation(row.item).label
                    : `${row.item.disabled ? "[-]" : selected.get(row.item.id) ? "[x]" : "[ ]"} ${
                        safeMenuText(row.item.label)
                    }${row.item.disabled ? " (unavailable)" : ""}`;
                return renderPickerItem(
                    label,
                    undefined,
                    safeWidth,
                    isSelected,
                    options.theme,
                    row.item.disabled,
                );
            });
            if (viewportSize < rows.length) {
                rowContent.push(options.theme.fg("dim", `  (${selectedIndex + 1}/${rows.length})`));
            }
            const row = selectedRow();
            const descriptions = row
                ? row.kind === "action"
                    ? [
                        actionMenuUnavailableDescription(row.item),
                        actionMenuItemPresentation(row.item).description,
                    ].filter((value) => Boolean(value))
                    : [
                        row.item.description,
                        row.item.disabled
                            ? row.item.disabledReason
                                ? `Unavailable: ${row.item.disabledReason}`
                                : "Unavailable"
                            : undefined,
                    ].filter((value) => Boolean(value))
                : [];
            const descriptionRows = descriptions.flatMap((description) =>
                wrapWords(description, safeWidth, (text) => options.theme.fg("dim", text))
            );
            if (descriptionRows.length > 0) {
                rowContent.push("", ...descriptionRows);
            }
            const hasMatchingItems = rows.some((candidate) => candidate.kind === "toggle");
            const statusMessage = options.screen.items.length === 0
                ? "No items available"
                : !hasMatchingItems
                ? "No matching items"
                : undefined;
            const statusRows = options.screen.enableSearch && statusMessage
                ? wrapWords(
                    statusMessage,
                    safeWidth > 2 ? safeWidth - 2 : safeWidth,
                    (text) => options.theme.fg("dim", safeWidth > 2 ? `  ${text}` : text),
                )
                : [];
            const searchReminderRows = options.screen.enableSearch && hasMatchingItems
                ? wrapWords("Type to search", safeWidth, (text) => options.theme.fg("dim", text))
                : [];
            const content = options.screen.enableSearch
                ? [
                    ...searchInput.render(safeWidth),
                    "",
                    ...statusRows,
                    ...rowContent,
                    ...searchReminderRows,
                ]
                : rowContent;
            return renderFrame(
                options.screen.title,
                options.screen.lines ?? [],
                content,
                options.screen.hint ?? "back",
                width,
                options,
                {
                    compactOverflowText: rows.length > 1
                        ? `  (${selectedIndex + 1}/${rows.length})`
                        : undefined,
                    confirmAction: row?.kind === "action" ? "select" : "toggle",
                    pinnedContentRows: options.screen.enableSearch ? 1 + statusRows.length : 0,
                    priorityTailRows: descriptionRows.length + searchReminderRows.length,
                },
            );
        },

        invalidate() {
            if (options.screen.enableSearch) {
                searchInput.invalidate();
            }
        },

        handleInput(data) {
            if (disposed || closing) {
                return;
            }
            if (matchesKey(data, Key.ctrl("c"))) {
                closeAfterPending("close");
            } else if (options.keybindings.matches(data, "tui.select.cancel")) {
                closeAfterPending(options.screen.hint ?? "back");
            } else if (options.keybindings.matches(data, "tui.select.up")) {
                move(-1);
            } else if (options.keybindings.matches(data, "tui.select.down")) {
                move(1);
            } else if (options.keybindings.matches(data, "tui.select.pageUp")) {
                selectIndex(selectedIndex - (options.screen.viewportSize ?? 13));
            } else if (options.keybindings.matches(data, "tui.select.pageDown")) {
                selectIndex(selectedIndex + (options.screen.viewportSize ?? 13));
            } else if (options.keybindings.matches(data, "tui.select.confirm") || data === " ") {
                activate();
            } else if (options.screen.enableSearch) {
                handleSearchInput(searchInput, data);
                applyFilter();
            }
            options.tui.requestRender();
        },

        waitForPending: () => pending,

        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            options.onDispose?.();
        },
    };
    if (options.screen.enableSearch) {
        Object.defineProperty(component, "focused", {
            get: () => searchInput.focused,
            set: (value) => {
                searchInput.focused = value;
            },
        });
    }
    return component;
}
