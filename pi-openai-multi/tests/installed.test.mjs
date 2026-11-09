import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';

test('installed SDK discovery, isolated session startup and RPC status', async () => {
  const dir = await mkdtemp(resolve(import.meta.dirname, '.fixture-installed-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const { discoverAndLoadExtensions } = await import('@earendil-works/pi-coding-agent');
    const loaded = await discoverAndLoadExtensions([resolve(import.meta.dirname, '../index.ts')], dir, dir);
    assert.deepEqual(loaded.errors, []);
    const extension = loaded.extensions.find(e => e.commands.has('openai-accounts'));
    assert.ok(extension);
    const notes = [];
    const ctx = { mode: 'rpc', isIdle: () => true, modelRegistry: { refresh: async () => {} }, sessionManager: { getEntries: () => [] }, ui: { notify: text => notes.push(text), setStatus: () => {} } };
    for (const handler of extension.handlers.get('session_start') ?? []) await handler({ type: 'session_start' }, ctx);
    await extension.commands.get('openai-accounts').handler('status', ctx);
    assert.match(notes.at(-1), /No available account selected/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('installed ModelRuntime composes managed auth, transport and pending header guard', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const { builtinProviders } = await import('@earendil-works/pi-ai/providers/all');
  const { createAssistantMessageEventStream } = await import('@earendil-works/pi-ai');
  const jiti = createJiti(import.meta.url);
  const { bridge, managedActivity } = await jiti.import('../bridge.ts');
  const native = builtinProviders().find(p => p.id === 'openai');
  let selected = 'A';
  let observed;
  const provider = bridge({}, () => selected, (_vault, id) => ({ getAuth: async () => ({ auth: { apiKey: `token-${id}` }, source: 'test' }) }), {
    ...native,
    streamSimple(_model, _context, options) {
      observed = options;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: 'done', reason: 'stop', message: { role: 'assistant', provider: 'openai', model: _model.id, api: _model.api, content: [], timestamp: 0, stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }); stream.end(); });
      return stream;
    },
  });
  const registry = await ModelRuntime.create({ credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => {} }, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  registry.registerNativeProvider(provider);
  const model = registry.getModels('openai-multi')[0];
  assert.ok(model);
  let release;
  const gate = new Promise(r => { release = r; });
  const stream = registry.streamSimple(model, { messages: [] }, { transformHeaders: async headers => { assert.ok(managedActivity(provider) > 0); selected = 'B'; await gate; return { ...headers, 'x-safe': 'yes' }; } });
  await new Promise(r => setTimeout(r, 20));
  assert.ok(managedActivity(provider) > 0);
  release();
  for await (const _event of stream) {}
  await new Promise(r => setImmediate(r));
  assert.equal(observed.apiKey, 'token-A');
  assert.equal(observed.headers['x-safe'], 'yes');
  assert.equal(observed.headers['x-pi-openai-multi-request'], undefined);
  assert.equal(managedActivity(provider), 0);

  // Two host preflights with the very same native token own independent guards.
  selected = 'A';
  const first = new AbortController();
  let releaseBoth;
  const bothGate = new Promise(r => { releaseBoth = r; });
  let waiting = 0;
  const hook = async headers => { waiting++; await bothGate; return headers; };
  const one = registry.streamSimple(model, { messages: [] }, { signal: first.signal, transformHeaders: hook });
  const two = registry.streamSimple(model, { messages: [] }, { transformHeaders: hook });
  while (waiting < 2) await new Promise(r => setImmediate(r));
  assert.equal(managedActivity(provider), 2);
  first.abort();
  assert.equal(managedActivity(provider), 1);
  releaseBoth();
  await Promise.all([(async () => { for await (const e of one) {} })(), (async () => { for await (const e of two) {} })()]);
  assert.equal(observed.apiKey, 'token-A');
  assert.equal(managedActivity(provider), 0);

  const auth = await provider.auth.apiKey.resolve({});
  selected = 'B';
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 30001;
    assert.throws(() => provider.streamSimple(model, { messages: [] }, { ...auth.auth }), /overrides/);
  } finally { Date.now = originalNow; }
  assert.equal(managedActivity(provider), 0);
  assert.throws(() => provider.streamSimple(model, { messages: [] }, { ...auth.auth }), /overrides/);
  assert.throws(() => provider.streamSimple(model, { messages: [] }, { apiKey: 'token-A' }), /overrides/);

  const consumed = await provider.auth.apiKey.resolve({});
  for await (const e of provider.streamSimple(model, { messages: [] }, { ...consumed.auth })) {}
  assert.throws(() => provider.streamSimple(model, { messages: [] }, { ...consumed.auth }), /overrides/);
  const modified = await provider.auth.apiKey.resolve({});
  assert.throws(() => provider.streamSimple(model, { messages: [] }, { ...modified.auth, apiKey: 'wrong' }), /overrides/);
  assert.equal(managedActivity(provider), 0);
  const shadowed = await provider.auth.apiKey.resolve({});
  assert.throws(() => provider.streamSimple({ ...model, headers: { 'X-Pi-OpenAI-Multi-Request': 'forged' } }, { messages: [] }, { ...shadowed.auth }), /overrides/);
  assert.equal(managedActivity(provider), 0);
});
