import { test } from "node:test";
import assert from "node:assert/strict";
import {
    type AssistantMessage,
    createAssistantMessageEventStream,
    normalizeContext,
} from "@earendil-works/pi-ai";
import { bridge, managedActivity, runtime } from "../bridge.ts";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
const openaiProvider = () => builtinProviders().find((provider) => provider.id === "openai")!;
import { Vault } from "../vault.ts";

test("native delegation captures account, forwards hooks and signal, normalizes immutable outputs", async () => {
    const controller = new AbortController();
    const onPayload = () => undefined;
    const onResponse = () => {};
    let selected = "first";
    let seen = "";
    const nativeMessage: AssistantMessage = {
        role: "assistant",
        provider: "openai",
        model: "fake",
        api: "openai-responses",
        timestamp: 0,
        content: [{ type: "text", text: "hello" }],
        stopReason: "stop",
        errorMessage: "secret-native-body",
        usage: {
            input: 1,
            output: 2,
            cacheRead: 3,
            cacheWrite: 4,
            totalTokens: 10,
            cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
        },
    };
    const factory = ((_vault: Vault, id: string) => ({
        getAuth: async () => {
            seen = id;
            return { auth: { apiKey: "minted" }, source: "test" };
        },
    })) as unknown as typeof runtime;
    const native = {
        ...openaiProvider(),
        streamSimple(model, context, options) {
            assert.equal(model.provider, "openai");
            assert.equal(
                context.messages[0].role === "assistant" && context.messages[0].provider,
                "openai",
            );
            assert.equal(options?.signal, controller.signal);
            assert.equal(options?.apiKey, "minted");
            assert.equal(typeof options?.onPayload, "function");
            assert.equal(typeof options?.onResponse, "function");
            const stream = createAssistantMessageEventStream();
            queueMicrotask(() => {
                stream.push({ type: "start", partial: nativeMessage });
                stream.push({ type: "done", reason: "stop", message: nativeMessage });
                stream.end();
            });
            return stream;
        },
    } as ReturnType<typeof openaiProvider>;
    const provider = bridge(new Vault("unused"), () => selected, factory, native);
    const input = { ...nativeMessage, provider: "openai-multi" };
    const auth = await provider.auth!.apiKey!.resolve!({ signal: controller.signal } as never);
    assert.equal(managedActivity(provider), 1);
    selected = "second";
    const stream = provider.streamSimple(
        provider.getModels()[0],
        normalizeContext({ messages: [input] }),
        {
            apiKey: "minted",
            headers: auth!.auth.headers,
            signal: controller.signal,
            onPayload,
            onResponse,
        },
    );
    assert.ok(managedActivity(provider) > 0);
    selected = "second";
    for await (const event of stream) {
        if ("partial" in event) assert.ok(!event.partial.errorMessage?.includes("secret"));
        if ("message" in event) assert.ok(!event.message.errorMessage?.includes("secret"));
    }
    const result = await stream.result();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(managedActivity(provider), 0);
    assert.equal(seen, "first");
    assert.equal(result.provider, "openai-multi");
    assert.deepEqual(result.usage, nativeMessage.usage);
    assert.equal(nativeMessage.provider, "openai");
    assert.equal(input.provider, "openai-multi");
    assert.notEqual(result, nativeMessage);
});

test("failed native request yields sanitized assistant error", async () => {
    const factory = (() => ({
        getAuth() {
            throw Error("secret-refresh-token");
        },
    })) as unknown as typeof runtime;
    const provider = bridge(new Vault("unused"), () => "id", factory);
    const result = await provider.streamSimple(
        provider.getModels()[0],
        normalizeContext({ messages: [] }),
    ).result();
    assert.equal(result.stopReason, "error");
    assert.equal(result.provider, "openai-multi");
    assert.ok(!result.errorMessage?.includes("secret"));
});
