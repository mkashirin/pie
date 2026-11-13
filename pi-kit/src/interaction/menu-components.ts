import { matchesKey } from "@earendil-works/pi-tui";
import { formatInteractionHints } from "../hints.ts";
import { AnswerEditor } from "./editor.ts";
import { columns, inset, rowBudget, windowRows, wrapWords } from "./layout.ts";
import type {
    InteractionEnvironment,
    InteractiveComponent,
    MenuItem,
    MenuScreen,
} from "./types.ts";

export type MenuEvent =
    | { kind: "back" }
    | { kind: "close" }
    | { kind: "activate"; item: MenuItem; value?: string; selected?: boolean }
    | { kind: "input"; value: string };
export interface MenuMemory {
    selectedItemId?: string;
    query?: string;
    value?: string;
    scrollOffset?: number;
}
interface MenuComponentOptions extends InteractionEnvironment, MenuMemory {
    screen: MenuScreen;
    interactionHint?: string;
    onEvent(event: MenuEvent): void;
}

export function createMenuScreenComponent(options: MenuComponentOptions): InteractiveComponent & {
    memory(): MenuMemory;
    setBusy(busy: boolean): void;
    rollback(item: MenuItem, previous: { currentValue?: string; selected?: boolean }): void;
} {
    const { screen, tui, theme, keybindings, onEvent } = options;
    if (
        !["actions", "choice", "multiSelect", "settings", "detail", "input"].includes(screen.kind)
    ) {
        throw new Error(`Unsupported Plan Mode screen: ${screen.kind}`);
    }
    const items = (screen.items ?? []).map((item) => ({ ...item }));
    const actions = (screen.actions ?? []).map((item) => ({ ...item }));
    const search = new AnswerEditor(keybindings);
    const editor = new AnswerEditor(keybindings);
    search.setValue(options.query ?? "");
    editor.setValue(options.value ?? screen.initialValue ?? screen.value ?? "");
    let selectedId = options.selectedItemId ?? screen.initialItemId ?? screen.currentItemId;
    let focused = false;
    let disposed = false;
    let busy = false;
    let scrollOffset = options.scrollOffset ?? 0;
    let lastDetailRows = 0;
    const proseOnly = screen.kind === "detail" && !items.length && !actions.length;
    const searchable = screen.enableSearch ?? (screen.kind === "settings");
    const filtered = () => {
        const query = search.getValue().toLocaleLowerCase();
        const matches = items.filter((item) =>
            !query || `${item.label} ${item.searchText ?? ""}`.toLocaleLowerCase().includes(query)
        );
        return [...matches, ...actions];
    };
    const current = () => {
        const rows = filtered();
        const item = rows.find((item) => item.id === selectedId) ?? rows[0];
        selectedId = item?.id;
        return item;
    };
    const refresh = () => {
        if (!disposed) tui.requestRender();
    };
    const activate = () => {
        const item = current();
        if (!item || item.disabled) return;
        let value: string | undefined;
        let selected: boolean | undefined;
        if (screen.kind === "settings" && item.values?.length) {
            const index = item.values.indexOf(item.currentValue ?? "");
            value = item.values[(index + 1) % item.values.length];
            item.currentValue = value;
        } else if (screen.kind === "multiSelect" && !actions.includes(item)) {
            selected = !item.selected;
            item.selected = selected;
        }
        onEvent({ kind: "activate", item, value, selected });
    };
    return {
        capturesViewportInput: true,
        get focused() {
            return focused;
        },
        set focused(value: boolean) {
            focused = !disposed && value;
            search.focused = focused;
            editor.focused = focused;
        },
        memory: () => ({
            selectedItemId: selectedId,
            query: search.getValue(),
            value: editor.getValue(),
            scrollOffset,
        }),
        setBusy(value) {
            busy = value;
            refresh();
        },
        rollback(item, previous) {
            const local = [...items, ...actions].find((row) => row.id === item.id);
            if (local) Object.assign(local, previous);
            refresh();
        },
        invalidate() {
            search.invalidate();
            editor.invalidate();
        },
        dispose() {
            disposed = true;
            focused = false;
            search.focused = false;
            editor.focused = false;
        },
        handleInput(data) {
            if (disposed) return;
            if (matchesKey(data, "ctrl+c")) {
                onEvent({ kind: "close" });
                return;
            }
            if (keybindings.matches(data, "tui.select.cancel")) {
                onEvent({ kind: "back" });
                return;
            }
            if (busy) return;
            if (proseOnly) {
                const page = rowBudget(tui);
                if (keybindings.matches(data, "tui.select.up")) scrollOffset--;
                else if (keybindings.matches(data, "tui.select.down")) scrollOffset++;
                else if (keybindings.matches(data, "tui.select.pageUp")) scrollOffset -= page;
                else if (keybindings.matches(data, "tui.select.pageDown")) scrollOffset += page;
                else if (matchesKey(data, "home")) scrollOffset = 0;
                else if (matchesKey(data, "end")) scrollOffset = lastDetailRows;
                scrollOffset = Math.max(
                    0,
                    Math.min(scrollOffset, Math.max(0, lastDetailRows - page)),
                );
                refresh();
                return;
            }
            if (screen.kind === "input") {
                if (keybindings.matches(data, "tui.input.submit")) {
                    onEvent({ kind: "input", value: editor.getValue() });
                } else editor.handleInput(data);
                refresh();
                return;
            }
            const rows = filtered();
            const index = Math.max(0, rows.findIndex((item) => item.id === current()?.id));
            let next: number | undefined;
            if (keybindings.matches(data, "tui.select.up")) {
                next = (index - 1 + rows.length) % rows.length;
            } else if (keybindings.matches(data, "tui.select.down")) {
                next = (index + 1) % rows.length;
            } else if (keybindings.matches(data, "tui.select.pageUp")) {
                next = Math.max(0, index - (screen.viewportSize ?? 10));
            } else if (keybindings.matches(data, "tui.select.pageDown")) {
                next = Math.min(rows.length - 1, index + (screen.viewportSize ?? 10));
            } else if (matchesKey(data, "home")) next = 0;
            else if (matchesKey(data, "end")) next = rows.length - 1;
            else if (
                keybindings.matches(data, "tui.select.confirm")
                || (matchesKey(data, "space") && ["multiSelect", "settings"].includes(screen.kind))
            ) activate();
            else if (searchable) {
                search.handleInput(data);
                current();
            }
            if (next !== undefined && rows[next]) selectedId = rows[next].id;
            refresh();
        },
        render(width) {
            const size = columns(width);
            if (!size || disposed) return [];
            const result: string[] = [];
            const add = (text: string, role: "accent" | "muted" | "dim" | "error" = "muted") =>
                result.push(...wrapWords(text, size).map((row) => theme.fg(role, row)));
            add(screen.title, "accent");
            for (const line of screen.lines ?? []) add(line);
            if (proseOnly) {
                add(
                    formatInteractionHints(keybindings, [
                        { bindings: ["tui.select.up", "tui.select.down"], label: "scroll" },
                        { bindings: ["tui.select.cancel"], label: "back" },
                    ]),
                    "dim",
                );
                lastDetailRows = result.length;
                const budget = rowBudget(tui);
                scrollOffset = Math.max(
                    0,
                    Math.min(scrollOffset, Math.max(0, result.length - budget)),
                );
                return result.slice(scrollOffset, scrollOffset + budget);
            }
            if (screen.kind === "input") {
                const active = result.length;
                result.push(...editor.render(size));
                return windowRows(result, active, rowBudget(tui));
            }
            if (searchable) result.push(...search.render(size));
            const rows = filtered();
            const item = current();
            const noun = screen.kind === "choice"
                ? "choices"
                : screen.kind === "settings"
                ? "settings"
                : "items";
            if (!rows.some((row) => items.includes(row))) {
                result.push(
                    ...inset(
                        items.length ? `No matching ${noun}` : `No ${noun} available`,
                        size,
                        "  ",
                    )
                        .map((line) => theme.fg("dim", line)),
                );
            }
            const index = rows.findIndex((row) => row.id === item?.id);
            const viewport = Math.max(1, screen.viewportSize ?? 10);
            const start = Math.max(0, Math.min(index, rows.length - viewport));
            let active = result.length;
            for (const row of rows.slice(start, start + viewport)) {
                const chosen = row === item;
                if (chosen) active = result.length;
                let label = row.label;
                if (screen.kind === "multiSelect" && items.includes(row)) {
                    label = `[${row.selected ? "x" : " "}] ${label}`;
                } else if (screen.kind === "settings" && row.currentValue !== undefined) {
                    label += `: ${row.currentValue}`;
                } else if (
                    (screen.kind === "actions" || screen.kind === "choice") && row.description
                ) label += ` · ${row.description}`;
                result.push(
                    ...inset(label, size, chosen ? "→ " : "  ", chosen ? "│ " : "  ")
                        .map((line) => theme.fg(chosen ? "accent" : "muted", line)),
                );
            }
            if (item) {
                if (
                    (screen.kind === "multiSelect" || screen.kind === "settings")
                    && item.description
                ) add(item.description);
                for (const line of item.details ?? []) add(line);
                if (item.disabledReason) add(item.disabledReason, "error");
            }
            if (searchable && items.length && !search.getValue()) add("Type to search", "dim");
            if (options.interactionHint) add(options.interactionHint, "dim");
            add(
                formatInteractionHints(keybindings, [
                    { bindings: ["tui.select.up", "tui.select.down"], label: "navigate" },
                    { bindings: ["tui.select.confirm"], label: "select" },
                    { bindings: ["tui.select.cancel"], label: "back" },
                ]),
                "dim",
            );
            // The active row is pinned; extra context/chrome may scroll off on very short terminals.
            return windowRows(result, active >= rowBudget(tui) ? active : 0, rowBudget(tui));
        },
    };
}
