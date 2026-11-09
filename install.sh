#!/bin/sh
set -eu

usage() {
    printf '%s\n' \
        'Usage: ./install.sh [--dev]' \
        '' \
        'Default: install locked runtime dependencies in this checkout only.' \
        '--dev:   also install the shared development tooling locally.' \
        'Bundled extensions and skills stay in this checkout; nothing is copied globally.' \
        '' \
        'Requires Node.js >=22.19.0 and npm. Does not change Pi settings or credentials.'
}

dev=false
for arg in "$@"; do
    case "$arg" in
        --dev) dev=true ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'Unknown option: %s\n' "$arg" >&2; usage >&2; exit 1 ;;
    esac
done

for command in node npm; do
    if ! command -v "$command" >/dev/null 2>&1; then
        printf 'Missing %s. Install Node.js >=22.19.0 with npm first.\n' "$command" >&2
        exit 1
    fi
done
node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 19)) {
        console.error("Node.js >=22.19.0 is required; found " + process.versions.node);
        process.exit(1);
    }
'

# Always install in this checkout, even when called from another directory.
install_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$install_dir"

# Keep the explicit bundle manifest scoped to existing paths inside this checkout.
node --input-type=module -e '
    import { readFileSync, realpathSync, statSync } from "node:fs";
    import { isAbsolute, relative, resolve, sep } from "node:path";

    const root = process.cwd();
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    for (const [kind, paths] of [
        ["workspace", manifest.workspaces],
        ["extension", manifest.pi?.extensions],
        ["skill", manifest.pi?.skills],
    ]) {
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error("Missing explicit " + kind + " paths in package.json");
        }
        for (const path of paths) {
            if (typeof path !== "string" || isAbsolute(path)) {
                throw new Error("Expected a checkout-relative " + kind + " path: " + path);
            }
            const target = realpathSync(resolve(root, path));
            const local = relative(root, target);
            if (local === ".." || local.startsWith(".." + sep) || isAbsolute(local)) {
                throw new Error(kind + " path leaves this checkout: " + path);
            }
            const directory = statSync(target).isDirectory();
            if (kind === "extension" ? !statSync(target).isFile() : !directory) {
                throw new Error("Invalid " + kind + " path: " + path);
            }
            if (kind === "workspace") {
                readFileSync(resolve(target, "package.json"));
            }
        }
    }
'

# CLI flags override npm prefix/global settings inherited from the environment.
if [ "$dev" = true ]; then
    npm ci --prefix "$install_dir" --global=false --include=dev --legacy-peer-deps
else
    npm ci --prefix "$install_dir" --global=false --omit=dev --legacy-peer-deps
fi

printf '\nDependencies installed in %s only.\n' "$install_dir"
printf '%s\n' \
    'Extensions and skills remain in this checkout; no Pi settings were changed.' \
    'Start Pi or use /reload for auto-discovered extensions.' \
    'For skills, use the local skills path explicitly or see README.md for registration.'
