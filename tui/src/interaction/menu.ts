import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { inlineText, sanitizeTerminalText } from "../text.ts";
import { InteractionLifetime } from "./lifetime.ts";
import { createMenuScreenComponent, type MenuEvent, type MenuMemory } from "./menu-components.ts";
import type {
    MenuActionResult,
    MenuDefinition,
    MenuItem,
    MenuScreen,
    RunMenuOptions,
    RunMenuResult,
} from "./types.ts";

export function defineMenu<State>(definition: MenuDefinition<State>): MenuDefinition<State> {
    return definition;
}

/** Labels are presentation keys, not IDs. Disambiguate even labels containing suffix-like text. */
export function uniqueLabels(labels: readonly string[]): string[] {
    const used = new Set<string>();
    return labels.map((label) => {
        let candidate = label;
        let count = 1;
        while (used.has(candidate)) candidate = `${label} [${++count}]`;
        used.add(candidate);
        return candidate;
    });
}

export async function runMenu<State>(
    ctx: ExtensionContext,
    definition: MenuDefinition<State>,
    options: RunMenuOptions<State>,
): Promise<RunMenuResult> {
    const life = new InteractionLifetime(options);
    const stack = [definition.start];
    const memories = new Map<string, MenuMemory>();
    const context = () => ({ ctx, state: options.getState(), signal: life.signal });
    const screen = () => {
        const factory = definition.screens[stack.at(-1)!];
        if (!factory) throw new Error(`Unknown menu screen: ${stack.at(-1)}`);
        return factory(context());
    };
    const back = (): RunMenuResult | undefined => {
        if (stack.length > 1) {
            stack.pop();
            return undefined;
        }
        return { kind: "closed", reason: "back" };
    };
    const route = (result: MenuActionResult | void): RunMenuResult | undefined => {
        if (result?.kind === "close") return { kind: "closed", reason: "close" };
        if (result?.kind === "back") return back();
        if (result?.kind === "navigate") stack.push(result.to);
        return undefined;
    };
    const invoke = (
        view: MenuScreen,
        event: Extract<MenuEvent, { kind: "activate" | "input" }>,
    ) => {
        const item = event.kind === "activate" ? event.item : undefined;
        const action = item?.action ?? view.action;
        return definition.actions?.[action ?? ""]?.({
            ...context(),
            itemId: item?.id,
            value: event.value,
            selected: event.kind === "activate" ? event.selected : undefined,
        });
    };
    try {
        if (!life.current) return { kind: "stale" };
        if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
            await options.onUnsupportedMode?.(ctx, ctx.mode);
            return { kind: "unsupported", mode: ctx.mode };
        }
        if (ctx.mode === "rpc") {
            life.cancel = () => life.dispose();
            while (life.current) {
                const view = screen();
                const title = [view.title, ...(view.lines ?? [])].map(sanitizeTerminalText).join(
                    "\n",
                );
                if (view.kind === "input") {
                    const value = await life.wait(
                        ctx.ui.input(title, view.placeholder, { signal: life.signal }),
                    );
                    if (!life.current) return { kind: "stale" };
                    if (value === undefined) {
                        const result = back();
                        if (result) return result;
                        continue;
                    }
                    const result = await life.wait(
                        Promise.resolve(invoke(view, { kind: "input", value })),
                    );
                    if (!life.current) return { kind: "stale" };
                    const finished = route(result);
                    if (finished) return finished;
                    continue;
                }
                const items = [...(view.items ?? []), ...(view.actions ?? [])];
                const includeBack = view.kind !== "actions" || stack.length > 1;
                const labels = uniqueLabels([
                    ...items.map((item) => rpcLabel(view, item)),
                    ...(includeBack ? ["Back"] : []),
                ]);
                const chosen = await life.wait(
                    ctx.ui.select(title, labels, { signal: life.signal }),
                );
                if (!life.current) return { kind: "stale" };
                const index = chosen === undefined ? -1 : labels.indexOf(chosen);
                if (index < 0 || index === items.length) {
                    const result = back();
                    if (result) return result;
                    continue;
                }
                const item = items[index];
                if (item.disabled) continue;
                if (item.to) {
                    stack.push(item.to);
                    continue;
                }
                const value = view.kind === "settings" && item.values?.length
                    ? item
                        .values[
                            (item.values.indexOf(item.currentValue ?? "") + 1) % item.values.length
                        ]
                    : undefined;
                const selected = view.kind === "multiSelect" && !(view.actions ?? []).includes(item)
                    ? !item.selected
                    : undefined;
                const result = await life.wait(
                    Promise.resolve(invoke(view, { kind: "activate", item, value, selected })),
                );
                if (!life.current) return { kind: "stale" };
                const finished = route(result);
                if (finished) return finished;
            }
            return { kind: "stale" };
        }
        let completed: RunMenuResult | undefined;
        const result = await life.wait(
            ctx.ui.custom<RunMenuResult>((tui, theme, keybindings, done) => {
                let component: ReturnType<typeof createMenuScreenComponent> | undefined;
                let view: MenuScreen;
                let disposed = false;
                let focused = false;
                let busy = false;
                const finish = (result: RunMenuResult) => {
                    if (disposed) return;
                    completed = result;
                    disposed = true;
                    focused = false;
                    component?.dispose();
                    life.dispose();
                    done(result);
                };
                const saveMemory = () => {
                    if (component) memories.set(stack.at(-1)!, component.memory());
                };
                const load = () => {
                    busy = false;
                    component?.dispose();
                    view = screen();
                    component = createMenuScreenComponent({
                        screen: view,
                        tui,
                        theme,
                        keybindings,
                        ...memories.get(stack.at(-1)!),
                        onEvent: handle,
                    });
                    component.focused = focused;
                    tui.requestRender();
                };
                const handle = (event: MenuEvent) => {
                    if (disposed) return;
                    if (!life.current) {
                        finish({ kind: "stale" });
                        return;
                    }
                    if (event.kind === "close") {
                        finish({ kind: "closed", reason: "close" });
                        return;
                    }
                    if (event.kind === "back") {
                        saveMemory();
                        const result = back();
                        if (result) finish(result);
                        else load();
                        return;
                    }
                    if (busy) return;
                    saveMemory();
                    if (event.kind === "activate" && event.item.to) {
                        stack.push(event.item.to);
                        load();
                        return;
                    }
                    const original = event.kind === "activate"
                        ? [...(view.items ?? []), ...(view.actions ?? [])].find((item) =>
                            item.id === event.item.id
                        )
                        : undefined;
                    const previous = {
                        currentValue: original?.currentValue,
                        selected: original?.selected,
                    };
                    const active = component!;
                    busy = true;
                    active.setBusy(true);
                    let pending;
                    try {
                        pending = invoke(view, event);
                    } catch (error) {
                        pending = Promise.reject(error);
                    }
                    Promise.resolve(pending).then((result) => {
                        if (disposed || active !== component) return;
                        if (!life.current) {
                            finish({ kind: "stale" });
                            return;
                        }
                        if (result?.kind === "rejected") {
                            if (event.kind === "activate") active.rollback(event.item, previous);
                        } else {
                            const finished = route(result);
                            if (finished) finish(finished);
                            else load();
                        }
                    }).catch((error: unknown) => {
                        if (disposed || active !== component) return;
                        if (!life.current) {
                            finish({ kind: "stale" });
                            return;
                        }
                        if (event.kind === "activate") active.rollback(event.item, previous);
                        ctx.ui.notify?.(inlineText(String(error)), "error");
                    }).finally(() => {
                        if (disposed || active !== component) return;
                        busy = false;
                        active.setBusy(false);
                    });
                };
                life.cancel = () => finish({ kind: "stale" });
                if (!life.current) finish({ kind: "stale" });
                else load();
                return {
                    capturesViewportInput: true,
                    get focused() {
                        return focused;
                    },
                    set focused(value: boolean) {
                        focused = !disposed && value;
                        if (component) component.focused = focused;
                    },
                    render: (width) => disposed ? [] : component!.render(width),
                    handleInput: (data) => component?.handleInput?.(data),
                    invalidate: () => component?.invalidate(),
                    dispose() {
                        disposed = true;
                        focused = false;
                        component?.dispose();
                        life.dispose();
                    },
                };
            }, { blocked: { kind: "question", message: inlineText(screen().title) } }),
        );
        return completed ?? result ?? { kind: "stale" };
    } finally {
        life.dispose();
    }
}

function rpcLabel(view: MenuScreen, item: MenuItem): string {
    const label = inlineText(item.label);
    if (view.kind === "multiSelect" && !(view.actions ?? []).includes(item)) {
        return `[${item.selected ? "x" : " "}] ${label}`;
    }
    if (view.kind === "settings" && item.currentValue !== undefined) {
        return `${label} (${inlineText(item.currentValue)})`;
    }
    return label;
}
