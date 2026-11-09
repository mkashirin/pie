import { spawn } from "node:child_process";

export type ClipboardKind = "clipboard" | "primary";
export interface TextClipboard {
    read(kind?: ClipboardKind): Promise<string>;
    write(text: string, kind?: ClipboardKind): Promise<void>;
}
export type ClipboardRunner = (command: string, args: string[], input?: string) => Promise<string>;

/** No shell, bounded lifetime, and clipboard contents travel only over stdin. */
export const runClipboard: ClipboardRunner = (command, args, input) =>
    new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });
        const output: Buffer[] = [];
        const errors: Buffer[] = [];
        const timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`Clipboard command ${command} timed out after 2000ms`));
        }, 2000);
        child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.stdin.on("error", (error) => {
            clearTimeout(timer);
            child.kill("SIGKILL");
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(
                    new Error(
                        `Clipboard command ${command} failed (${code}): ${
                            Buffer.concat(errors).toString("utf8")
                        }`,
                    ),
                );
            } else resolve(Buffer.concat(output).toString("utf8"));
        });
        child.stdin.end(input ?? "");
    });

export function createClipboard(options: {
    platform?: string;
    env?: NodeJS.ProcessEnv;
    runner?: ClipboardRunner;
} = {}): TextClipboard {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const run = options.runner ?? runClipboard;
    const normalize = (text: string) => text.replace(/\r\n/g, "\n");
    async function execute(write: boolean, kind: ClipboardKind, text?: string): Promise<string> {
        if (platform === "darwin") {
            if (kind === "primary") throw new Error("Primary selection is unavailable on macOS");
            return run(write ? "pbcopy" : "pbpaste", [], text);
        }
        if (platform === "win32") {
            if (kind === "primary") throw new Error("Primary selection is unavailable on Windows");
            const script =
                "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); "
                + (write
                    ? "$value = [Console]::In.ReadToEnd(); Set-Clipboard -Value $value"
                    : "[Console]::Out.Write((Get-Clipboard -Raw))");
            return run("powershell.exe", [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ], text);
        }
        if (platform === "linux") {
            if (env.WAYLAND_DISPLAY) {
                return run(write ? "wl-copy" : "wl-paste", [
                    ...(write ? [] : ["--no-newline"]),
                    ...(kind === "primary" ? ["--primary"] : []),
                ], text);
            }
            if (env.DISPLAY) {
                return run("xclip", ["-selection", kind, write ? "-in" : "-out"], text);
            }
            throw new Error("Clipboard requires a Wayland or X11 display");
        }
        throw new Error(`Clipboard is unsupported on ${platform}`);
    }
    return {
        async read(kind = "clipboard") {
            return normalize(await execute(false, kind));
        },
        async write(text, kind = "clipboard") {
            await execute(true, kind, normalize(text));
        },
    };
}
