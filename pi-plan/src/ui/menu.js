import { createMenuScreenComponent } from "./menu-components.js";
import { invokeMenuInteraction, isMenuCurrent, reportMenuError } from "./menu-interaction.js";
import { createMenuNavigator, resolveMenuScreen } from "@narumitw/pi-tui-kit";

export async function runMenu(ctx, definition, options) {
    const menuController = new AbortController();
    const menuSignal = options.signal
        ? AbortSignal.any([menuController.signal, options.signal])
        : menuController.signal;
    const navigator = createMenuNavigator(definition.start);
    const searchQueries = new Map();
    try {
        while (!navigator.closed) {
            const loaded = await loadState(ctx, options, menuSignal);
            if (loaded.kind !== "loaded") {
                return loaded.result;
            }
            const state = loaded.state;
            const screenId = navigator.current;
            const screen = resolveMenuScreen(definition, screenId, state);
            let staleAction = false;

            const interact = async (interaction, interactionSignal) => {
                const invocation = await invokeMenuInteraction({
                    ctx,
                    definition,
                    screen,
                    state,
                    menuSignal,
                    interactionSignal,
                    runtime: options,
                    interaction,
                });
                if (invocation.selectionItemId) {
                    navigator.rememberSelection(navigator.current, invocation.selectionItemId);
                }
                if (invocation.stale) {
                    staleAction = true;
                }
                return invocation;
            };

            const event = await showTuiScreen(
                ctx,
                screen,
                navigator.selectionFor(screenId, selectableItemIds(screen)),
                searchQueries.get(screenId),
                menuSignal,
                {
                    onSelectionChange: (itemId) => navigator.rememberSelection(screenId, itemId),
                    onSearchQueryChange: (query) => searchQueries.set(screenId, query),
                    onSettingChange: (change, signal) =>
                        interact(
                            { kind: "setting", itemId: change.itemId, value: change.value },
                            signal,
                        ),
                    onMultiSelectChange: (change, signal) =>
                        interact({
                            kind: "multiSelect",
                            itemId: change.itemId,
                            selected: change.selected,
                        }, signal),
                    onInputSubmit: async (change, signal) => {
                        const invocation = await interact(
                            { kind: "input", value: change.value },
                            signal,
                        );
                        return invocation.stale ? componentCloseInvocation() : invocation;
                    },
                },
            );
            if (staleAction || !isMenuCurrent(options) || menuSignal.aborted) {
                return { kind: "stale" };
            }
            if (!event) {
                navigator.apply({ kind: "close" });
                continue;
            }
            if (event.kind === "back" || event.kind === "close") {
                searchQueries.delete(screenId);
                navigator.apply({ kind: event.kind });
                continue;
            }
            if (event.kind === "transition") {
                if (event.transition.kind !== "stay") {
                    searchQueries.delete(screenId);
                }
                navigator.apply(event.transition);
                continue;
            }
            const outcome = await interact({ kind: "activate", itemId: event.itemId });
            if (outcome.stale) {
                return { kind: "stale" };
            }
            if (outcome.transition.kind !== "stay") {
                searchQueries.delete(screenId);
            }
            navigator.apply(outcome.transition);
        }
        return closedMenuResult(navigator.closeReason);
    } catch (error) {
        if (!isMenuCurrent(options) || menuSignal.aborted) {
            return { kind: "stale" };
        }
        await reportMenuError(ctx, options, error);
        if (!isMenuCurrent(options) || menuSignal.aborted) {
            return { kind: "stale" };
        }
        return { kind: "error", error };
    } finally {
        menuController.abort(new DOMException("Menu closed", "AbortError"));
    }
}

function selectableItemIds(screen) {
    if (!("items" in screen)) {
        return [];
    }
    if (screen.kind === "multiSelect") {
        return [...screen.items, ...(screen.actions ?? [])].map((item) => item.id);
    }
    const itemIds = screen.items.map((item) => item.id);
    if (screen.kind !== "choice") {
        return itemIds;
    }
    const preferred = [screen.initialItemId, screen.currentItemId].find((itemId) =>
        itemId !== undefined && itemIds.includes(itemId)
    );
    return preferred ? [preferred, ...itemIds.filter((itemId) => itemId !== preferred)] : itemIds;
}

async function showTuiScreen(ctx, screen, selectedItemId, searchQuery, menuSignal, callbacks) {
    let component;

    let removeAbortListener = () => {};

    try {
        return await uiFor(ctx).custom((tui, theme, keybindings, done) => {
            const screenController = new AbortController();
            let finished = false;

            const finish = (event) => {
                if (finished) {
                    return;
                }
                finished = true;
                done(event);
            };

            const abortScreen = () => {
                screenController.abort(new DOMException("Menu owner disposed", "AbortError"));
                finish({ kind: "close" });
            };

            menuSignal.addEventListener("abort", abortScreen, { once: true });
            removeAbortListener = () => menuSignal.removeEventListener("abort", abortScreen);
            if (menuSignal.aborted) {
                abortScreen();
            }
            component = createMenuScreenComponent({
                screen,
                selectedItemId,
                searchQuery,
                tui,
                theme,
                keybindings,
                onEvent: finish,
                onSelectionChange: callbacks.onSelectionChange,
                onSearchQueryChange: callbacks.onSearchQueryChange,
                onSettingChange: (change) =>
                    callbacks.onSettingChange(change, screenController.signal),
                onMultiSelectChange: (change) =>
                    callbacks.onMultiSelectChange(change, screenController.signal),
                onInputSubmit: (change) => callbacks.onInputSubmit(change, screenController.signal),
                onTransition: (transition) => finish({ kind: "transition", transition }),
                onDispose: () => {
                    removeAbortListener();
                    screenController.abort(new DOMException("Menu screen disposed", "AbortError"));
                },
            });
            return component;
        });
    } finally {
        removeAbortListener();
        await component?.waitForPending();
    }
}

async function loadState(ctx, options, signal) {
    if (signal.aborted || !isMenuCurrent(options)) {
        return { kind: "result", result: { kind: "stale" } };
    }
    try {
        const state = await options.getState({ ctx, signal });
        if (signal.aborted || !isMenuCurrent(options)) {
            return { kind: "result", result: { kind: "stale" } };
        }
        return { kind: "loaded", state };
    } catch (error) {
        if (signal.aborted || !isMenuCurrent(options)) {
            return { kind: "result", result: { kind: "stale" } };
        }
        await reportMenuError(ctx, options, error);
        if (signal.aborted || !isMenuCurrent(options)) {
            return { kind: "result", result: { kind: "stale" } };
        }
        return { kind: "result", result: { kind: "error", error } };
    }
}

function componentCloseInvocation() {
    return { accepted: true, stale: false, transition: { kind: "close" } };
}

function closedMenuResult(reason) {
    if (reason === undefined) {
        throw new Error("Menu navigator closed without a termination reason");
    }
    return { kind: "closed", reason };
}

function uiFor(ctx) {
    // Pi core packages are peers and can be typechecked at multiple compatible versions in one
    // tree.
    // The runtime uses only this stable UI surface and never adds command-only context
    // capabilities.
    return ctx.ui;
}
