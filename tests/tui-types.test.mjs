import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("strict consumers use the local typed TUI API without allowJs", (t) => {
    // Stay in the workspace's resolution tree without changing any consumer configuration.
    const directory = mkdtempSync(join(root, "tui/tests/.types-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(
        join(directory, "tsconfig.json"),
        JSON.stringify({
            compilerOptions: {
                target: "ES2022",
                lib: ["ES2022", "ES2022.Intl"],
                module: "NodeNext",
                moduleResolution: "NodeNext",
                allowImportingTsExtensions: true,
                allowJs: false,
                strict: true,
                noUnusedLocals: true,
                noUnusedParameters: true,
                noEmit: true,
                skipLibCheck: true,
                types: ["node"],
            },
            files: ["consumer.mts"],
        }),
    );
    writeFileSync(
        join(directory, "consumer.mts"),
        `
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    type Component, defineMenu, runMenu, runQuestionnaire,
    type MenuDefinition, type RunMenuResult, type RunQuestionnaireResult,
    sanitizeDisplayText, ThemedText, wrapPreservingText,
} from "@pi-extensions/tui";

declare const ctx: ExtensionContext;
interface State { count: number; }
const menu: MenuDefinition<State> = defineMenu<State>({
    start: "main",
    screens: {
        main: ({ state, signal }) => ({
            kind: "actions",
            title: String(state.count) + signal.aborted,
            items: [{ id: "increment", label: "Increment", action: "increment" }],
        }),
    },
    actions: {
        increment: ({ state, itemId, value, selected }) => {
            state.count += itemId === "increment" ? 1 : 0;
            void value;
            void selected;
            return { kind: "close" };
        },
        // @ts-expect-error Unknown routing kinds must not silently become valid actions.
        invalid: () => ({ kind: "erase" }),
    },
});
export const menuResult: Promise<RunMenuResult> =
    runMenu(ctx, menu, { getState: () => ({ count: 0 }), isCurrent: () => true });
export const questionnaireResult: Promise<RunQuestionnaireResult> =
    runQuestionnaire(ctx, {
        questions: [{
            id: "scope", header: "Scope", prompt: "Choose scope",
            options: [{ label: "One", description: "First choice" }, { label: "Two" }],
        }],
        allowNotes: true,
    });
// @ts-expect-error State providers retain their concrete type.
runMenu(ctx, menu, { getState: () => ({ count: "wrong" }) });
// @ts-expect-error Questions require stable string IDs.
runQuestionnaire(ctx, { questions: [{ id: 1, header: "Scope", prompt: "Choose", options: [] }] });

export const component: Component = new ThemedText(
    () => sanitizeDisplayText("display", { multiline: true, tabs: "expand" }),
    { wrap: wrapPreservingText },
);
export const rows: string[] = component.render(20);
`,
    );
    const result = spawnSync(process.execPath, [
        join(root, "node_modules/typescript/bin/tsc"),
        "--project",
        join(directory, "tsconfig.json"),
        "--pretty",
        "false",
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
