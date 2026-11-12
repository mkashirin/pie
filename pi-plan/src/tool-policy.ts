import type { ToolInfo } from "@earendil-works/pi-coding-agent";

export const BUILTIN_SAFE_GIT_SUBCOMMANDS = [
    "status",
    "log",
    "diff",
    "show",
    "branch",
    "remote",
    "ls-files",
    "grep",
] as const;
export const CONFIGURABLE_SAFE_GIT_SUBCOMMANDS = [
    "rev-parse",
    "blame",
    "describe",
    "merge-base",
    "ls-tree",
    "cat-file",
] as const;
export const SAFE_GIT_SUBCOMMANDS = [
    ...BUILTIN_SAFE_GIT_SUBCOMMANDS,
    ...CONFIGURABLE_SAFE_GIT_SUBCOMMANDS,
] as const;
export const SAFE_GH_SUBCOMMAND_PATHS = ["pr view", "pr list", "issue view", "issue list"] as const;
export type BuiltinSafeGitSubcommand = (typeof BUILTIN_SAFE_GIT_SUBCOMMANDS)[number];
export type ConfigurableSafeGitSubcommand = (typeof CONFIGURABLE_SAFE_GIT_SUBCOMMANDS)[number];
export type SafeGitSubcommand = (typeof SAFE_GIT_SUBCOMMANDS)[number];
export type SafeGhSubcommandPath = (typeof SAFE_GH_SUBCOMMAND_PATHS)[number];
export interface SafeSubcommands {
    [command: string]: string[] | undefined;
}
export const SAFE_BUILTIN_PLAN_TOOLS = new Set(["read", "grep", "find", "ls"]);
export type PlanModeToolPolicy = "read-only" | "limited" | "user-opt-in" | "blocked";

export function isBuiltinTool(tool: ToolInfo): boolean {
    return tool.sourceInfo?.source === "builtin";
}
export function classifyPlanModeTool(tool: ToolInfo): PlanModeToolPolicy {
    if (!isBuiltinTool(tool)) return "user-opt-in";
    if (SAFE_BUILTIN_PLAN_TOOLS.has(tool.name)) return "read-only";
    if (tool.name === "bash" || tool.name === "powershell") return "limited";
    return "blocked";
}
export function canSelectToolInPlanMode(tool: ToolInfo): boolean {
    return classifyPlanModeTool(tool) !== "blocked" && tool.exposure !== "hidden";
}
export function readCommand(input: unknown): string {
    if (
        input && typeof input === "object" && "command" in input
        && typeof input.command === "string"
    ) return input.command;
    return "";
}

interface Segment {
    text: string;
    words: string[];
}

// This is a deliberately restricted grammar, not an attempted shell interpreter. Unsupported
// syntax fails closed before any trusted command exception is considered.
function tokenize(command: string, powershell: boolean): Segment[] | undefined {
    if (!command.trim() || command.length > 100000 || /[\x00-\x08\x0b-\x1f\x7f]/u.test(command)) {
        return undefined;
    }
    const segments: Segment[] = [];
    let words: string[] = [];
    let word = "";
    let started = false;
    let quote = "";
    let start = 0;
    const flush = () => {
        if (started) words.push(word);
        word = "";
        started = false;
    };
    for (let i = 0; i < command.length; i++) {
        const character = command[i]!;
        // Expansion can execute before argument parsing, including in double quotes.
        if ((character === "`" || character === "$") && quote !== "'") return undefined;
        if (quote) {
            if (character === quote) quote = "";
            else if (character === "\\" && quote === "\"" && !powershell) {
                const next = command[++i];
                if (!next || !["\"", "\\"].includes(next)) return undefined;
                word += next;
            } else word += character;
            continue;
        }
        if (character === "'" || character === "\"") {
            quote = character;
            started = true;
        } else if (
            "<>()[{}]*?~".includes(character) || character === "#"
            || character === "\\" || powershell && "@&%".includes(character)
        ) {
            return undefined;
        } else if (
            character === "|" || character === "&" || character === ";"
            || character === "\n"
        ) {
            flush();
            if (!words.length) return undefined;
            if (character === "&" && command[i + 1] !== "&") return undefined;
            segments.push({ text: command.slice(start, i).trim(), words });
            words = [];
            if ((character === "&" || character === "|") && command[i + 1] === character) i++;
            start = i + 1;
        } else if (/\s/u.test(character)) flush();
        else {
            started = true;
            word += character;
        }
    }
    if (quote) return undefined;
    flush();
    if (!words.length) return undefined;
    segments.push({ text: command.slice(start).trim(), words });
    return segments;
}

