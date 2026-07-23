import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClientInfo, runBridge } from '../src/bridge.ts';

test('extractClientInfo reads the initialize params', () => {
  const info = extractClientInfo({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { clientInfo: { name: 'cursor', version: '0.42' } },
  });
  assert.deepEqual(info, { name: 'cursor', version: '0.42' });
});

test('extractClientInfo returns undefined for non-initialize', () => {
  assert.equal(extractClientInfo({ jsonrpc: '2.0', method: 'tools/list' }), undefined);
});

function fakeTransport() {
  const t: any = {
    started: false, closed: false, sent: [] as unknown[],
    async start() { this.started = true; },
    async send(m: unknown) { this.sent.push(m); },
    async close() { this.closed = true; this.onclose?.(); },
  };
  return t;
}

test('builds upstream with a client-info user agent after the first initialize', async () => {
  const downstream = fakeTransport();
  let seenUA = '';
  const upstream = fakeTransport();
  await runBridge({
    downstream,
    makeUpstream: (ua: string) => { seenUA = ua; return upstream; },
  });
  // simulate the client sending initialize
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'goose', version: '1.2' } } };
  await downstream.onmessage(init);
  assert.match(seenUA, /\(goose\/1\.2\)$/);
  assert.equal(upstream.started, true);
  assert.deepEqual(upstream.sent[0], init);
});

test('forwards upstream messages back to downstream', async () => {
  const downstream = fakeTransport();
  const upstream = fakeTransport();
  await runBridge({ downstream, makeUpstream: () => upstream });
  await downstream.onmessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const reply = { jsonrpc: '2.0', id: 1, result: {} };
  upstream.onmessage(reply);
  assert.deepEqual(downstream.sent[0], reply);
});

// An upstream whose send() always rejects, mirroring the SDK's StreamableHTTPError
// (its `code` is the HTTP status) on any non-2xx.
function throwingUpstream(err: Error) {
  const t: any = {
    async start() {},
    async send(_m: unknown) { throw err; },
    async close() { this.onclose?.(); },
  };
  return t;
}

test('a failed upstream request surfaces a JSON-RPC error downstream (no silent 60s hang)', async () => {
  const downstream = fakeTransport();
  const e429: any = new Error('HTTP 429 rate limited'); e429.code = 429;
  await runBridge({ downstream, makeUpstream: () => throwingUpstream(e429) });
  await downstream.onmessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {} });
  assert.equal(downstream.sent.length, 1);
  const resp: any = downstream.sent[0];
  assert.equal(resp.jsonrpc, '2.0');
  assert.equal(resp.id, 7);
  assert.equal(resp.error.code, -32603);
  assert.match(resp.error.message, /429/);
  assert.deepEqual(resp.error.data, { httpStatus: 429 });
});

test('the api-key key-door 401 message reaches the model instead of stderr-only', async () => {
  const downstream = fakeTransport();
  const doorErr = new Error('Shippo key door rejected this key; it may not be enabled on this host yet');
  await runBridge({ downstream, makeUpstream: () => throwingUpstream(doorErr) });
  await downstream.onmessage({ jsonrpc: '2.0', id: 'abc', method: 'tools/call', params: {} });
  const resp: any = downstream.sent[0];
  assert.equal(resp.id, 'abc');
  assert.match(resp.error.message, /key door rejected this key/);
});

test('a failed upstream notification is not answered (no id, stderr only)', async () => {
  const downstream = fakeTransport();
  await runBridge({ downstream, makeUpstream: () => throwingUpstream(new Error('boom')) });
  await downstream.onmessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(downstream.sent.length, 0);
});

// A fake whose close() fires onclose, mirroring the real SDK transports. Used
// to prove the bridge does not recurse between the two sides on shutdown.
function selfClosingFake() {
  const t: any = {
    closeCount: 0,
    sent: [] as unknown[],
    async start() {},
    async send(m: unknown) { this.sent.push(m); },
    async close() { this.closeCount += 1; this.onclose?.(); },
  };
  return t;
}

test('closing one side propagates to the other exactly once (no infinite recursion)', async () => {
  const downstream = selfClosingFake();
  const upstream = selfClosingFake();
  await runBridge({ downstream, makeUpstream: () => upstream });
  await downstream.onmessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  await downstream.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(downstream.closeCount, 1);
  assert.equal(upstream.closeCount, 1);
});

test('a rapid second message does not spawn a second upstream or send before start resolves', async () => {
  let makeCount = 0;
  const events: string[] = [];
  const downstream = fakeTransport();
  const upstream: any = {
    sent: [] as unknown[],
    async start() { await new Promise((resolve) => setTimeout(resolve, 20)); events.push('start'); },
    async send(m: any) { events.push('send:' + m.id); this.sent.push(m); },
    async close() {},
  };
  await runBridge({ downstream, makeUpstream: () => { makeCount += 1; return upstream; } });
  const p1 = downstream.onmessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'x' } } });
  const p2 = downstream.onmessage({ jsonrpc: '2.0', id: 2, method: 'ping' });
  await Promise.all([p1, p2]);
  assert.equal(makeCount, 1);
  assert.deepEqual(events, ['start', 'send:1', 'send:2']);
});
