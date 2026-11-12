import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("strict consumers import the public TUI API without allowJs or signature erosion", (t) => {
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
import {
    type Component, defineMenu, runMenu, runQuestionnaire,
    sanitizeDisplayText, ThemedText, wrapPreservingText,
} from "@pi-extensions/tui";
import type {
    defineMenu as kitDefineMenu, runMenu as kitRunMenu,
    runQuestionnaire as kitRunQuestionnaire,
} from "@narumitw/pi-tui-kit";

type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type MenuContract = Assert<Equal<typeof runMenu, typeof kitRunMenu>>;
export type QuestionnaireContract = Assert<Equal<typeof runQuestionnaire, typeof kitRunQuestionnaire>>;
export type DefinitionContract = Assert<Equal<typeof defineMenu, typeof kitDefineMenu>>;

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
