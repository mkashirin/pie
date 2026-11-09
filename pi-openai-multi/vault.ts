import * as nativeFs from "node:fs";
import { constants, lstatSync, renameSync, rmdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import type { OAuthCredential } from "@earendil-works/pi-ai";

export interface Account {
    id: string;
    label: string;
    createdAt: string;
    updatedAt: string;
    credential: OAuthCredential;
    pendingMove?: { sourceFingerprint: string };
}
export interface Data {
    version: 1;
    deviceId: string;
    accounts: Record<string, Account>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function label(value: string): string {
    if (!value.trim() || [...value].length > 64 || /[\p{Cc}\p{Cf}]/u.test(value)) {
        throw Error("Label must contain 1–64 characters and no controls");
    }
    return value;
}
export const fold = (value: string) => value.normalize("NFKC").toLocaleLowerCase("und");
function object(value: unknown): asserts value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw Error("Invalid vault schema");
    }
}
function keys(
    value: unknown,
    required: string[],
    optional: string[] = [],
): asserts value is Record<string, unknown> {
    object(value);
    if (
        required.some((k) => !Object.hasOwn(value, k))
        || Object.keys(value).some((k) => !required.includes(k) && !optional.includes(k))
    ) throw Error("Invalid vault schema");
}
export function credential(value: unknown): asserts value is OAuthCredential {
    object(value);
    if (
        value.type !== "oauth" || typeof value.refresh !== "string" || !value.refresh
        || typeof value.access !== "string" || !value.access || typeof value.expires !== "number"
        || !Number.isFinite(value.expires) || value.expires < 0
        || typeof value.clientId !== "string" || !value.clientId.trim()
        || !Array.isArray(value.scopes) || !value.scopes.every((s) => typeof s === "string")
        || !value.scopes.includes("chatgpt.tokens.use.direct")
    ) throw Error("Invalid ChatGPT OAuth credential");
}
function isTimestamp(value: string): boolean {
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value;
}
export function validate(value: unknown): asserts value is Data {
    keys(value, ["version", "deviceId", "accounts"]);
    if (value.version !== 1 || typeof value.deviceId !== "string" || !uuid.test(value.deviceId)) {
        throw Error("Invalid vault");
    }
    object(value.accounts);
    const labels = new Set<string>();
    for (const [id, a] of Object.entries(value.accounts)) {
        keys(a, ["id", "label", "createdAt", "updatedAt", "credential"], ["pendingMove"]);
        if (
            !uuid.test(id) || a.id !== id || typeof a.label !== "string"
            || typeof a.createdAt !== "string" || !isTimestamp(a.createdAt)
            || typeof a.updatedAt !== "string" || !isTimestamp(a.updatedAt)
            || a.updatedAt < a.createdAt
        ) throw Error("Invalid account");
        label(a.label);
        if (labels.has(fold(a.label))) throw Error("Duplicate account label");
        labels.add(fold(a.label));
        credential(a.credential);
        if (a.pendingMove !== undefined) {
            keys(a.pendingMove, ["sourceFingerprint"]);
            if (
                typeof a.pendingMove.sourceFingerprint !== "string"
                || !/^[a-f0-9]{64}$/.test(a.pendingMove.sourceFingerprint)
            ) throw Error("Invalid migration");
        }
    }
}
export async function safe(path: string, directory = false, privateMode = true): Promise<void> {
    const s = await fs.lstat(path);
    if (
        s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile())
        || (process.getuid && s.uid !== process.getuid())
        || (s.mode & (privateMode ? 0o077 : 0o022)) !== 0
        || (!directory && s.nlink !== 1)
    ) throw Error("Unsafe credential path or permissions");
}
export async function readPrivate(path: string): Promise<string> {
    await safe(path);
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const a = await handle.stat(), b = await fs.lstat(path);
        if (
            a.ino !== b.ino || a.dev !== b.dev || !a.isFile() || a.nlink !== 1 || (a.mode & 0o077)
            || (process.getuid && a.uid !== process.getuid())
        ) throw Error("Credential file changed");
        return await handle.readFile("utf8");
    } finally {
        await handle.close();
    }
}
export async function atomic(
    path: string,
    text: string,
    check: () => void = () => {},
    mode = 0o600,
): Promise<void> {
    await safe(dirname(path), true, false);
    try {
        await safe(path);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const temp = join(dirname(path), `.${randomUUID()}.tmp`);
    let handle;
    try {
        check();
        handle = await fs.open(
            temp,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600,
        );
        await handle.writeFile(text);
        await handle.chmod(mode);
        await handle.sync();
        await handle.close();
        handle = undefined;
        check();
        renameSync(temp, path);
        const dir = await fs.open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            await dir.sync();
        } catch (e) {
            if (
                process.platform !== "win32"
                || !["EINVAL", "ENOTSUP", "EBADF"].includes((e as NodeJS.ErrnoException).code ?? "")
            ) throw e;
        } finally {
            await dir.close();
        }
    } finally {
        await handle?.close();
        await fs.unlink(temp).catch((e) => {
            if (e.code !== "ENOENT") throw e;
        });
    }
}
// proper-lockfile's registry is path-keyed: an old release can cancel a newer
// same-process heartbeat before our filesystem ownership fence runs. Serialize
// our callers for the entire acquisition/callback/release lifetime. Keep the
// public file lock for interoperability with Pi core and other processes.
const localLocks = new Set<string>();
export async function locked<T>(
    path: string,
    fn: (check: () => void) => Promise<T>,
    signal?: AbortSignal,
): Promise<T> {
    path = resolve(path);
    const deadline = Date.now() + 15000;
    while (true) {
        signal?.throwIfAborted();
        if (Date.now() >= deadline) {
            throw Object.assign(Error("Timed out waiting for credential lock"), {
                code: "ELOCKED",
            });
        }
        if (!localLocks.has(path)) break;
        await new Promise((r) => setTimeout(r, 50));
    }
    localLocks.add(path);
    try {
        return await fileLocked(path, fn, deadline, signal);
    } finally {
        localLocks.delete(path);
    }
}
async function fileLocked<T>(
    path: string,
    fn: (check: () => void) => Promise<T>,
    deadline: number,
    signal?: AbortSignal,
): Promise<T> {
    let compromised: Error | undefined;
    let release: (() => Promise<void>) | undefined;
    let owner: ReturnType<typeof lstatSync> | undefined;
    const check = (ignoreAbort = false) => {
        if (!ignoreAbort) signal?.throwIfAborted();
        if (compromised) throw compromised;
        if (owner) {
            let current: ReturnType<typeof lstatSync>;
            try {
                current = lstatSync(`${path}.lock`);
            } catch {
                throw Error("Lock ownership lost; retry operation");
            }
            if (
                !current.isDirectory() || current.isSymbolicLink() || current.dev !== owner.dev
                || current.ino !== owner.ino || current.birthtimeMs !== owner.birthtimeMs
                || current.mtimeMs < owner.mtimeMs || Date.now() - current.mtimeMs >= 30000
            ) throw Error("Lock ownership lost or stale; retry operation");
            owner = current;
        }
    };
    // proper-lockfile must release even after fencing fails, to cancel its heartbeat.
    // Fence both its async release and its synchronous process-exit cleanup.
    const removeOwned = (target: string) => {
        if (owner) {
            const current = lstatSync(target);
            if (
                current.dev !== owner.dev || current.ino !== owner.ino
                || current.birthtimeMs !== owner.birthtimeMs
            ) throw Object.assign(Error("Lock ownership lost"), { code: "ECOMPROMISED" });
        }
        rmdirSync(target);
    };
    const lockFs = {
        ...nativeFs,
        rmdir: (target: string, callback: (error?: NodeJS.ErrnoException | null) => void) => {
            try {
                removeOwned(target);
            } catch (error) {
                callback(error as NodeJS.ErrnoException);
                return;
            }
            callback(null);
        },
        rmdirSync: removeOwned,
    };
    while (!release) {
        check();
        if (Date.now() >= deadline) {
            throw Object.assign(Error("Timed out waiting for credential lock"), {
                code: "ELOCKED",
            });
        }
        try {
            await safe(`${path}.lock`, true, false);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        try {
            release = await lockfile.lock(path, {
                fs: lockFs,
                realpath: false,
                stale: 30000,
                update: 10000,
                retries: 0,
                onCompromised: (e) => {
                    compromised = e;
                },
            });
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ELOCKED" || Date.now() >= deadline) throw e;
            await new Promise((r) => setTimeout(r, 50));
        }
    }
    try {
        owner = lstatSync(`${path}.lock`);
        check();
        const result = await fn(check);
        check();
        return result;
    } finally {
        try {
            await release();
        } catch (error) {
            // A compromised lock may already be released internally; replacement locks
            // are protected by the adapter above. Do not mask the operation's error.
            if (
                !["ERELEASED", "ECOMPROMISED", "ENOENT"].includes(
                    (error as NodeJS.ErrnoException).code ?? "",
                )
            ) throw error;
        }
    }
}
export class Vault {
    readonly path: string;
    constructor(readonly directory: string) {
        this.path = join(directory, "accounts.json");
    }
    async init() {
        await fs.mkdir(this.directory, { mode: 0o700, recursive: true });
        await safe(this.directory, true);
    }
    private async load(check: () => void): Promise<Data> {
        try {
            const data: unknown = JSON.parse(await readPrivate(this.path));
            validate(data);
            return data;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
            const data: Data = { version: 1, deviceId: randomUUID(), accounts: {} };
            await atomic(this.path, JSON.stringify(data, null, 2) + "\n", check);
            return data;
        }
    }
    async read<T>(
        fn: (data: Data, check: () => void) => T | Promise<T>,
        signal?: AbortSignal,
    ): Promise<T> {
        signal?.throwIfAborted();
        await this.init();
        return locked(this.path, async (check) => fn(await this.load(check), check), signal);
    }
    async transact<T>(
        fn: (data: Data, check: () => void) => T | Promise<T>,
        signal?: AbortSignal,
    ): Promise<T> {
        signal?.throwIfAborted();
        await this.init();
        return locked(this.path, async (check) => {
            const data = await this.load(check);
            const result = await fn(data, check);
            validate(data);
            check();
            await atomic(this.path, JSON.stringify(data, null, 2) + "\n", check);
            return result;
        }, signal);
    }
    async list(signal?: AbortSignal) {
        return this.read(
            (d) =>
                Object.values(d.accounts).filter((a) => !a.pendingMove).map((
                    { id, label, createdAt, updatedAt, credential },
                ) => ({ id, label, createdAt, updatedAt, expires: credential.expires })),
            signal,
        );
    }
}