function configuredException(words: string[], safe: SafeSubcommands): boolean {
    const name = words[0]!;
    const paths = Object.hasOwn(safe, name) ? safe[name] : undefined;
    return Array.isArray(paths) && paths.some((path) => {
        if (typeof path !== "string" || !/^[\w-]+(?: [\w-]+)*$/u.test(path)) return false;
        const prefix = path.split(" ");
        return prefix.every((part, index) => words[index + 1] === part);
    });
}

// Git and GNU-style programs accept unambiguous long-option abbreviations. Compare the
// option name, not its value, and fail closed even when a dangerous prefix is ambiguous today.
function longOptionMatches(arg: string, dangerous: readonly string[]): boolean {
    if (!arg.startsWith("--") || arg === "--") return false;
    const name = arg.slice(2).split("=", 1)[0]!;
    return dangerous.some((option) => option.startsWith(name) || name === option);
}

function gitAllowed(args: string[]): boolean {
    const subcommand = args[0];
    if (!subcommand || subcommand.startsWith("-")) return false;
    const tail = args.slice(1);
    if (subcommand === "branch") {
        let listing = false;
        for (let i = 0; i < tail.length; i++) {
            const arg = tail[i]!;
            if (arg === "--") return listing; // Remaining words are list patterns, never new names.
            if (arg === "--list" || arg === "-l") listing = true;
            else if (/^--(?:contains|no-contains|merged|no-merged)(?:=.+)?$/u.test(arg)) {
                if (!arg.includes("=") && tail[i + 1] && !tail[i + 1]!.startsWith("-")) i++;
            } else if (
                !/^(?:--(?:all|remotes|verbose|no-color|show-current)|-[arv]+)$/u.test(arg)
                && !(listing && !arg.startsWith("-"))
            ) return false;
        }
        return true;
    }
    if (subcommand === "remote") {
        return tail.length === 0 || tail.length === 1 && ["-v", "--verbose"].includes(tail[0]!);
    }
    const dangerous = [
        "output",
        "ext-diff",
        "textconv",
        "exec",
        "exec-path",
        "upload-pack",
        "receive-pack",
        "config",
        "config-env",
        "git-dir",
        "work-tree",
        "namespace",
        "super-prefix",
        "open-files-in-pager",
        "filters",
        "ext-grep",
    ];
    const pickaxe = ["diff", "log", "show"].includes(subcommand);
    const flagsBeforeTerminator =
        /^(?:--(?:stat|numstat|shortstat|name-only|name-status|check|summary|raw|patch|no-patch|cached|staged|no-index|color|no-color|oneline|graph|all|no-ext-diff|no-textconv)|-[pursawzbviEFGPHq]+)$/u;
    for (let i = 0; i < tail.length; i++) {
        const arg = tail[i]!;
        if (arg === "--") break;
        if (
            longOptionMatches(arg, dangerous) || arg.startsWith("--no-no-")
            || subcommand === "grep" && /^-[^-]*O/u.test(arg)
        ) return false;
        // -G takes a pickaxe operand in diff/log/show, but is a no-argument mode flag in grep.
        // Confusing these grammars could hide grep's executable --open-files-in-pager option.
        if (
            pickaxe && /^-[GS]$/u.test(arg)
            || subcommand === "grep" && ["-e", "-f"].includes(arg)
        ) {
            if (++i >= tail.length) return false;
        } else if (
            tail[i + 1] === "--" && arg.startsWith("-")
            && !flagsBeforeTerminator.test(arg) && !arg.includes("=")
        ) {
            // An unknown option may consume "--" as its value, leaving later options active.
            // Do not pretend it is a terminator without knowing the preceding option's arity.
            return false;
        }
    }
    return (BUILTIN_SAFE_GIT_SUBCOMMANDS as readonly string[]).includes(subcommand);
}

