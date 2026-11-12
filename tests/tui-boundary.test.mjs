import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function sources(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (["node_modules", "tests", "docs", ".git"].includes(entry.name)) return [];
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sources(path) : /\.(?:ts|js|mjs)$/u.test(path) ? [path] : [];
    });
}

for (const workspace of manifest.workspaces.filter((name) => name !== "tui")) {
    test(`${workspace} imports shared TUI through its public entrypoint`, () => {
        const violations = [];
        for (const path of sources(join(root, workspace))) {
            const source = readFileSync(path, "utf8");
            for (
                const [, , specifier] of source.matchAll(
                    /(?:from\s*|import\s*\(|require\s*\(|import\s*)(["'])([^"']+)\1/gu,
                )
            ) {
                if (
                    /^(?:@earendil-works\/pi-tui|@narumitw\/pi-tui-kit)(?:\/|$)/u.test(specifier)
                    || specifier.startsWith("@pi-extensions/tui/")
                    || /^(?:\.\.\/)+tui\//u.test(specifier)
                ) {
                    violations.push(`${path.slice(root.length)}: ${specifier}`);
                }
            }
        }
        assert.deepEqual(
            violations,
            [],
            "Migrate host/Kit imports to @pi-extensions/tui (tests are exempt)",
        );
    });
}
