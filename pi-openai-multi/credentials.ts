import type { AuthOperationOptions, Credential, CredentialStore } from "@earendil-works/pi-ai";
import { credential, Vault } from "./vault.ts";
/** One native Models instance is bound to one immutable vault account ID. */
export class AccountCredentials implements CredentialStore {
    constructor(readonly vault: Vault, readonly id: string) {}
    async read(provider: string, options?: AuthOperationOptions) {
        if (provider !== "openai") return undefined;
        return this.vault.read((d) => {
            const a = d.accounts[this.id];
            return a && !a.pendingMove ? structuredClone(a.credential) : undefined;
        }, options?.signal);
    }
    async list(options?: AuthOperationOptions) {
        return await this.read("openai", options)
            ? [{ providerId: "openai", type: "oauth" as const }]
            : [];
    }
    async modify(
        provider: string,
        fn: (current: Credential | undefined) => Promise<Credential | undefined>,
        options?: AuthOperationOptions,
    ) {
        if (provider !== "openai") throw Error("Unsupported provider");
        return this.vault.transact(async (d, check) => {
            const a = d.accounts[this.id];
            if (!a || a.pendingMove) throw Error("Account missing or migration pending");
            const next = await fn(structuredClone(a.credential));
            check();
            if (next) {
                credential(next);
                a.credential = structuredClone(next);
                a.updatedAt = new Date(Math.max(Date.parse(a.updatedAt), Date.now())).toISOString();
            }
            return structuredClone(a.credential);
        }, options?.signal);
    }
    async delete(provider: string, options?: AuthOperationOptions) {
        if (provider !== "openai") throw Error("Unsupported provider");
        await this.vault.transact(async (d) => {
            delete d.accounts[this.id];
        }, options?.signal);
    }
}
