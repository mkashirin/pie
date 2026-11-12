// Only TUI presentation is local; RPC and no-UI dispatch stay upstream.
import {
    runMenu as upstreamRunMenu,
    runQuestionnaire as upstreamRunQuestionnaire,
} from "@narumitw/pi-tui-kit";
import { runMenu as wrappedRunMenu } from "./interaction/menu.js";
import { runQuestionnaire as wrappedRunQuestionnaire } from "./interaction/questionnaire.js";
export { defineMenu, type RunMenuResult, sanitizeTerminalText } from "@narumitw/pi-tui-kit";

// Keep the pinned boundary explicit for tooling that infers JS instead of using adjacent .d.ts.
const runTuiMenu = wrappedRunMenu as typeof upstreamRunMenu;

const runTuiQuestionnaire = wrappedRunQuestionnaire as typeof upstreamRunQuestionnaire;

export const runMenu: typeof upstreamRunMenu = (ctx, definition, options) =>
    ctx.mode === "tui" && ctx.hasUI
        ? runTuiMenu(ctx, definition, options)
        : upstreamRunMenu(ctx, definition, options);

export const runQuestionnaire: typeof upstreamRunQuestionnaire = (ctx, options) =>
    ctx.mode === "tui" && ctx.hasUI
        ? runTuiQuestionnaire(ctx, options)
        : upstreamRunQuestionnaire(ctx, options);
