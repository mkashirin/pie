import { createHash, randomUUID } from "node:crypto";
import {
    atomic,
    credential,
    fold,
    label,
    locked,
    readPrivate,
    safe,
    validate,
    Vault,
} from "./vault.ts";
import { dirname } from "node:path";
import { lstat } from "node:fs/promises";

function canonical(value: unknown): string {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value !== null && typeof value === "object") {
        return "{" + Object.keys(value).sort().map((k) =>
            JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])
        ).join(",") + "}";
    }
    return JSON.stringify(value);
}
export const fingerprint = (value: unknown): string =>
    createHash("sha256").update(canonical(value)).digest("hex");
export type MigrationPhase = "prepared" | "sourceRemoved" | "finalized";
/** Test-only fault injection, after each durable phase. Never receives credentials. */
export interface MigrationHooks {
    phase?(phase: MigrationPhase): void | Promise<void>;
}
/** Always source -> vault lock order. Omit name to recover; supply it to move (never copy). */
export async function migrate(
    vault: Vault,
    source: string,
    name?: string,
    signal?: AbortSignal,
    hooks?: MigrationHooks,
) {
    signal?.throwIfAborted();
    await safe(dirname(source), true, false);
    const rolledBack: string[] = [];
    return locked(source, async (sourceCheck) => {
        await vault.transact(async (d, vaultCheck) => {
            const check = () => {
                sourceCheck();
                vaultCheck();
            };
            let auth: Record<string, unknown>;
            try {
                const raw: unknown = JSON.parse(await readPrivate(source));
                if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                    throw Error("Invalid auth.json");
                }
                auth = raw as Record<string, unknown>;
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
                auth = {};
            }
            const sourceMode = await lstat(source).then((s) => s.mode & 0o777).catch((e) => {
                if (e.code !== "ENOENT") throw e;
                return 0o600;
            });
            for (const a of Object.values(d.accounts)) {
                if (!a.pendingMove) continue;
                if (auth.openai === undefined) delete a.pendingMove;
                else if (fingerprint(auth.openai) === a.pendingMove.sourceFingerprint) {
                    delete auth.openai;
                    await atomic(source, JSON.stringify(auth, null, 2) + "\n", check, sourceMode);
                    delete a.pendingMove;
                } else {
                    rolledBack.push(a.label);
                    delete d.accounts[a.id];
                }
            }
            // Persist recovery before attempting a new move, even when that move fails validation.
            validate(d);
            await atomic(vault.path, JSON.stringify(d, null, 2) + "\n", check);
            if (name === undefined) return;
            label(name);
            if (Object.values(d.accounts).some((a) => fold(a.label) === fold(name))) {
                throw Error("Label already exists");
            }
            credential(auth.openai);
            const now = new Date().toISOString();
            const a = {
                id: randomUUID(),
                label: name,
                createdAt: now,
                updatedAt: now,
                credential: structuredClone(auth.openai),
                pendingMove: { sourceFingerprint: fingerprint(auth.openai) },
            };
            d.accounts[a.id] = a;
            validate(d);
            await atomic(vault.path, JSON.stringify(d, null, 2) + "\n", check);
            await hooks?.phase?.("prepared");
            check();
            delete auth.openai;
            await atomic(source, JSON.stringify(auth, null, 2) + "\n", check, sourceMode);
            await hooks?.phase?.("sourceRemoved");
            check();
            delete (a as { pendingMove?: unknown }).pendingMove;
            validate(d);
            await atomic(vault.path, JSON.stringify(d, null, 2) + "\n", check);
            await hooks?.phase?.("finalized");
        }, signal);
        return { rolledBack };
    }, signal);
}
export const recoverMoves = (vault: Vault, source: string, signal?: AbortSignal) =>
    migrate(vault, source, undefined, signal);
export const moveExisting = migrate;
