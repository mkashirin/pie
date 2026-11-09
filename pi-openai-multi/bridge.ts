import { randomUUID } from "node:crypto";
import { createModels, type Provider } from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
function openaiProvider(): Provider {
    return builtinProviders().find((provider) => provider.id === "openai")!;
}
import {
    type Api,
    type ApiStreamOptions,
    type AssistantMessage,
    createAssistantMessageEventStream,
    type Model,
    type SimpleStreamOptions,
    type TranscriptContext,
} from "@earendil-works/pi-ai";
import { AccountCredentials } from "./credentials.ts";
import type { Vault } from "./vault.ts";
export function runtime(vault: Vault, id: string) {
    const models = createModels({
        credentials: new AccountCredentials(vault, id),
        authContext: { env: async () => undefined, fileExists: async () => false },
    });
    const native = openaiProvider();
    models.setProvider({ ...native, auth: { oauth: native.auth.oauth } });
    return models;
}
export function normalize<T>(value: T, from: string, to: string): T {
    if (Array.isArray(value)) return value.map((v) => normalize(v, from, to)) as T;
    if (value && typeof value === "object") {
        const result = { ...value } as Record<string, unknown>;
        if (result.role === "assistant" && result.provider === from) result.provider = to;
        if (Array.isArray(result.messages)) {
            result.messages = result.messages.map((m) => normalize(m, from, to));
        }
        return result as T;
    }
    return value;
}
const activity = new WeakMap<Provider, number>();
const preflights = new WeakMap<Provider, Map<string, { expires: number; cleanup: () => void }>>();
export function managedActivity(provider: Provider): number {
    const pending = preflights.get(provider);
    for (const [token, lease] of pending ?? []) {
        if (lease.expires <= Date.now()) {
            lease.cleanup();
            pending!.delete(token);
        }
    }
    return (activity.get(provider) ?? 0) + (pending?.size ?? 0);
}
function safeError(aborted = false): string {
    return aborted
        ? "OpenAI Multi request aborted."
        : "OpenAI Multi request failed. Check connectivity and account access; reselect or sign in with /openai-accounts.";
}
const requestHeader = "x-pi-openai-multi-request";
function checkHeaders(headers: unknown, allowRequest = false): void {
    if (!headers || typeof headers !== "object") return;
    for (const key of Object.keys(headers)) {
        if (
            (!allowRequest && key.toLowerCase() === requestHeader)
            || ["authorization", "host", "proxy-authorization", "chatgpt-account-id"].includes(
                key.toLowerCase(),
            )
        ) throw Error("OpenAI Multi auth/host overrides are forbidden");
    }
}
export function bridge(
    vault: Vault,
    selected: () => string | undefined,
    createRuntime: typeof runtime = runtime,
    native: Provider = openaiProvider(),
): Provider {
    const catalog = native.getModels().map((m) => ({ ...m, provider: "openai-multi" }));
    const pending = new Map<string, {
        accountId: string;
        token: string;
        expires: number;
        signal?: AbortSignal;
        cleanup: () => void;
    }>();
    const bump = (n: number) => activity.set(provider, (activity.get(provider) ?? 0) + n);
    const consume = (token: string) => {
        pending.get(token)?.cleanup();
        pending.delete(token);
    };
    const resolve = async (id: string, signal?: AbortSignal) => {
        bump(1);
        try {
            const auth = await createRuntime(vault, id).getAuth("openai", { signal });
            if (signal?.aborted) throw Error("Aborted");
            if (auth?.auth.apiKey) {
                const token = auth.auth.apiKey;
                managedActivity(provider);
                const nonce = randomUUID();
                const abort = () => consume(nonce);
                pending.set(nonce, {
                    accountId: id,
                    token,
                    expires: Date.now() + 30_000,
                    signal,
                    cleanup: () => signal?.removeEventListener("abort", abort),
                });
                signal?.addEventListener("abort", abort, { once: true });
                return { ...auth, auth: { ...auth.auth, headers: { [requestHeader]: nonce } } };
            }
            return auth;
        } catch {
            throw Error(safeError(signal?.aborted));
        } finally {
            bump(-1);
        }
    };
    const stream = (
        simple: boolean,
        model: Model<Api>,
        context: TranscriptContext,
        options: SimpleStreamOptions | ApiStreamOptions<Api> = {},
    ) => {
        const entries = Object.entries(options.headers ?? {}).filter(([key]) =>
            key.toLowerCase() === requestHeader
        );
        const nonce = entries.length === 1 ? entries[0][1] : undefined;
        const lease = typeof nonce === "string" ? pending.get(nonce) : undefined;
        const id = options.apiKey !== undefined ? lease?.accountId : selected();
        try {
            if (
                options.apiKey !== undefined && (
                    !lease || lease.token !== options.apiKey || lease.expires <= Date.now()
                    || lease.signal?.aborted || options.signal?.aborted
                )
            ) throw Error("OpenAI Multi credential overrides are forbidden");
            if (options.apiKey === undefined && entries.length) {
                throw Error("OpenAI Multi credential overrides are forbidden");
            }
            if (!id) throw Error("Select an account with /openai-accounts use \"label\" first");
            const canonical = native.getModels().find((m) => m.id === model.id);
            if (
                !canonical || model.baseUrl !== canonical.baseUrl || model.api !== canonical.api
                || model.provider !== "openai-multi"
            ) throw Error("OpenAI Multi model overrides are forbidden");
            checkHeaders(model.headers);
            checkHeaders(options.headers, true);
            const raw = options as Record<string, unknown>;
            for (const key of ["env", "fetch", "auth", "transformHeaders", "baseURL"]) {
                if (raw[key] !== undefined) {
                    throw Error("OpenAI Multi endpoint/auth overrides are forbidden");
                }
            }
            if (raw.baseUrl !== undefined && raw.baseUrl !== canonical.baseUrl) {
                throw Error("OpenAI Multi endpoint overrides are forbidden");
            }
            if (typeof nonce === "string") consume(nonce);
            const result = createAssistantMessageEventStream();
            bump(1);
            void (async () => {
                try {
                    const auth = options.apiKey ? undefined : await resolve(id, options.signal);
                    const apiKey = options.apiKey ?? auth?.auth.apiKey;
                    if (auth?.auth.headers) {
                        const localNonce = auth.auth.headers[requestHeader];
                        const local = typeof localNonce === "string"
                            ? pending.get(localNonce)
                            : undefined;
                        if (typeof localNonce === "string") consume(localNonce);
                        if (!local || local.expires <= Date.now() || local.signal?.aborted) {
                            throw Error("Expired request");
                        }
                    }
                    if (!apiKey || options.signal?.aborted) throw Error("Missing account");
                    const forwarded = {
                        ...options,
                        apiKey,
                        headers: { ...model.headers, ...options.headers },
                    } as Record<string, unknown>;
                    const headers = forwarded.headers as Record<string, string>;
                    for (const key of Object.keys(headers)) {
                        if (key.toLowerCase() === requestHeader) delete headers[key];
                    }
                    for (
                        const key of [
                            "onPayload",
                            "onResponse",
                            "onProviderStreamEvent",
                            "onHeaders",
                        ]
                    ) {
                        const hook = raw[key];
                        if (typeof hook === "function") {
                            forwarded[key] = async (value: unknown) => {
                                const transformed = await hook(value, {
                                    ...canonical,
                                    provider: "openai-multi",
                                });
                                if (key === "onHeaders") {
                                    checkHeaders(value);
                                    checkHeaders(transformed);
                                }
                                return transformed;
                            };
                        }
                    }
                    const history = normalize(context, "openai-multi", "openai");
                    const source = simple
                        ? native.streamSimple(canonical, history, forwarded as SimpleStreamOptions)
                        : native.stream(canonical, history, forwarded as ApiStreamOptions<Api>);
                    for await (const event of source) {
                        const copy = { ...event };
                        const snapshot = (message: AssistantMessage) => {
                            const mapped = normalize(message, "openai", "openai-multi");
                            return mapped.errorMessage === undefined
                                ? mapped
                                : { ...mapped, errorMessage: safeError(options.signal?.aborted) };
                        };
                        if ("partial" in copy) copy.partial = snapshot(copy.partial);
                        if ("message" in copy) copy.message = snapshot(copy.message);
                        if ("error" in copy) {
                            copy.error = {
                                ...normalize(copy.error, "openai", "openai-multi"),
                                errorMessage: safeError(options.signal?.aborted),
                            };
                        }
                        result.push(copy);
                    }
                    result.end();
                } catch {
                    const message: AssistantMessage = {
                        role: "assistant",
                        provider: "openai-multi",
                        model: model.id,
                        api: model.api,
                        content: [],
                        timestamp: Date.now(),
                        stopReason: options.signal?.aborted ? "aborted" : "error",
                        errorMessage: safeError(options.signal?.aborted),
                        usage: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                            totalTokens: 0,
                            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                        },
                    };
                    result.push({
                        type: "error",
                        reason: message.stopReason as "error" | "aborted",
                        error: message,
                    });
                    result.end();
                } finally {
                    bump(-1);
                }
            })();
            return result;
        } catch (error) {
            for (const [, value] of entries) {
                if (typeof value === "string") consume(value);
            }
            managedActivity(provider);
            throw error;
        }
    };
    const provider: Provider = {
        id: "openai-multi",
        name: "OpenAI Multi",
        auth: {
            apiKey: {
                name: "Selected vault account",
                check: async ({ signal }) => {
                    const id = selected();
                    return id && (await vault.list(signal)).some((a) => a.id === id)
                        ? { type: "oauth", source: "Selected vault account" }
                        : undefined;
                },
                resolve: async ({ signal }) => {
                    const id = selected();
                    return id ? resolve(id, signal) : undefined;
                },
            },
        },
        getModels: () => catalog,
        stream: (m, c, o) => stream(false, m, c, o),
        streamSimple: (m, c, o) => stream(true, m, c, o),
    };
    preflights.set(provider, pending);
    return provider;
}