function shellSegmentAllowed(words: string[], safe: SafeSubcommands): boolean {
    const [name, ...args] = words;
    if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/u.test(name)) return false;
    // Configured subcommands are deliberate user-trusted exceptions, but never exceptions
    // to tokenization: expansion, redirection and unparsed shell grammar remain forbidden.
    if (configuredException(words, safe)) return true;
    if (name === "git") return gitAllowed(args);
    if (name === "gh") {
        return SAFE_GH_SUBCOMMAND_PATHS.includes(args.slice(0, 2).join(" ") as SafeGhSubcommandPath)
            && !args.some((arg) => /^(?:--(?:web|browser|template)|-w)(?:=|$)/u.test(arg));
    }
    if (
        [
            "pwd",
            "ls",
            "cat",
            "head",
            "tail",
            "wc",
            "file",
            "stat",
            "du",
            "uname",
            "whoami",
            "id",
            "ps",
            "which",
            "printenv",
            "echo",
            "printf",
            "true",
            "false",
            "test",
        ].includes(name)
    ) {
        // Some apparently informational programs have platform-specific execution/write flags.
        if (
            name === "file"
            && args.some((arg) =>
                /^-[^-]*C/u.test(arg) || longOptionMatches(arg, ["compile", "output"])
            )
        ) return false;
        if (name === "printf" && args[0]?.startsWith("-v")) return false;
        return true;
    }
    if (name === "date") {
        return args.length === 0
            || args.every((arg) =>
                arg.startsWith("+") || ["-u", "--utc", "--iso-8601", "-I", "-R"].includes(arg)
            );
    }
    if (["rg", "grep", "egrep", "fgrep"].includes(name)) {
        return !args.some((arg) =>
            longOptionMatches(arg, ["pre", "pre-glob", "hostname-bin", "search-zip"])
            || /^-[^-]*z/u.test(arg)
        );
    }
    if (name === "find") {
        return !args.some((arg) =>
            /^-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)(?:$|=)/u.test(arg)
        );
    }
    if (name === "sort") {
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]!;
            if (arg === "--") break;
            if (/^-[^-]*o/u.test(arg) || longOptionMatches(arg, ["output", "compress-program"])) {
                return false;
            }
            if (
                args[i + 1] === "--" && arg.startsWith("-") && !arg.includes("=")
                && !/^(?:-[bdfghiMnrRsuVz]+|--(?:reverse|stable|unique|numeric-sort|version-sort))$/u
                    .test(arg)
            ) {
                return false;
            }
        }
        return true;
    }
    if (name === "uniq") {
        let operands = 0;
        let options = true;
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]!;
            if (options && arg === "--") options = false;
            else if (options && /^--(?:skip-fields|skip-chars|check-chars)=\d+$/u.test(arg)) {
                continue;
            } else if (
                options
                && /^(?:-[cduiz]+|-[fsw]\d+|--(?:count|repeated|unique|ignore-case|zero-terminated))$/u
                    .test(arg)
            ) continue;
            else if (
                options && /^(?:-[fsw]|--(?:skip-fields|skip-chars|check-chars))$/u.test(arg)
            ) {
                if (!/^\d+$/u.test(args[++i] ?? "")) return false;
            } else if (options && arg.startsWith("-") && arg !== "-") return false;
            else if (++operands > 1) return false;
        }
        return true;
    }
    if (
        ["cut", "tr", "diff", "cmp", "realpath", "readlink", "basename", "dirname"].includes(name)
    ) return true;
    if (name === "sed") {
        // Support only a single print expression, never e/w/r commands or in-place flags.
        return args[0] === "-n" && /^\d*(?:,\d+)?p$/u.test(args[1] ?? "")
            && args.slice(2).every((arg) => !arg.startsWith("-"));
    }
    return false;
}

export function findBlockedCommandSegment(
    command: string,
    safeSubcommands: SafeSubcommands = {},
    _workingDirectory?: string,
    platform: NodeJS.Platform = process.platform,
): string | undefined {
    // The POSIX grammar cannot safely reason about cmd.exe's expansion rules.
    if (platform === "win32") return command;
    const segments = tokenize(command, false);
    if (!segments) return command;
    return segments.find(({ words }) => !shellSegmentAllowed(words, safeSubcommands))?.text;
}

const POWERSHELL_READ_COMMANDS = new Set([
    "get-content",
    "get-childitem",
    "get-item",
    "get-itemproperty",
    "get-location",
    "get-process",
    "get-service",
    "get-command",
    "get-help",
    "get-date",
    "get-filehash",
    "test-path",
    "resolve-path",
    "split-path",
    "join-path",
    "select-string",
    "select-object",
    "sort-object",
    "group-object",
    "measure-object",
    "compare-object",
    "format-table",
    "format-list",
    "out-string",
    "write-output",
    "pwd",
    "ls",
    "dir",
    "cat",
    "gc",
    "gci",
    "echo",
]);
export function findBlockedPowerShellCommandSegment(
    command: string,
    safeSubcommands: SafeSubcommands = {},
    _workingDirectory?: string,
): string | undefined {
    const segments = tokenize(command, true);
    if (!segments) return command;
    return segments.find(({ words }) => {
        const [rawName, ...args] = words;
        const name = rawName!.toLowerCase();
        // Stop-parsing is shell grammar: on Windows its tail expands environment variables
        // even inside quotes. Trusted command exceptions cannot override this parser boundary.
        if (args.some((arg) => arg === "--%")) return true;
        if (configuredException([name, ...args], safeSubcommands)) return false;
        if (name === "get-help" && args.some((arg) => /^-o/iu.test(arg))) return true;
        if (name === "git" || name === "gh") {
            return !shellSegmentAllowed([name, ...args], safeSubcommands);
        }
        return !POWERSHELL_READ_COMMANDS.has(name)
            && !configuredException([name, ...args], safeSubcommands);
    })?.text;
}
