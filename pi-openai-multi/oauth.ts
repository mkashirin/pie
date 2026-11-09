import { type ExtensionContext, LoginDialogComponent } from "@earendil-works/pi-coding-agent";
import { createModels } from "@earendil-works/pi-ai/models";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
export interface LoginDependencies {
    dialog?: (...args: ConstructorParameters<typeof LoginDialogComponent>) => LoginDialogComponent;
    native?: ReturnType<typeof createModels>["login"];
}
export async function login(
    ctx: ExtensionContext,
    deviceId: string,
    controller: AbortController,
    dependencies: LoginDependencies = {},
): Promise<OAuthCredential | undefined> {
    if (ctx.mode !== "tui") throw Error("Login requires interactive TUI");
    controller.signal.throwIfAborted();
    return ctx.ui.custom<OAuthCredential | undefined>((tui, _theme, _keys, done) => {
        let value: OAuthCredential | undefined;
        const store: CredentialStore = {
            read: async () => value,
            list: async () => [],
            delete: async () => {},
            modify: async (_id, fn) => {
                const next = await fn(value);
                if (next?.type === "oauth") value = next;
                return value;
            },
        };
        const models = createModels({
            credentials: store,
            authContext: { env: async () => undefined, fileExists: async () => false },
        });
        const native = builtinProviders().find((provider) => provider.id === "openai");
        if (!native) throw Error("Native OpenAI provider unavailable");
        models.setProvider({ ...native, auth: { oauth: native.auth.oauth } });
        const dialog = (dependencies.dialog ?? ((...args) => new LoginDialogComponent(...args)))(
            tui,
            "openai",
            () => controller.abort(),
            "ChatGPT",
            "Add OpenAI Multi account",
        );
        let settled = false;
        const finish = (result: OAuthCredential | undefined) => {
            if (settled) return;
            settled = true;
            controller.signal.removeEventListener("abort", abort);
            done(result);
        };
        const abort = () => {
            finish(undefined);
            dialog.handleInput("\u001b");
        };
        controller.signal.addEventListener("abort", abort, { once: true });
        void (dependencies.native ?? models.login.bind(models))("openai", "oauth", {
            signal: AbortSignal.any([controller.signal, dialog.signal]),
            async prompt(prompt) {
                prompt.signal?.throwIfAborted();
                if (prompt.type === "select") throw Error("Unexpected OAuth selection prompt");
                let cancel: () => void = () => {};
                const aborted = new Promise<never>((_resolve, reject) => {
                    cancel = () => reject(prompt.signal?.reason ?? new Error("Prompt cancelled"));
                    prompt.signal?.addEventListener("abort", cancel, { once: true });
                });
                try {
                    return await Promise.race([
                        aborted,
                        prompt.type === "manual_code"
                            ? dialog.showManualInput(prompt.message)
                            : dialog.showPrompt(prompt.message, prompt.placeholder),
                    ]);
                } finally {
                    prompt.signal?.removeEventListener("abort", cancel);
                }
            },
            notify(event) {
                if (event.type === "auth_url") dialog.showAuth(event.url, event.instructions);
                else if (event.type === "device_code") dialog.showDeviceCode(event);
                else if (event.type === "info") dialog.showInfo(event.message, event.links);
                else dialog.showProgress(event.message);
            },
        }, { getDeviceId: () => deviceId }).then((result) => {
            if (result.type !== "oauth") throw Error("Unexpected credential");
            finish(controller.signal.aborted ? undefined : result);
        }).catch(() => {
            finish(undefined);
        }).finally(() => controller.signal.removeEventListener("abort", abort));
        return dialog;
    });
}
