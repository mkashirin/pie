import { test } from "node:test";
import assert from "node:assert/strict";
import { login, type LoginDependencies } from "../oauth.ts";

const credential = { type: "oauth" as const, access: "fake", refresh: "fake", expires: 1 };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness(native: NonNullable<LoginDependencies["native"]>) {
    const controller = new AbortController();
    const dialogController = new AbortController();
    let escape: () => void = () => {};
    let doneCount = 0;
    let inputs = 0;
    let result: unknown;
    const dependencies: LoginDependencies = {
        native,
        dialog: ((_tui: unknown, _provider: unknown, cancel: () => void) => {
            escape = cancel;
            return {
                signal: dialogController.signal,
                handleInput: () => {
                    inputs++;
                    dialogController.abort();
                    cancel();
                },
                showManualInput: () => new Promise(() => {}),
                showPrompt: () => new Promise(() => {}),
            };
        }) as any,
    };
    const ctx: any = {
        mode: "tui",
        ui: {
            custom: (factory: any) =>
                new Promise((resolve) => {
                    factory({}, {}, {}, (value: unknown) => {
                        doneCount++;
                        result = value;
                        resolve(value);
                    });
                }),
        },
    };
    const promise = login(ctx, "fake-device", controller, dependencies);
    return {
        controller,
        promise,
        escape: () => escape(),
        counts: () => ({ doneCount, inputs, result }),
    };
}
for (const source of ["Escape", "controller/session shutdown"]) {
    test(`${source} abort cleans up exactly once even when native rejects later`, async () => {
        let signal: AbortSignal | undefined;
        const h = harness(
            (async (_id: unknown, _method: unknown, callbacks: any) => {
                signal = callbacks.signal;
                await new Promise((_resolve, reject) =>
                    signal!.addEventListener("abort", () => reject(Error("cancelled")), {
                        once: true,
                    })
                );
            }) as any,
        );
        if (source === "Escape") h.escape();
        else h.controller.abort();
        assert.equal(await h.promise, undefined);
        await tick();
        h.controller.abort();
        assert.equal(signal?.aborted, true);
        assert.deepEqual(h.counts(), { doneCount: 1, inputs: 1, result: undefined });
    });
}
test("browser completion cancels only pending manual prompt and returns credential", async () => {
    const h = harness(
        (async (_id: unknown, _method: unknown, callbacks: any) => {
            const prompt = new AbortController();
            const pending = callbacks.prompt({
                type: "manual_code",
                message: "code",
                signal: prompt.signal,
            });
            prompt.abort();
            await assert.rejects(pending);
            assert.equal(callbacks.signal.aborted, false);
            return credential;
        }) as any,
    );
    assert.deepEqual(await h.promise, credential);
    await tick();
    h.controller.abort();
    assert.deepEqual(h.counts(), { doneCount: 1, inputs: 0, result: credential });
});
test("failed login returns no credential and removes abort cleanup", async () => {
    const h = harness(
        (async () => {
            throw Error("fake failure");
        }) as any,
    );
    assert.equal(await h.promise, undefined);
    await tick();
    h.controller.abort();
    assert.deepEqual(h.counts(), { doneCount: 1, inputs: 0, result: undefined });
});
