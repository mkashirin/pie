#!/bin/sh
set -eu

usage() {
    printf '%s\n' \
        'Usage: ./install.sh [--dev] [--check]' \
        '' \
        'Default: install locked runtime dependencies for all four extensions.' \
        '--dev:   also install the shared development tooling.' \
        '--check: includes --dev, then runs all checks and the clean-install smoke test.' \
        '' \
        'Requires Node.js >=22.19.0 and npm. Does not change Pi settings or credentials.'
}

dev=false
check=false
for arg in "$@"; do
    case "$arg" in
        --dev) dev=true ;;
        --check) dev=true; check=true ;;
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
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ "$dev" = true ]; then
    npm ci --include=dev --legacy-peer-deps
else
    npm ci --omit=dev --legacy-peer-deps
fi
if [ "$check" = true ]; then
    npm run check
    npm run smoke
fi

printf '\nInstalled. Start Pi or use /reload to load the extensions.\n'
